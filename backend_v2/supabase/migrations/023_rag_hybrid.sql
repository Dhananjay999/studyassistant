-- Hybrid retrieval for the media RAG layer: keyword search fused with vector
-- search, an exact-scan path for small filtered sets, contextual chunk
-- headers, and neighbour lookups.
--
-- Why: pgvector's HNSW index finds the nearest `hnsw.ef_search` (40) chunks
-- across ALL users first and only then applies the user/media filter, so a
-- filtered search can return fewer than `match_count` rows — often zero — as
-- the table grows. The app surfaced that as "couldn't find that in your
-- materials". Pure dense search also misses exact tokens (acronyms, codes,
-- names), which the tsvector column covers.
--
-- Additive and idempotent, like the earlier migrations. vector(768) stays in
-- lock-step with RAG_EMBEDDING_DIM and migration 007; `match_media_chunks`
-- is kept as the fallback the app uses until this migration is applied.

-- Contextual header ("file › section › page", embedded with the content from
-- embedding_version 2 on) and the version that lets a re-index target rows
-- still on the old embedding text.
ALTER TABLE media_chunks
    ADD COLUMN IF NOT EXISTS context TEXT,
    ADD COLUMN IF NOT EXISTS embedding_version SMALLINT NOT NULL DEFAULT 1;

-- Full-text projection: the section breadcrumb (weight A) outranks the body
-- (weight B). Generated + stored, so every existing row is covered with no
-- backfill.
ALTER TABLE media_chunks
    ADD COLUMN IF NOT EXISTS search_vector tsvector
        GENERATED ALWAYS AS (
            setweight(to_tsvector('english', coalesce(section, '')), 'A') ||
            setweight(to_tsvector('english', coalesce(content, '')), 'B')
        ) STORED;

CREATE INDEX IF NOT EXISTS idx_media_chunks_search
    ON media_chunks USING gin (search_vector);

-- Neighbour lookups (chunk_index ± 1) and the exact-scan scope.
CREATE INDEX IF NOT EXISTS idx_media_chunks_media_chunk
    ON media_chunks (media_id, chunk_index);

-- Hybrid search: vector top-N ∪ keyword top-N, fused with Reciprocal Rank
-- Fusion. When the scoped set (user + optional media subset) is small, the
-- HNSW index is bypassed (bitmap scan on the btree + exact distance sort) so
-- the filter can never starve the result; otherwise ef_search is raised.
-- plpgsql (not STABLE sql) so set_config(..., is_local => true) applies for
-- the RPC's transaction only.
CREATE OR REPLACE FUNCTION search_media_chunks(
    query_embedding vector(768),
    p_user_id UUID,
    p_media_ids UUID[] DEFAULT NULL,
    p_query TEXT DEFAULT NULL,
    match_count INT DEFAULT 8,
    p_vector_candidates INT DEFAULT 24,
    p_fts_candidates INT DEFAULT 24,
    p_rrf_k INT DEFAULT 60,
    p_exact_scan_max INT DEFAULT 5000,
    p_ef_search INT DEFAULT 100
)
RETURNS TABLE (
    id UUID,
    media_id UUID,
    chunk_index INT,
    content TEXT,
    page_number INT,
    section TEXT,
    similarity FLOAT,
    fts_rank FLOAT,
    vector_rank INT,
    text_rank INT,
    rrf_score FLOAT,
    exact_scan BOOLEAN
)
LANGUAGE plpgsql AS $$
DECLARE
    scoped BIGINT := 0;
    use_exact BOOLEAN := FALSE;
    tsq tsquery := NULL;
BEGIN
    SELECT count(*) INTO scoped
      FROM media_chunks c
     WHERE c.user_id = p_user_id
       AND (p_media_ids IS NULL OR c.media_id = ANY(p_media_ids));
    use_exact := scoped <= p_exact_scan_max;

    IF use_exact THEN
        -- Bitmap scans stay enabled, so the btree on media_id/user_id still
        -- narrows the rows; only the (post-filtered) HNSW probe is avoided.
        PERFORM set_config('enable_indexscan', 'off', true);
    ELSE
        PERFORM set_config('hnsw.ef_search', p_ef_search::text, true);
    END IF;

    IF coalesce(p_query, '') <> '' THEN
        tsq := websearch_to_tsquery('english', p_query);
    END IF;

    RETURN QUERY
    WITH scope AS (
        SELECT c.id, c.media_id, c.chunk_index, c.content, c.page_number,
               c.section, c.embedding, c.search_vector
          FROM media_chunks c
         WHERE c.user_id = p_user_id
           AND (p_media_ids IS NULL OR c.media_id = ANY(p_media_ids))
    ),
    vec AS (
        SELECT s.id,
               row_number() OVER (
                   ORDER BY s.embedding <=> query_embedding
               ) AS r
          FROM scope s
         ORDER BY s.embedding <=> query_embedding
         LIMIT p_vector_candidates
    ),
    fts AS (
        SELECT s.id,
               ts_rank_cd(s.search_vector, tsq) AS rank,
               row_number() OVER (
                   ORDER BY ts_rank_cd(s.search_vector, tsq) DESC
               ) AS r
          FROM scope s
         WHERE tsq IS NOT NULL AND s.search_vector @@ tsq
         ORDER BY ts_rank_cd(s.search_vector, tsq) DESC
         LIMIT p_fts_candidates
    ),
    fused AS (
        SELECT coalesce(v.id, f.id) AS cid,
               v.r AS vr,
               f.r AS tr,
               f.rank AS frank,
               coalesce(1.0 / (p_rrf_k + v.r), 0)
                 + coalesce(1.0 / (p_rrf_k + f.r), 0) AS score
          FROM vec v
          FULL OUTER JOIN fts f ON v.id = f.id
    )
    SELECT c.id,
           c.media_id,
           c.chunk_index,
           c.content,
           c.page_number,
           c.section,
           (1 - (c.embedding <=> query_embedding))::float AS similarity,
           f.frank::float AS fts_rank,
           f.vr::int AS vector_rank,
           f.tr::int AS text_rank,
           f.score::float AS rrf_score,
           use_exact AS exact_scan
      FROM fused f
      JOIN media_chunks c ON c.id = f.cid
     ORDER BY f.score DESC, c.media_id, c.chunk_index
     LIMIT match_count;
END;
$$;
