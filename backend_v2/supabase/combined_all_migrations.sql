-- ============================================================================
-- StudyAssistant — ALL migrations combined (001 → 018)
--
-- Convenience file for setting up a FRESH Supabase database in one run
-- (SQL editor → paste → run). Kept OUTSIDE supabase/migrations/ on purpose so
-- migration tooling never applies it twice.
--
-- Safe to re-run: every table/column/index uses IF NOT EXISTS, functions use
-- OR REPLACE, the storage bucket uses ON CONFLICT DO NOTHING, and each
-- CREATE POLICY below is preceded by a generated DROP POLICY IF EXISTS.
--
-- GENERATED from the individual files — do not hand-edit; regenerate instead.
-- The numbered files in supabase/migrations/ remain the source of truth.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 001_initial_schema.sql
-- ----------------------------------------------------------------------------

-- Profiles (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own profile" ON profiles;
CREATE POLICY "Users can view own profile"
    ON profiles FOR SELECT
    USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile"
    ON profiles FOR UPDATE
    USING (auth.uid() = id);

-- Chat sessions
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'New chat',
    mode TEXT NOT NULL DEFAULT 'media' CHECK (mode IN ('media', 'web_search')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_updated_at ON sessions(updated_at DESC);

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own sessions" ON sessions;
CREATE POLICY "Users can view own sessions"
    ON sessions FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own sessions" ON sessions;
CREATE POLICY "Users can insert own sessions"
    ON sessions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own sessions" ON sessions;
CREATE POLICY "Users can update own sessions"
    ON sessions FOR UPDATE
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own sessions" ON sessions;
CREATE POLICY "Users can delete own sessions"
    ON sessions FOR DELETE
    USING (auth.uid() = user_id);

-- Messages
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_messages_session_id ON messages(session_id);
CREATE INDEX idx_messages_created_at ON messages(created_at);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view messages in own sessions" ON messages;
CREATE POLICY "Users can view messages in own sessions"
    ON messages FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM sessions s
            WHERE s.id = messages.session_id
            AND s.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can insert messages in own sessions" ON messages;
CREATE POLICY "Users can insert messages in own sessions"
    ON messages FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM sessions s
            WHERE s.id = messages.session_id
            AND s.user_id = auth.uid()
        )
    );

-- Media files
CREATE TABLE IF NOT EXISTS media (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    file_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    size_bytes BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_media_user_id ON media(user_id);
CREATE INDEX idx_media_session_id ON media(session_id);

ALTER TABLE media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own media" ON media;
CREATE POLICY "Users can view own media"
    ON media FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own media" ON media;
CREATE POLICY "Users can insert own media"
    ON media FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own media" ON media;
CREATE POLICY "Users can delete own media"
    ON media FOR DELETE
    USING (auth.uid() = user_id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, avatar_url)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
        NEW.raw_user_meta_data->>'avatar_url'
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Update session updated_at on new message
CREATE OR REPLACE FUNCTION public.update_session_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE sessions SET updated_at = NOW() WHERE id = NEW.session_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_message_created
    AFTER INSERT ON messages
    FOR EACH ROW EXECUTE FUNCTION public.update_session_timestamp();

-- ----------------------------------------------------------------------------
-- 002_storage_bucket.sql
-- ----------------------------------------------------------------------------

-- Create private media storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'media',
    'media',
    false,
    10485760,
    ARRAY[
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/webp',
        'image/gif'
    ]
)
ON CONFLICT (id) DO NOTHING;

-- Users can upload to their own folder: {user_id}/{filename}
DROP POLICY IF EXISTS "Users can upload own media" ON storage.objects;
CREATE POLICY "Users can upload own media"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'media'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

DROP POLICY IF EXISTS "Users can view own media files" ON storage.objects;
CREATE POLICY "Users can view own media files"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'media'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

DROP POLICY IF EXISTS "Users can delete own media files" ON storage.objects;
CREATE POLICY "Users can delete own media files"
    ON storage.objects FOR DELETE
    USING (
        bucket_id = 'media'
        AND auth.uid()::text = (storage.foldername(name))[1]
    );

-- ----------------------------------------------------------------------------
-- 003_orchestration_and_quiz.sql
-- ----------------------------------------------------------------------------

-- Orchestration runs (clarification state)
CREATE TABLE IF NOT EXISTS orchestration_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'awaiting_clarification',
    plan JSONB DEFAULT '{}',
    original_message TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_orchestration_runs_session ON orchestration_runs(session_id);
CREATE INDEX idx_orchestration_runs_user ON orchestration_runs(user_id);

ALTER TABLE orchestration_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own orchestration runs" ON orchestration_runs;
CREATE POLICY "Users can view own orchestration runs"
    ON orchestration_runs FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own orchestration runs" ON orchestration_runs;
CREATE POLICY "Users can insert own orchestration runs"
    ON orchestration_runs FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own orchestration runs" ON orchestration_runs;
CREATE POLICY "Users can update own orchestration runs"
    ON orchestration_runs FOR UPDATE
    USING (auth.uid() = user_id);

-- Quizzes
CREATE TABLE IF NOT EXISTS quizzes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'Quiz',
    topic TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_quizzes_session ON quizzes(session_id);
CREATE INDEX idx_quizzes_user ON quizzes(user_id);

ALTER TABLE quizzes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own quizzes" ON quizzes;
CREATE POLICY "Users can view own quizzes"
    ON quizzes FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own quizzes" ON quizzes;
CREATE POLICY "Users can insert own quizzes"
    ON quizzes FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Quiz questions
CREATE TABLE IF NOT EXISTS quiz_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('single_select', 'multi_select', 'true_false')),
    prompt TEXT NOT NULL,
    options JSONB NOT NULL DEFAULT '[]',
    correct_answers JSONB NOT NULL DEFAULT '[]',
    explanation TEXT,
    sort_order INT NOT NULL DEFAULT 0
);

CREATE INDEX idx_quiz_questions_quiz ON quiz_questions(quiz_id);

ALTER TABLE quiz_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view questions in own quizzes" ON quiz_questions;
CREATE POLICY "Users can view questions in own quizzes"
    ON quiz_questions FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM quizzes q
            WHERE q.id = quiz_questions.quiz_id
            AND q.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can insert questions in own quizzes" ON quiz_questions;
CREATE POLICY "Users can insert questions in own quizzes"
    ON quiz_questions FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM quizzes q
            WHERE q.id = quiz_questions.quiz_id
            AND q.user_id = auth.uid()
        )
    );

-- Quiz attempts
CREATE TABLE IF NOT EXISTS quiz_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    answers JSONB NOT NULL DEFAULT '{}',
    score FLOAT,
    evaluation JSONB DEFAULT '{}',
    feedback JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_quiz_attempts_quiz ON quiz_attempts(quiz_id);

ALTER TABLE quiz_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own quiz attempts" ON quiz_attempts;
CREATE POLICY "Users can view own quiz attempts"
    ON quiz_attempts FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own quiz attempts" ON quiz_attempts;
CREATE POLICY "Users can insert own quiz attempts"
    ON quiz_attempts FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 004_bookmarks.sql
-- ----------------------------------------------------------------------------

-- Bookmark collections (folders). Every user gets a default "Favorites".
CREATE TABLE IF NOT EXISTS bookmark_collections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT 'Favorites',
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bookmark_collections_user ON bookmark_collections(user_id);

ALTER TABLE bookmark_collections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own collections" ON bookmark_collections;
CREATE POLICY "Users can view own collections"
    ON bookmark_collections FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own collections" ON bookmark_collections;
CREATE POLICY "Users can insert own collections"
    ON bookmark_collections FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own collections" ON bookmark_collections;
CREATE POLICY "Users can update own collections"
    ON bookmark_collections FOR UPDATE
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own collections" ON bookmark_collections;
CREATE POLICY "Users can delete own collections"
    ON bookmark_collections FOR DELETE
    USING (auth.uid() = user_id);

-- Bookmarks. Store a content snapshot so a bookmark survives deletion of the
-- source message/quiz/media. item_ref holds the source id when known (quiz_id,
-- media id, or message id) for rendering the bookmarked state on the client.
CREATE TABLE IF NOT EXISTS bookmarks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    collection_id UUID REFERENCES bookmark_collections(id) ON DELETE SET NULL,
    item_type TEXT NOT NULL
        CHECK (item_type IN ('response', 'quiz', 'media', 'note')),
    item_ref TEXT,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bookmarks_user ON bookmarks(user_id);
CREATE INDEX idx_bookmarks_user_collection ON bookmarks(user_id, collection_id);

ALTER TABLE bookmarks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own bookmarks" ON bookmarks;
CREATE POLICY "Users can view own bookmarks"
    ON bookmarks FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own bookmarks" ON bookmarks;
CREATE POLICY "Users can insert own bookmarks"
    ON bookmarks FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own bookmarks" ON bookmarks;
CREATE POLICY "Users can update own bookmarks"
    ON bookmarks FOR UPDATE
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own bookmarks" ON bookmarks;
CREATE POLICY "Users can delete own bookmarks"
    ON bookmarks FOR DELETE
    USING (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 005_flashcards.sql
-- ----------------------------------------------------------------------------

-- Flashcard sets (a generated deck).
CREATE TABLE IF NOT EXISTS flashcard_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    title TEXT NOT NULL DEFAULT 'Flashcards',
    topic TEXT NOT NULL DEFAULT '',
    source_type TEXT NOT NULL DEFAULT 'chat'
        CHECK (source_type IN
            ('response', 'media', 'quiz', 'bookmark', 'chat')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_flashcard_sets_user ON flashcard_sets(user_id);

ALTER TABLE flashcard_sets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own flashcard sets" ON flashcard_sets;
CREATE POLICY "Users can view own flashcard sets"
    ON flashcard_sets FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own flashcard sets" ON flashcard_sets;
CREATE POLICY "Users can insert own flashcard sets"
    ON flashcard_sets FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own flashcard sets" ON flashcard_sets;
CREATE POLICY "Users can delete own flashcard sets"
    ON flashcard_sets FOR DELETE
    USING (auth.uid() = user_id);

-- Individual cards.
CREATE TABLE IF NOT EXISTS flashcards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    set_id UUID NOT NULL REFERENCES flashcard_sets(id) ON DELETE CASCADE,
    front TEXT NOT NULL,
    back TEXT NOT NULL,
    example TEXT,
    sort_order INT NOT NULL DEFAULT 0
);

CREATE INDEX idx_flashcards_set ON flashcards(set_id);

ALTER TABLE flashcards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view cards in own sets" ON flashcards;
CREATE POLICY "Users can view cards in own sets"
    ON flashcards FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM flashcard_sets s
            WHERE s.id = flashcards.set_id AND s.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can insert cards in own sets" ON flashcards;
CREATE POLICY "Users can insert cards in own sets"
    ON flashcards FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM flashcard_sets s
            WHERE s.id = flashcards.set_id AND s.user_id = auth.uid()
        )
    );

-- Per-card study ratings (drives analytics).
CREATE TABLE IF NOT EXISTS flashcard_study (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    set_id UUID NOT NULL REFERENCES flashcard_sets(id) ON DELETE CASCADE,
    flashcard_id UUID NOT NULL REFERENCES flashcards(id) ON DELETE CASCADE,
    rating TEXT NOT NULL
        CHECK (rating IN ('easy', 'medium', 'hard', 'needs_revision')),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, flashcard_id)
);

CREATE INDEX idx_flashcard_study_set ON flashcard_study(set_id);

ALTER TABLE flashcard_study ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own study" ON flashcard_study;
CREATE POLICY "Users can view own study"
    ON flashcard_study FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own study" ON flashcard_study;
CREATE POLICY "Users can insert own study"
    ON flashcard_study FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own study" ON flashcard_study;
CREATE POLICY "Users can update own study"
    ON flashcard_study FOR UPDATE
    USING (auth.uid() = user_id);

-- Allow bookmarking flashcard sets.
ALTER TABLE bookmarks DROP CONSTRAINT IF EXISTS bookmarks_item_type_check;
ALTER TABLE bookmarks ADD CONSTRAINT bookmarks_item_type_check
    CHECK (item_type IN ('response', 'quiz', 'media', 'note', 'flashcard'));

-- ----------------------------------------------------------------------------
-- 006_learning_profile.sql
-- ----------------------------------------------------------------------------

-- Personalized learning profile.
--
-- Stored on `profiles` (one row per user) so it lives alongside the user's
-- identity and entirely separate from chat history. Onboarding is optional:
-- `personalization_status` tracks whether the user finished, skipped, or has
-- not yet seen the welcome flow ('pending' | 'completed' | 'skipped').

ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS education_level TEXT,
    ADD COLUMN IF NOT EXISTS preferred_language TEXT,
    ADD COLUMN IF NOT EXISTS explanation_style TEXT,
    ADD COLUMN IF NOT EXISTS favorite_subjects JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS learning_goal TEXT,
    ADD COLUMN IF NOT EXISTS personalization_status TEXT NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS personalization_updated_at TIMESTAMPTZ;

-- Existing RLS policies on `profiles` (own-row SELECT/UPDATE) already cover
-- these columns, so no new policy is required.

-- ----------------------------------------------------------------------------
-- 007_media_rag.sql
-- ----------------------------------------------------------------------------

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

DROP POLICY IF EXISTS "Users can view own media pages" ON media_pages;
CREATE POLICY "Users can view own media pages"
    ON media_pages FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own media pages" ON media_pages;
CREATE POLICY "Users can insert own media pages"
    ON media_pages FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own media pages" ON media_pages;
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

DROP POLICY IF EXISTS "Users can view own media chunks" ON media_chunks;
CREATE POLICY "Users can view own media chunks"
    ON media_chunks FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own media chunks" ON media_chunks;
CREATE POLICY "Users can insert own media chunks"
    ON media_chunks FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own media chunks" ON media_chunks;
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

-- ----------------------------------------------------------------------------
-- 008_full_text_search.sql
-- ----------------------------------------------------------------------------

-- Full-text search across the user's content.
--
-- Each searchable table gets a STORED, GENERATED `search_vector` (tsvector) so
-- it stays in lock-step with its source columns automatically — no triggers to
-- maintain. Title/topic are weighted 'A', longer body text 'B', so a title hit
-- outranks a body hit. A GIN index on each vector keeps `@@` lookups fast.
--
-- `search_all(p_user, p_q)` returns one JSON object with a ranked array per
-- category. It combines full-text matching (websearch_to_tsquery + ts_rank for
-- relevance ranking) with ILIKE substring matching, so both a stemmed word
-- match ("running" ~ "run") and a partial/exact substring ("nor" in
-- "normalization") are found. The repository degrades to a plain ILIKE scan if
-- this migration hasn't been applied yet.

-- --- Generated tsvector columns + GIN indexes -----------------------------

ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (
        to_tsvector('english', coalesce(title, ''))
    ) STORED;
CREATE INDEX IF NOT EXISTS idx_sessions_search
    ON sessions USING gin (search_vector);

ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (
        to_tsvector('english', coalesce(content, ''))
    ) STORED;
CREATE INDEX IF NOT EXISTS idx_messages_search
    ON messages USING gin (search_vector);

ALTER TABLE quizzes
    ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(title, '')), 'A')
        || setweight(to_tsvector('english', coalesce(topic, '')), 'B')
    ) STORED;
CREATE INDEX IF NOT EXISTS idx_quizzes_search
    ON quizzes USING gin (search_vector);

ALTER TABLE flashcard_sets
    ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(title, '')), 'A')
        || setweight(to_tsvector('english', coalesce(topic, '')), 'B')
    ) STORED;
CREATE INDEX IF NOT EXISTS idx_flashcard_sets_search
    ON flashcard_sets USING gin (search_vector);

ALTER TABLE bookmarks
    ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(title, '')), 'A')
        || setweight(to_tsvector('english', coalesce(content, '')), 'B')
    ) STORED;
CREATE INDEX IF NOT EXISTS idx_bookmarks_search
    ON bookmarks USING gin (search_vector);

ALTER TABLE media
    ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (
        to_tsvector('english', coalesce(file_name, ''))
    ) STORED;
CREATE INDEX IF NOT EXISTS idx_media_search
    ON media USING gin (search_vector);

-- --- Ranked cross-content search ------------------------------------------

CREATE OR REPLACE FUNCTION search_all(p_user UUID, p_q TEXT)
RETURNS JSONB
LANGUAGE sql STABLE AS $$
    WITH q AS (
        SELECT
            websearch_to_tsquery('english', p_q) AS tsq,
            '%' || p_q || '%' AS ilk
    )
    SELECT jsonb_build_object(
        'sessions', coalesce((
            SELECT jsonb_agg(r) FROM (
                SELECT s.id, s.title, s.updated_at
                FROM sessions s, q
                WHERE s.user_id = p_user
                  AND (s.search_vector @@ q.tsq OR s.title ILIKE q.ilk)
                ORDER BY ts_rank(s.search_vector, q.tsq) DESC,
                         s.updated_at DESC
                LIMIT 8
            ) r
        ), '[]'::jsonb),
        'messages', coalesce((
            SELECT jsonb_agg(r) FROM (
                SELECT m.id, m.session_id, m.role, m.content,
                       m.created_at, s.title AS session_title
                FROM messages m
                JOIN sessions s ON s.id = m.session_id, q
                WHERE s.user_id = p_user
                  AND (m.search_vector @@ q.tsq OR m.content ILIKE q.ilk)
                ORDER BY ts_rank(m.search_vector, q.tsq) DESC,
                         m.created_at DESC
                LIMIT 12
            ) r
        ), '[]'::jsonb),
        'quizzes', coalesce((
            SELECT jsonb_agg(r) FROM (
                SELECT z.id, z.title, z.topic, z.session_id, z.created_at
                FROM quizzes z, q
                WHERE z.user_id = p_user
                  AND (z.search_vector @@ q.tsq
                       OR z.title ILIKE q.ilk OR z.topic ILIKE q.ilk)
                ORDER BY ts_rank(z.search_vector, q.tsq) DESC,
                         z.created_at DESC
                LIMIT 8
            ) r
        ), '[]'::jsonb),
        'media', coalesce((
            SELECT jsonb_agg(r) FROM (
                SELECT md.id, md.file_name, md.mime_type, md.created_at
                FROM media md, q
                WHERE md.user_id = p_user
                  AND (md.search_vector @@ q.tsq OR md.file_name ILIKE q.ilk)
                ORDER BY ts_rank(md.search_vector, q.tsq) DESC,
                         md.created_at DESC
                LIMIT 8
            ) r
        ), '[]'::jsonb),
        'flashcards', coalesce((
            SELECT jsonb_agg(r) FROM (
                SELECT f.id, f.title, f.topic, f.created_at
                FROM flashcard_sets f, q
                WHERE f.user_id = p_user
                  AND (f.search_vector @@ q.tsq
                       OR f.title ILIKE q.ilk OR f.topic ILIKE q.ilk
                       OR EXISTS (
                           SELECT 1 FROM flashcards c
                           WHERE c.set_id = f.id
                             AND (c.front ILIKE q.ilk OR c.back ILIKE q.ilk)
                       ))
                ORDER BY ts_rank(f.search_vector, q.tsq) DESC,
                         f.created_at DESC
                LIMIT 8
            ) r
        ), '[]'::jsonb)
    );
$$;

-- ----------------------------------------------------------------------------
-- 009_ai_personalization.sql
-- ----------------------------------------------------------------------------

-- AI personality & communication style.
--
-- Extends the learning profile (stored on `profiles`) with how the assistant
-- should *behave*, distinct from the existing fields that describe the learner:
--   * ai_personality      — a persona/teaching style (Teacher, Mentor, …)
--   * communication_style — answer shape (Short & Direct, Step-by-Step, …)
--   * custom_instructions — free-form long-term preferences from the student.
--
-- All optional; empty means "default assistant behavior", so existing users are
-- unaffected. Existing RLS policies on `profiles` already cover these columns.

ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS ai_personality TEXT,
    ADD COLUMN IF NOT EXISTS communication_style TEXT,
    ADD COLUMN IF NOT EXISTS custom_instructions TEXT;

-- ----------------------------------------------------------------------------
-- 010_quiz_difficulty.sql
-- ----------------------------------------------------------------------------

-- Persist a quiz's difficulty on the quiz row.
--
-- Difficulty is chosen at generation time (defaulting to "medium") but was
-- previously only returned inline by the quiz tool and never stored. Persisting
-- it lets the quizzes list show difficulty for every card without re-opening
-- each quiz. Existing rows are backfilled to "medium".

ALTER TABLE quizzes
    ADD COLUMN IF NOT EXISTS difficulty TEXT NOT NULL DEFAULT 'medium';

-- Existing RLS policies on `quizzes` already cover this column.

-- ----------------------------------------------------------------------------
-- 011_quiz_exam_mode.sql
-- ----------------------------------------------------------------------------

-- Persist a quiz's exam configuration (Exam Mode).
--
-- A quiz can optionally simulate a competitive exam (JEE, NEET, SSC, UPSC, ...)
-- with a marking scheme (+correct / -negative / skip marks) and a timer. The
-- whole scheme lives in one JSONB blob so new fields need no schema churn:
--
--   { "pattern": "neet", "correct": 4, "negative": -1, "skip": 0,
--     "timer_seconds": 10800 }
--
-- An empty object ('{}') means an ordinary practice quiz (no marking, no timer),
-- so existing rows keep their current accuracy-only behavior.

ALTER TABLE quizzes
    ADD COLUMN IF NOT EXISTS exam_config JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Existing RLS policies on `quizzes` already cover this column.

-- ----------------------------------------------------------------------------
-- 012_quiz_shares.sql
-- ----------------------------------------------------------------------------

-- Public quiz sharing: an owner mints one stable share link per quiz; anyone
-- can open it and attempt the quiz with no account. Guest attempts are stored
-- anonymously (no user_id / PII) for owner-facing analytics.
--
-- The backend connects as the Supabase service role (bypasses RLS), so these
-- policies are defense-in-depth for direct DB access; the app enforces the
-- share token and ownership in Python.

-- One share record per quiz (reused link). The opaque token is the only thing
-- a public visitor needs; it never exposes the quiz UUID or owner.
CREATE TABLE IF NOT EXISTS quiz_shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    share_token TEXT NOT NULL UNIQUE,
    quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    open_count INT NOT NULL DEFAULT 0,
    attempt_count INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_opened_at TIMESTAMPTZ
);

-- At most one share per quiz, so re-sharing returns the same link.
CREATE UNIQUE INDEX IF NOT EXISTS idx_quiz_shares_quiz ON quiz_shares(quiz_id);
CREATE INDEX IF NOT EXISTS idx_quiz_shares_user ON quiz_shares(user_id);

ALTER TABLE quiz_shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own quiz shares" ON quiz_shares;
CREATE POLICY "Users can view own quiz shares"
    ON quiz_shares FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own quiz shares" ON quiz_shares;
CREATE POLICY "Users can insert own quiz shares"
    ON quiz_shares FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Anonymous guest attempts on a shared quiz — analytics only, no identity.
CREATE TABLE IF NOT EXISTS quiz_share_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    share_id UUID NOT NULL REFERENCES quiz_shares(id) ON DELETE CASCADE,
    quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    score FLOAT,
    total INT,
    correct_count INT,
    completed BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quiz_share_attempts_share
    ON quiz_share_attempts(share_id);

ALTER TABLE quiz_share_attempts ENABLE ROW LEVEL SECURITY;

-- Only the quiz owner (via the parent share) may read guest attempts.
DROP POLICY IF EXISTS "Owners can view guest attempts on their shares" ON quiz_share_attempts;
CREATE POLICY "Owners can view guest attempts on their shares"
    ON quiz_share_attempts FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM quiz_shares s
            WHERE s.id = quiz_share_attempts.share_id
            AND s.user_id = auth.uid()
        )
    );

-- Atomic counter bumps (avoid read-modify-write races on concurrent opens).
CREATE OR REPLACE FUNCTION increment_share_open(p_share_id UUID)
RETURNS VOID LANGUAGE SQL AS $$
    UPDATE quiz_shares
    SET open_count = open_count + 1, last_opened_at = NOW()
    WHERE id = p_share_id;
$$;

CREATE OR REPLACE FUNCTION increment_share_attempt(p_share_id UUID)
RETURNS VOID LANGUAGE SQL AS $$
    UPDATE quiz_shares
    SET attempt_count = attempt_count + 1
    WHERE id = p_share_id;
$$;

-- ----------------------------------------------------------------------------
-- 013_quiz_result_shares.sql
-- ----------------------------------------------------------------------------

-- Public result sharing: an owner mints one stable share link per quiz
-- ATTEMPT so others can view the scored result (and jump into attempting the
-- same quiz via the quiz-level share). Mirrors 012_quiz_shares.sql.
--
-- The backend connects as the Supabase service role (bypasses RLS), so these
-- policies are defense-in-depth for direct DB access; the app enforces the
-- share token and ownership in Python.

CREATE TABLE IF NOT EXISTS quiz_result_shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    share_token TEXT NOT NULL UNIQUE,
    attempt_id UUID NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
    quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    open_count INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_opened_at TIMESTAMPTZ
);

-- At most one share per attempt, so re-sharing returns the same link.
CREATE UNIQUE INDEX IF NOT EXISTS idx_quiz_result_shares_attempt
    ON quiz_result_shares(attempt_id);
CREATE INDEX IF NOT EXISTS idx_quiz_result_shares_user
    ON quiz_result_shares(user_id);

ALTER TABLE quiz_result_shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own result shares" ON quiz_result_shares;
CREATE POLICY "Users can view own result shares"
    ON quiz_result_shares FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own result shares" ON quiz_result_shares;
CREATE POLICY "Users can insert own result shares"
    ON quiz_result_shares FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Atomic counter bump (avoids read-modify-write races on concurrent opens).
CREATE OR REPLACE FUNCTION increment_result_share_open(p_share_id UUID)
RETURNS VOID LANGUAGE SQL AS $$
    UPDATE quiz_result_shares
    SET open_count = open_count + 1, last_opened_at = NOW()
    WHERE id = p_share_id;
$$;

-- ----------------------------------------------------------------------------
-- 014_generic_shares.sql
-- ----------------------------------------------------------------------------

-- Generic sharing platform: ONE table for every shareable resource (quiz,
-- quiz result, and future flashcards/notes/chats/...). A share row never
-- copies content — it points at it via (content_type, content_id) and keeps a
-- small metadata snapshot for link previews. Feature-specific share tables
-- (012/013) are migrated in and dropped.
--
-- The backend connects as the Supabase service role (bypasses RLS), so these
-- policies are defense-in-depth for direct DB access; the app enforces the
-- share id, visibility, and ownership in Python.

CREATE TABLE IF NOT EXISTS shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Public opaque handle used in /share/{share_id} URLs.
    share_id TEXT NOT NULL UNIQUE,
    owner_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    -- App-level enum (quiz, quiz_result, flashcards, note, chat, ...). TEXT so
    -- adding a content type never needs a migration.
    content_type TEXT NOT NULL,
    -- Id of the shared resource in its own table. TEXT for genericity.
    content_id TEXT NOT NULL,
    -- Snapshot for previews/SEO (title, counts, score, ...). Content itself is
    -- always re-resolved live from the source of truth.
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    visibility TEXT NOT NULL DEFAULT 'unlisted'
        CHECK (visibility IN ('public', 'unlisted', 'private')),
    expires_at TIMESTAMPTZ,
    password TEXT,                        -- reserved (password-protected links)
    allow_anonymous BOOLEAN NOT NULL DEFAULT TRUE,
    total_views INT NOT NULL DEFAULT 0,   -- OG/social page hits
    total_opens INT NOT NULL DEFAULT 0,   -- content actually loaded
    total_attempts INT NOT NULL DEFAULT 0,
    last_viewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- One live share per resource per owner, so re-sharing returns the same link.
CREATE UNIQUE INDEX IF NOT EXISTS idx_shares_owner_content
    ON shares(owner_user_id, content_type, content_id)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_shares_owner ON shares(owner_user_id);

ALTER TABLE shares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own shares" ON shares;
CREATE POLICY "Users can view own shares"
    ON shares FOR SELECT USING (auth.uid() = owner_user_id);
DROP POLICY IF EXISTS "Users can insert own shares" ON shares;
CREATE POLICY "Users can insert own shares"
    ON shares FOR INSERT WITH CHECK (auth.uid() = owner_user_id);
DROP POLICY IF EXISTS "Users can update own shares" ON shares;
CREATE POLICY "Users can update own shares"
    ON shares FOR UPDATE USING (auth.uid() = owner_user_id);

-- Anonymous guest activity on a share (e.g. a guest quiz attempt). Analytics
-- only, no identity; the payload shape is content-type specific.
CREATE TABLE IF NOT EXISTS share_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    share_id UUID NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_share_attempts_share
    ON share_attempts(share_id);

ALTER TABLE share_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners can view guest attempts on their shares" ON share_attempts;
CREATE POLICY "Owners can view guest attempts on their shares"
    ON share_attempts FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM shares s
            WHERE s.id = share_attempts.share_id
            AND s.owner_user_id = auth.uid()
        )
    );

-- Atomic analytics bump (avoids read-modify-write races). The metric name is
-- whitelisted in the CASE arms — unknown metrics are a no-op.
CREATE OR REPLACE FUNCTION increment_share_metric(
    p_share_id UUID, p_metric TEXT
)
RETURNS VOID LANGUAGE SQL AS $$
    UPDATE shares
    SET total_views = total_views
            + CASE WHEN p_metric = 'views' THEN 1 ELSE 0 END,
        total_opens = total_opens
            + CASE WHEN p_metric = 'opens' THEN 1 ELSE 0 END,
        total_attempts = total_attempts
            + CASE WHEN p_metric = 'attempts' THEN 1 ELSE 0 END,
        last_viewed_at = CASE
            WHEN p_metric IN ('views', 'opens') THEN NOW()
            ELSE last_viewed_at END,
        updated_at = NOW()
    WHERE id = p_share_id
      AND p_metric IN ('views', 'opens', 'attempts');
$$;

-- ---------------------------------------------------------------------------
-- Migrate existing quiz shares (012) — tokens survive as share_id so every
-- link already in the wild keeps working.
-- ---------------------------------------------------------------------------

INSERT INTO shares (
    share_id, owner_user_id, content_type, content_id, metadata,
    total_views, total_opens, total_attempts, last_viewed_at, created_at
)
SELECT
    qs.share_token, qs.user_id, 'quiz', qs.quiz_id::text,
    jsonb_build_object(
        'title', q.title,
        'topic', q.topic,
        'difficulty', q.difficulty,
        'question_count',
            (SELECT COUNT(*) FROM quiz_questions qq WHERE qq.quiz_id = q.id),
        'is_exam', COALESCE(q.exam_config ->> 'pattern', '') <> ''
    ),
    qs.open_count, qs.open_count, qs.attempt_count,
    qs.last_opened_at, qs.created_at
FROM quiz_shares qs
JOIN quizzes q ON q.id = qs.quiz_id
WHERE qs.is_active
ON CONFLICT (share_id) DO NOTHING;

-- Migrate existing quiz-result shares (013).
INSERT INTO shares (
    share_id, owner_user_id, content_type, content_id, metadata,
    total_views, total_opens, last_viewed_at, created_at
)
SELECT
    rs.share_token, rs.user_id, 'quiz_result', rs.attempt_id::text,
    jsonb_build_object(
        'title', q.title,
        'topic', q.topic,
        'difficulty', q.difficulty,
        'score', a.score,
        'quiz_id', q.id
    ),
    rs.open_count, rs.open_count, rs.last_opened_at, rs.created_at
FROM quiz_result_shares rs
JOIN quizzes q ON q.id = rs.quiz_id
JOIN quiz_attempts a ON a.id = rs.attempt_id
WHERE rs.is_active
ON CONFLICT (share_id) DO NOTHING;

-- Migrate anonymous guest attempts, re-pointing at the new share rows.
INSERT INTO share_attempts (share_id, metadata, created_at)
SELECT
    s.id,
    jsonb_build_object(
        'score', qsa.score,
        'total', qsa.total,
        'correct_count', qsa.correct_count,
        'completed', qsa.completed
    ),
    qsa.created_at
FROM quiz_share_attempts qsa
JOIN quiz_shares qs ON qs.id = qsa.share_id
JOIN shares s ON s.share_id = qs.share_token;

-- Old feature-specific tables and helpers are fully replaced.
DROP TABLE IF EXISTS quiz_share_attempts;
DROP TABLE IF EXISTS quiz_result_shares;
DROP TABLE IF EXISTS quiz_shares;
DROP FUNCTION IF EXISTS increment_share_open(UUID);
DROP FUNCTION IF EXISTS increment_share_attempt(UUID);
DROP FUNCTION IF EXISTS increment_result_share_open(UUID);

-- ----------------------------------------------------------------------------
-- 015_debug_users.sql
-- ----------------------------------------------------------------------------

-- Developer Mode: per-user debug flag, managed from the Super Admin panel.
-- Debug users see internal diagnostics (model, tool, timings) in the app;
-- normal users never do. Independent of any role — any account can be
-- toggled on temporarily for testing.

alter table public.profiles
  add column if not exists is_debug_user boolean not null default false;

-- The admin panel lists active debug users; keep that lookup cheap.
create index if not exists idx_profiles_is_debug_user
  on public.profiles (is_debug_user)
  where is_debug_user;

-- ----------------------------------------------------------------------------
-- 016_study_spaces.sql
-- ----------------------------------------------------------------------------

-- Study Spaces: subject-centric workspaces that own sessions, media, quizzes,
-- flashcard sets, and bookmarks. Fully opt-in at the product level — every
-- user gets an invisible default "General" space and all existing content is
-- backfilled into it, so the app behaves identically until a user creates a
-- real space. See docs/study-spaces-design.md.

CREATE TABLE IF NOT EXISTS study_spaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    -- App-level palette / icon keys (rendered by the client, free to evolve).
    color TEXT NOT NULL DEFAULT 'brand',
    icon TEXT NOT NULL DEFAULT 'book',
    cover_url TEXT,
    -- The user's General space: created automatically, cannot be deleted.
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    -- Bumped by activity inside the space; drives "Continue Learning" order.
    last_activity_at TIMESTAMPTZ DEFAULT NOW(),
    -- Future per-space settings (AI tone, exam target, memory digest, …).
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_spaces_user
    ON study_spaces(user_id, last_activity_at DESC);
-- Exactly one General space per user.
CREATE UNIQUE INDEX IF NOT EXISTS idx_spaces_one_default
    ON study_spaces(user_id) WHERE is_default;

ALTER TABLE study_spaces ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Scope the four content roots. Children (messages, quiz_questions,
-- flashcards, media_chunks, …) inherit through their parents. Nullable +
-- SET NULL: the app always writes an explicit space_id and reads NULL as the
-- General space; deletion semantics (move vs purge) live in the API, never in
-- a cascade.
-- ---------------------------------------------------------------------------

ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS space_id UUID
    REFERENCES study_spaces(id) ON DELETE SET NULL;
ALTER TABLE media
    ADD COLUMN IF NOT EXISTS space_id UUID
    REFERENCES study_spaces(id) ON DELETE SET NULL;
ALTER TABLE quizzes
    ADD COLUMN IF NOT EXISTS space_id UUID
    REFERENCES study_spaces(id) ON DELETE SET NULL;
ALTER TABLE flashcard_sets
    ADD COLUMN IF NOT EXISTS space_id UUID
    REFERENCES study_spaces(id) ON DELETE SET NULL;
ALTER TABLE bookmarks
    ADD COLUMN IF NOT EXISTS space_id UUID
    REFERENCES study_spaces(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_space
    ON sessions(space_id, updated_at DESC) WHERE space_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_media_space
    ON media(space_id, created_at DESC) WHERE space_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quizzes_space
    ON quizzes(space_id, created_at DESC) WHERE space_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_flashcard_sets_space
    ON flashcard_sets(space_id, created_at DESC) WHERE space_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bookmarks_space
    ON bookmarks(space_id, created_at DESC) WHERE space_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Backfill: one General space per existing user, then file every existing row
-- into it. New users get theirs lazily from the API (idempotent get-or-create).
-- ---------------------------------------------------------------------------

INSERT INTO study_spaces (user_id, name, is_default, icon)
SELECT id, 'General', TRUE, 'sparkles' FROM profiles
ON CONFLICT DO NOTHING;

UPDATE sessions s SET space_id = sp.id
FROM study_spaces sp
WHERE sp.user_id = s.user_id AND sp.is_default AND s.space_id IS NULL;

UPDATE media m SET space_id = sp.id
FROM study_spaces sp
WHERE sp.user_id = m.user_id AND sp.is_default AND m.space_id IS NULL;

UPDATE quizzes q SET space_id = sp.id
FROM study_spaces sp
WHERE sp.user_id = q.user_id AND sp.is_default AND q.space_id IS NULL;

UPDATE flashcard_sets f SET space_id = sp.id
FROM study_spaces sp
WHERE sp.user_id = f.user_id AND sp.is_default AND f.space_id IS NULL;

UPDATE bookmarks b SET space_id = sp.id
FROM study_spaces sp
WHERE sp.user_id = b.user_id AND sp.is_default AND b.space_id IS NULL;

-- ----------------------------------------------------------------------------
-- 017_notes.sql
-- ----------------------------------------------------------------------------

-- AI Notes (Study Spaces Phase 2): user-editable markdown notes, typically
-- saved from an assistant answer and refined over time. Notes are scoped to a
-- Study Space like every other content type; quiz/flashcard generation from a
-- note reuses the existing source_content flow, so no extra columns needed.
--
-- The search_vector mirrors migration 008's pattern; wiring notes into
-- search_all() lands with the unified in-space search (Phase 4).

CREATE TABLE IF NOT EXISTS notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    space_id UUID REFERENCES study_spaces(id) ON DELETE SET NULL,
    title TEXT NOT NULL DEFAULT 'Untitled note',
    -- Markdown body (tables, KaTeX math, code fences — rendered client-side).
    content_md TEXT NOT NULL DEFAULT '',
    -- Where the note came from; 'response' notes keep the message id in
    -- source_ref so "saved from chat" can link back later.
    source_type TEXT NOT NULL DEFAULT 'manual'
        CHECK (source_type IN ('manual', 'response', 'media', 'quiz')),
    source_ref TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notes_user
    ON notes(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_space
    ON notes(space_id, updated_at DESC) WHERE space_id IS NOT NULL;

ALTER TABLE notes
    ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(title, '')), 'A')
        || setweight(to_tsvector('english', coalesce(content_md, '')), 'B')
    ) STORED;
CREATE INDEX IF NOT EXISTS idx_notes_search
    ON notes USING gin (search_vector);

ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 018_search_notes_spaces.sql
-- ----------------------------------------------------------------------------

-- Unified search, Phase 4 of Study Spaces:
--   1. Notes join the ranked cross-content search (their search_vector was
--      created with the table in migration 017).
--   2. `search_all` gains an optional p_space argument so the same function
--      powers both global search (NULL) and in-space search. Messages scope
--      through their session's space; every other table filters directly.
--
-- The old 2-arg signature is dropped (CREATE OR REPLACE with a different
-- signature would otherwise leave a stale overload behind).

DROP FUNCTION IF EXISTS search_all(UUID, TEXT);

CREATE OR REPLACE FUNCTION search_all(
    p_user UUID,
    p_q TEXT,
    p_space UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql STABLE AS $$
    WITH q AS (
        SELECT
            websearch_to_tsquery('english', p_q) AS tsq,
            '%' || p_q || '%' AS ilk
    )
    SELECT jsonb_build_object(
        'sessions', coalesce((
            SELECT jsonb_agg(r) FROM (
                SELECT s.id, s.title, s.updated_at
                FROM sessions s, q
                WHERE s.user_id = p_user
                  AND (p_space IS NULL OR s.space_id = p_space)
                  AND (s.search_vector @@ q.tsq OR s.title ILIKE q.ilk)
                ORDER BY ts_rank(s.search_vector, q.tsq) DESC,
                         s.updated_at DESC
                LIMIT 8
            ) r
        ), '[]'::jsonb),
        'messages', coalesce((
            SELECT jsonb_agg(r) FROM (
                SELECT m.id, m.session_id, m.role, m.content,
                       m.created_at, s.title AS session_title
                FROM messages m
                JOIN sessions s ON s.id = m.session_id, q
                WHERE s.user_id = p_user
                  AND (p_space IS NULL OR s.space_id = p_space)
                  AND (m.search_vector @@ q.tsq OR m.content ILIKE q.ilk)
                ORDER BY ts_rank(m.search_vector, q.tsq) DESC,
                         m.created_at DESC
                LIMIT 12
            ) r
        ), '[]'::jsonb),
        'quizzes', coalesce((
            SELECT jsonb_agg(r) FROM (
                SELECT z.id, z.title, z.topic, z.session_id, z.created_at
                FROM quizzes z, q
                WHERE z.user_id = p_user
                  AND (p_space IS NULL OR z.space_id = p_space)
                  AND (z.search_vector @@ q.tsq
                       OR z.title ILIKE q.ilk OR z.topic ILIKE q.ilk)
                ORDER BY ts_rank(z.search_vector, q.tsq) DESC,
                         z.created_at DESC
                LIMIT 8
            ) r
        ), '[]'::jsonb),
        'media', coalesce((
            SELECT jsonb_agg(r) FROM (
                SELECT md.id, md.file_name, md.mime_type, md.created_at
                FROM media md, q
                WHERE md.user_id = p_user
                  AND (p_space IS NULL OR md.space_id = p_space)
                  AND (md.search_vector @@ q.tsq OR md.file_name ILIKE q.ilk)
                ORDER BY ts_rank(md.search_vector, q.tsq) DESC,
                         md.created_at DESC
                LIMIT 8
            ) r
        ), '[]'::jsonb),
        'flashcards', coalesce((
            SELECT jsonb_agg(r) FROM (
                SELECT f.id, f.title, f.topic, f.created_at
                FROM flashcard_sets f, q
                WHERE f.user_id = p_user
                  AND (p_space IS NULL OR f.space_id = p_space)
                  AND (f.search_vector @@ q.tsq
                       OR f.title ILIKE q.ilk OR f.topic ILIKE q.ilk
                       OR EXISTS (
                           SELECT 1 FROM flashcards c
                           WHERE c.set_id = f.id
                             AND (c.front ILIKE q.ilk OR c.back ILIKE q.ilk)
                       ))
                ORDER BY ts_rank(f.search_vector, q.tsq) DESC,
                         f.created_at DESC
                LIMIT 8
            ) r
        ), '[]'::jsonb),
        'notes', coalesce((
            SELECT jsonb_agg(r) FROM (
                SELECT n.id, n.title,
                       left(n.content_md, 160) AS preview, n.updated_at
                FROM notes n, q
                WHERE n.user_id = p_user
                  AND (p_space IS NULL OR n.space_id = p_space)
                  AND (n.search_vector @@ q.tsq
                       OR n.title ILIKE q.ilk OR n.content_md ILIKE q.ilk)
                ORDER BY ts_rank(n.search_vector, q.tsq) DESC,
                         n.updated_at DESC
                LIMIT 8
            ) r
        ), '[]'::jsonb)
    );
$$;


-- ----------------------------------------------------------------------------
-- 019_revision.sql
-- ----------------------------------------------------------------------------

-- AI Revision Mode (MVP): topic-level spaced repetition. One revision_items
-- row per (user, normalized topic); the schedule is updated inline on quiz
-- submit / flashcard study / confidence report, and seeded lazily from
-- historical quizzes and flashcard reviews the first time a user opens the
-- revision dashboard (profiles.revision_seeded_at marks completion).
--
-- topic_key is computed in Python (lower/trim/collapse whitespace) because
-- items are written through PostgREST upserts which cannot evaluate SQL
-- expressions. revision_events is an append-only audit of schedule changes —
-- flashcard_study is overwrite-only, so this is the only durable history of
-- study signals. Backward compatible: purely additive, existing rows and
-- endpoints are unaffected.

CREATE TABLE IF NOT EXISTS revision_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    -- Latest-seen space for deep-linking only; the item itself is user-global
    -- so the same topic studied across spaces converges on one schedule.
    space_id UUID REFERENCES study_spaces(id) ON DELETE SET NULL,
    topic TEXT NOT NULL,
    topic_key TEXT NOT NULL,
    -- Index into the interval ladder (REVISION_INTERVALS_DAYS, default 1,3,7,14,30).
    strength SMALLINT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'learning'
        CHECK (status IN ('learning', 'reviewing', 'mastered')),
    due_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_reviewed_at TIMESTAMPTZ,
    review_count INT NOT NULL DEFAULT 0,
    last_quiz_score NUMERIC,
    last_quiz_at TIMESTAMPTZ,
    -- Mean batch quality 0-1 (easy=1.0, medium=0.6, hard=0.3, needs_revision=0.0).
    last_flashcard_quality NUMERIC,
    last_flashcard_at TIMESTAMPTZ,
    last_confidence TEXT
        CHECK (last_confidence IN ('confused', 'better', 'mastered')),
    last_confidence_at TIMESTAMPTZ,
    -- Deep links back to the newest source of each kind:
    -- {"quiz_id": ..., "set_id": ..., "session_id": ...}
    sources JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, topic_key)
);

CREATE INDEX IF NOT EXISTS idx_revision_items_user_due
    ON revision_items(user_id, due_at);

CREATE TABLE IF NOT EXISTS revision_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES revision_items(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL
        CHECK (event_type IN ('quiz_attempt', 'flashcard_study', 'confidence', 'backfill')),
    -- Raw signal that moved the schedule, e.g. {"score": 58} or
    -- {"quality": 0.4, "rated": 12} or {"confidence": "better"}.
    signal JSONB NOT NULL DEFAULT '{}'::jsonb,
    strength_before SMALLINT,
    strength_after SMALLINT,
    due_at_after TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_revision_events_user
    ON revision_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_revision_events_item
    ON revision_events(item_id, created_at DESC);

-- Lazy-backfill marker: set once after historical quizzes/flashcards are
-- seeded into revision_items on the user's first dashboard load.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS revision_seeded_at TIMESTAMPTZ;

-- quiz_attempts is only indexed on quiz_id today; backfill and streak
-- computation query it per user in time order.
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user
    ON quiz_attempts(user_id, created_at DESC);

-- RLS is defence-in-depth only: the backend uses the service-role key and
-- enforces ownership by filtering user_id in every query.
ALTER TABLE revision_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE revision_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own revision items" ON revision_items;
CREATE POLICY "Users can manage own revision items" ON revision_items
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage own revision events" ON revision_events;
CREATE POLICY "Users can manage own revision events" ON revision_events
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- 020_feature_flags.sql
-- ----------------------------------------------------------------------------

-- Global feature flags: admin-controlled kill switches for optional features
-- (image generation, revision mode, study spaces, notes, analytics, web
-- search, sharing). The flag REGISTRY (keys, labels, descriptions, defaults)
-- lives in backend code (aeva/feature_flag/feature_flag_service.py); this
-- table stores only OVERRIDES. A missing row means "use the code default"
-- (enabled), so shipping this migration changes nothing until an admin flips
-- a switch. Rows are upserted lazily on the first admin toggle — no seed
-- data, so registry and DB can never drift. Backward compatible: additive.

CREATE TABLE IF NOT EXISTS feature_flags (
    key TEXT PRIMARY KEY,
    enabled BOOLEAN NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only the backend's service-role client touches this table (it bypasses
-- RLS). Enabling RLS with no policies blocks anon/authenticated access
-- entirely — defence in depth, same pattern as prior migrations.
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 021_learning_profile_tutor.sql
-- ----------------------------------------------------------------------------

-- Learning-profile tutor fields: exam target + learning traits (additive).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS exam_target TEXT;
ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS learning_traits JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ----------------------------------------------------------------------------
-- 022_generated_media_ready.sql
-- ----------------------------------------------------------------------------

-- Repair Aeva-generated images stuck at 'pending' (they skip the parse
-- pipeline; new rows are inserted as 'ready').
UPDATE media
SET processing_status = 'ready'
WHERE storage_path LIKE '%/generated/%'
  AND processing_status = 'pending';
