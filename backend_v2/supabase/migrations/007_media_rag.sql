-- Media RAG pipeline: parsing artifacts, page metadata, and vector chunks.
--
-- The media pipeline moves from "attach the whole file to the LLM" to proper
-- retrieval-augmented generation. Uploads are parsed (LlamaParse), chunked,
-- embedded (Gemini, 768-dim), and stored here so the media tool retrieves only
-- the relevant chunks and can cite the exact page. The vector column dimension
-- (768) is locked in lock-step with the embedding model and the match RPC.
--
-- Additive and idempotent (ADD COLUMN IF NOT EXISTS / CREATE ... IF NOT EXISTS),
-- consistent with the earlier migrations. RLS mirrors the own-row media policy;
-- the app uses the service-role key and enforces ownership in code by filtering
-- on user_id, so these policies are defence-in-depth.

CREATE EXTENSION IF NOT EXISTS vector;

-- Processing lifecycle + parse artifacts on the existing media row. Legacy rows
-- default to 'pending' (unindexed until processed); the media tool falls back to
-- direct attachment for any doc that is not yet 'ready'.
ALTER TABLE media
    ADD COLUMN IF NOT EXISTS processing_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (processing_status IN (
            'pending', 'parsing', 'extracting', 'chunking',
            'embedding', 'indexing', 'ready', 'failed'
        )),
    ADD COLUMN IF NOT EXISTS processing_error TEXT,
    ADD COLUMN IF NOT EXISTS llamaparse_job_id TEXT,
    ADD COLUMN IF NOT EXISTS page_count INTEGER,
    ADD COLUMN IF NOT EXISTS parsed_json_path TEXT,
    ADD COLUMN IF NOT EXISTS parsed_md_path TEXT,
    ADD COLUMN IF NOT EXISTS parsed_text_path TEXT,
    ADD COLUMN IF NOT EXISTS chunk_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_media_processing_status
    ON media(processing_status);

-- One row per parsed page; backs page-level citation navigation.
CREATE TABLE IF NOT EXISTS media_pages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_id UUID NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL,
    text TEXT,
    markdown TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (media_id, page_number)
);

CREATE INDEX IF NOT EXISTS idx_media_pages_media_id ON media_pages(media_id);

ALTER TABLE media_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own media pages"
    ON media_pages FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own media pages"
    ON media_pages FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own media pages"
    ON media_pages FOR DELETE
    USING (auth.uid() = user_id);

-- Semantic chunks + their embeddings (the retrieval layer).
CREATE TABLE IF NOT EXISTS media_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_id UUID NOT NULL REFERENCES media(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    page_number INTEGER,
    section TEXT,
    token_count INTEGER,
    embedding vector(768) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_chunks_media_id ON media_chunks(media_id);
CREATE INDEX IF NOT EXISTS idx_media_chunks_user_id ON media_chunks(user_id);

-- HNSW (cosine): no training step (unlike IVFFlat) so it handles per-document
-- incremental inserts, which is exactly how chunks land here.
CREATE INDEX IF NOT EXISTS idx_media_chunks_embedding
    ON media_chunks USING hnsw (embedding vector_cosine_ops);

ALTER TABLE media_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own media chunks"
    ON media_chunks FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own media chunks"
    ON media_chunks FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own media chunks"
    ON media_chunks FOR DELETE
    USING (auth.uid() = user_id);

-- Cosine similarity search scoped to one user and an optional media subset.
-- query_embedding is passed from the app as a text literal that PostgREST casts
-- to vector(768); the parameter type must match the column dimension exactly.
CREATE OR REPLACE FUNCTION match_media_chunks(
    query_embedding vector(768),
    p_user_id UUID,
    p_media_ids UUID[] DEFAULT NULL,
    match_count INT DEFAULT 8
)
RETURNS TABLE (
    id UUID,
    media_id UUID,
    chunk_index INT,
    content TEXT,
    page_number INT,
    section TEXT,
    similarity FLOAT
)
LANGUAGE sql STABLE AS $$
    SELECT
        c.id,
        c.media_id,
        c.chunk_index,
        c.content,
        c.page_number,
        c.section,
        1 - (c.embedding <=> query_embedding) AS similarity
    FROM media_chunks c
    WHERE c.user_id = p_user_id
      AND (p_media_ids IS NULL OR c.media_id = ANY(p_media_ids))
    ORDER BY c.embedding <=> query_embedding ASC
    LIMIT match_count;
$$;
