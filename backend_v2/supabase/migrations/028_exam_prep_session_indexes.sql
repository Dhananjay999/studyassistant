-- Exam Prep V1, part 2: indexes on the large, live `sessions` table.
--
-- HOW TO APPLY: run AFTER 027_exam_prep.sql, and run EACH statement on its
-- own, OUTSIDE a transaction block (a separate psql invocation or a separate
-- SQL editor run per statement). CREATE INDEX CONCURRENTLY is rejected inside
-- BEGIN/COMMIT, and tools that wrap a file in one implicit transaction
-- (`supabase db push`, the SQL editor, the MCP apply_migration tool) would
-- roll the whole batch back — which is why these two statements are kept
-- apart from the transactional DDL in 027.
--
-- If a concurrent build fails or is interrupted, Postgres leaves the index
-- behind marked INVALID, and IF NOT EXISTS will then skip it forever. Check
-- with `SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;` and
-- `DROP INDEX CONCURRENTLY IF EXISTS <name>;` before re-running.
--
-- Until these exist the backend is still correct: the `kind = 'chat'` filter
-- on the chat list falls back to idx_sessions_user_id (user_id) plus a sort,
-- as before this feature, and a plan delete's ON DELETE SET NULL scans
-- sessions for the plan id.

-- Reverse lookup plan → its coach session, and the FK's ON DELETE SET NULL.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_exam_plan
    ON sessions(exam_plan_id) WHERE exam_plan_id IS NOT NULL;

-- Chat list / search: the user's plain chats, newest first. Partial on the
-- hot predicate so the index stays as small as the existing one.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_user_kind_updated
    ON sessions(user_id, updated_at DESC) WHERE kind = 'chat';
