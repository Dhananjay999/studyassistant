-- Admin engagement, part 2: the one index 030's admin_engagement() needs that
-- did not exist yet. `profiles.created_at` serves the "new users per day"
-- timeline, the signup cohort for retention, and the overview's existing
-- "New Today" counter (which scanned the table before this).
--
-- HOW TO APPLY: run AFTER 030_admin_engagement.sql, on its own, OUTSIDE a
-- transaction block (see 028 for why: CREATE INDEX CONCURRENTLY is rejected
-- inside BEGIN/COMMIT, and tools that wrap a file in one implicit transaction
-- would roll it back). If a concurrent build is interrupted it is left
-- INVALID and IF NOT EXISTS then skips it; check with
-- `SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;` and
-- `DROP INDEX CONCURRENTLY IF EXISTS idx_profiles_created_at;` before re-running.
--
-- Until it exists the function is still correct, just slower on profiles.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_created_at
    ON profiles(created_at DESC);
