-- Analysis data gaps (product-intelligence Appendix C, "G4"):
--
--   * flashcard_study has only updated_at (the LAST rating), so "did the
--     student come back on a later day" could only be measured on the last
--     rating; quiz_questions and flashcards have no timestamp at all, so
--     question/card growth per day is invisible;
--   * messages has no user_id, so every per-user message count has to join
--     through sessions (and a deleted session takes its messages' owner with
--     it).
--
-- This migration only ADDS nullable columns, which is metadata-only on
-- Postgres 11+ (no table rewrite, no long lock): the DEFAULT is attached in
-- a second ALTER so it applies to NEW rows only and existing rows stay NULL
-- (a default on the ADD COLUMN itself would stamp every existing row with
-- the migration time, which would be false data). The backfill below is a
-- plan in comments, run by hand in batches when wanted; nothing here
-- rewrites existing rows.
--
-- Row growth: messages grows with chat use (two rows per turn; ~840 rows for
-- ~100 sessions today, so tens of millions of rows at millions of users);
-- quiz_questions/flashcards grow with every generated quiz/deck (10-40 rows
-- each); flashcard_study is one row per (user, card). The new column is
-- 8 bytes (timestamptz) or 16 bytes (uuid) per row plus the one index.
--
-- Backend: messages.user_id is written on insert by SupabaseService
-- .add_message (orchestrator / exam-prep) once the column exists; until the
-- column exists the backend must not send it (PostgREST would reject the
-- unknown column), hence the column lands first. The write is gated by the
-- backend env flag MESSAGES_USER_ID_ENABLED (default off): set to 1 after
-- migration 036 PART 1 is applied; PostgREST rejects unknown columns.
--
-- HOW TO APPLY: PART 1 is plain transactional DDL. PART 2 is ONE statement
-- to run on its own, OUTSIDE a transaction block (same rules as 028/031/035:
-- CREATE INDEX CONCURRENTLY is rejected inside BEGIN/COMMIT; an interrupted
-- build is left INVALID and IF NOT EXISTS then skips it, check with
-- `SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;`).

-- ===========================================================================
-- PART 1 - transactional DDL (metadata-only, safe on live tables)
-- ===========================================================================

-- When a rating row was first written (updated_at keeps "last rated").
ALTER TABLE public.flashcard_study
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
ALTER TABLE public.flashcard_study
    ALTER COLUMN created_at SET DEFAULT now();

ALTER TABLE public.quiz_questions
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
ALTER TABLE public.quiz_questions
    ALTER COLUMN created_at SET DEFAULT now();

ALTER TABLE public.flashcards
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
ALTER TABLE public.flashcards
    ALTER COLUMN created_at SET DEFAULT now();

-- Owner of the message, denormalised from sessions.user_id so per-user
-- analytics (messages per user per day, first/last message, retention) read
-- one table. No FK constraint on purpose: adding one to a large live table
-- needs a validation scan under lock (it could be added later as
-- ADD CONSTRAINT ... NOT VALID followed by VALIDATE CONSTRAINT), and the
-- value is set by the backend from the session row, which is FK-checked.
ALTER TABLE public.messages
    ADD COLUMN IF NOT EXISTS user_id UUID;

COMMENT ON COLUMN public.messages.user_id IS
    'Owner (sessions.user_id) copied at insert; NULL on rows older than migration 036 until backfilled.';
COMMENT ON COLUMN public.flashcard_study.created_at IS
    'First rating time; NULL on rows older than migration 036 (updated_at is the last rating).';

-- ===========================================================================
-- PART 2 - run on its own, outside a transaction (see header)
-- ===========================================================================

-- Serves: messages per user in a window (WHERE user_id = ? AND created_at
-- >= ?), a user's first/last message (ORDER BY created_at), and the admin
-- engagement rollups once they switch from the sessions join to this
-- column. Partial on NOT NULL so the pre-backfill rows cost nothing.
-- Expected plan: Index Scan using idx_messages_user_created
--   (Index Cond: user_id = $1 AND created_at >= $2).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_user_created
    ON public.messages(user_id, created_at DESC) WHERE user_id IS NOT NULL;

-- ===========================================================================
-- BACKFILL PLAN (not executed here; run by hand, batch by batch, off-peak)
-- ===========================================================================
--
-- Each batch touches at most 5 000 rows by primary key so no statement holds
-- row locks for long and autovacuum keeps up. Repeat each UPDATE until it
-- reports 0 rows. All four are idempotent (they only touch rows still NULL).
--
-- 1. messages.user_id from the owning session (idx_messages_session_id and
--    sessions_pkey serve the join; the NULL filter keeps re-scans short once
--    idx_messages_user_created exists only for NOT NULL rows, so add a
--    temporary index if the table is already large:
--      CREATE INDEX CONCURRENTLY idx_messages_user_null_tmp
--          ON public.messages(id) WHERE user_id IS NULL;
--      ... backfill ...
--      DROP INDEX CONCURRENTLY idx_messages_user_null_tmp;)
--
--      UPDATE public.messages m
--         SET user_id = s.user_id
--        FROM public.sessions s
--       WHERE m.id IN (SELECT id FROM public.messages
--                       WHERE user_id IS NULL LIMIT 5000)
--         AND s.id = m.session_id;
--
-- 2. quiz_questions.created_at from the quiz (same instant for the whole
--    quiz, which is how they are generated):
--
--      UPDATE public.quiz_questions qq
--         SET created_at = q.created_at
--        FROM public.quizzes q
--       WHERE qq.id IN (SELECT id FROM public.quiz_questions
--                        WHERE created_at IS NULL LIMIT 5000)
--         AND q.id = qq.quiz_id;
--
-- 3. flashcards.created_at from the set:
--
--      UPDATE public.flashcards f
--         SET created_at = fs.created_at
--        FROM public.flashcard_sets fs
--       WHERE f.id IN (SELECT id FROM public.flashcards
--                       WHERE created_at IS NULL LIMIT 5000)
--         AND fs.id = f.set_id;
--
-- 4. flashcard_study.created_at: the first rating time is not recorded
--    anywhere, so the best available value is updated_at (an UPPER bound:
--    the row was created on or before its last rating). Mark it in the
--    analysis as "created_at <= backfilled value" for rows older than 036.
--
--      UPDATE public.flashcard_study
--         SET created_at = updated_at
--       WHERE id IN (SELECT id FROM public.flashcard_study
--                     WHERE created_at IS NULL LIMIT 5000);
--
-- After the backfill, messages.user_id could be made NOT NULL in the usual
-- three steps (ADD CONSTRAINT ... CHECK (user_id IS NOT NULL) NOT VALID;
-- VALIDATE CONSTRAINT; ALTER COLUMN SET NOT NULL) if the analytics ever
-- needs the guarantee; the three created_at columns stay nullable because
-- their pre-036 values are estimates.
