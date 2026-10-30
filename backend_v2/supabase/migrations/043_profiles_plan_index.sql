-- Admin user list: filter by plan tier (2026-10-30).
--
-- GET /admin/users gained `plan=free|pro`, which runs
--   SELECT ... FROM profiles WHERE plan = $1 ORDER BY created_at DESC
--   LIMIT 25 OFFSET n   (plus a COUNT(*) with the same WHERE)
-- optionally combined with the existing personalization_status filter and
-- an ilike search. Migration 040 added `plan` without an index because
-- nothing filtered on it; this composite index serves the WHERE and the
-- default ORDER BY in one pass, so the page is an index range scan instead
-- of a sequential scan plus a sort. Sorting by email / full_name with the
-- filter still uses the index for the WHERE and sorts the matched rows.
--
-- Expected growth: one row per user (profiles), no new rows from this change.
-- Pro is the majority tier during Early Access, so the `free` side is the
-- selective one; the index stays useful once paid plans make `pro` rare.
--
-- HOW TO APPLY: on its own, OUTSIDE a transaction block (see 028 / 031:
-- CREATE INDEX CONCURRENTLY is rejected inside BEGIN/COMMIT). If a
-- concurrent build is interrupted it is left INVALID and IF NOT EXISTS then
-- skips it; check with
-- `SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;` and
-- `DROP INDEX CONCURRENTLY IF EXISTS idx_profiles_plan_created_at;` before
-- re-running. Until it exists the filter is still correct, just slower.
--
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS idx_profiles_plan_created_at;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_plan_created_at
    ON public.profiles (plan, created_at DESC);
