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
