-- Aeva Pro Early Access: plan state on the profile row (2026-10-23).
--
-- Aeva is free today, and every user is on the "Pro" experience. These
-- columns record that as a plan so that Free vs Pro limits, paid
-- subscriptions and monthly/yearly billing can be added later without
-- re-shaping the schema:
--
--   plan              'free' | 'pro'                          (the tier)
--   plan_status       'none' | 'early_access' | 'active' | 'past_due'
--                     | 'canceled' | 'expired'                (the lifecycle)
--   pro_activated_at  when the user first activated Pro (NULL = never)
--   pro_prompt_shown  the Pro introduction popup has been shown once; the
--                     client never shows it again (dismissed or activated)
--
-- Today: every account starts as plan='free' / plan_status='none' and
-- becomes plan='pro' / plan_status='early_access' when the user taps
-- "Activate Pro — ₹0" (aeva/plan). No limits, no payment. A billing
-- integration later adds its own columns (interval, provider ids, renews_at)
-- and moves plan_status to 'active'.
--
-- Safety on a large live table: each ADD COLUMN carries a constant DEFAULT,
-- which Postgres 11+ stores in the catalog without rewriting rows. The
-- CHECK constraints are added NOT VALID and validated afterwards. Note that
-- Supabase runs a migration file in one transaction, so the ACCESS EXCLUSIVE
-- lock from ADD CONSTRAINT is held until commit, i.e. through the VALIDATE
-- scan. On `profiles` (one row per user) that scan is milliseconds; on a
-- table with millions of rows, put the VALIDATE statements in a follow-up
-- migration so the scan runs under its own SHARE UPDATE EXCLUSIVE lock. No
-- index: the columns are read by primary key with the rest of the profile
-- (/auth/me selects *), never filtered on. Expected growth: none (one row
-- per user, already there).
--
-- Rollback:
--   ALTER TABLE public.profiles
--       DROP COLUMN plan, DROP COLUMN plan_status,
--       DROP COLUMN pro_activated_at, DROP COLUMN pro_prompt_shown;

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free',
    ADD COLUMN IF NOT EXISTS plan_status TEXT NOT NULL DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS pro_activated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS pro_prompt_shown BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_plan_check
    CHECK (plan IN ('free', 'pro')) NOT VALID;

ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_plan_status_check
    CHECK (
        plan_status IN (
            'none', 'early_access', 'active', 'past_due', 'canceled', 'expired'
        )
    ) NOT VALID;

ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_plan_check;
ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_plan_status_check;

COMMENT ON COLUMN public.profiles.plan IS
    'Plan tier: free | pro. Pro is free during Early Access (aeva/plan).';
COMMENT ON COLUMN public.profiles.plan_status IS
    'Plan lifecycle: none | early_access | active | past_due | canceled | expired.';
COMMENT ON COLUMN public.profiles.pro_activated_at IS
    'When the user first activated Pro (Early Access or paid). NULL = never.';
COMMENT ON COLUMN public.profiles.pro_prompt_shown IS
    'The Pro introduction popup was shown once (activated or dismissed); never show it again.';
