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
