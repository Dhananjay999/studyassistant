-- Idempotent exam-plan creation (2026-10-31).
--
-- POST /exam-prep/plan runs an LLM generation for 1-2.5 minutes. Mobile
-- connections dropped at 52-151 s while the server went on to store the
-- plan; the student saw "offline", pressed Create again, and the new plan
-- archived the one just built (9 of 44 plans in the week of 2026-10-22 were
-- identical duplicates; 10 of 22 students lost progress).
--
-- The client now sends a UUID per attempt (`client_request_id`); the
-- service returns the existing plan for a repeated attempt and the partial
-- unique index below both serves that lookup
--   SELECT * FROM exam_plans WHERE user_id = $1 AND client_request_id = $2
-- and makes two racing requests of one attempt collide instead of both
-- inserting. Partial on NOT NULL so plans created without an id (offer
-- card, older clients) are unaffected.
--
-- Expected growth: one row per plan as today; the index holds one entry
-- per plan created from the setup form (tens per day at current volume).
-- ADD COLUMN (nullable, no default) is catalogue-only: no table rewrite.
--
-- HOW TO APPLY: the index statement must run OUTSIDE a transaction block
-- (CREATE INDEX CONCURRENTLY is rejected inside BEGIN/COMMIT; see 043). If
-- a concurrent build is interrupted it is left INVALID and IF NOT EXISTS
-- then skips it; check with
-- `SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;` and
-- `DROP INDEX CONCURRENTLY IF EXISTS idx_exam_plans_client_request;` before
-- re-running. Until it exists the lookup is correct via
-- idx_exam_plans_user_status (user_id prefix), just slower.
--
-- Rollback:
--   DROP INDEX CONCURRENTLY IF EXISTS idx_exam_plans_client_request;
--   ALTER TABLE public.exam_plans DROP COLUMN IF EXISTS client_request_id;

ALTER TABLE public.exam_plans
    ADD COLUMN IF NOT EXISTS client_request_id UUID;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_exam_plans_client_request
    ON public.exam_plans (user_id, client_request_id)
    WHERE client_request_id IS NOT NULL;
