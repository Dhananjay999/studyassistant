-- Plan currency (2026-10-23, follow-up to 040).
--
-- Aeva has users outside India, and the Pro introduction shows regional
-- prices: INR for India, USD elsewhere (aeva/plan catalog). The currency a
-- user saw when they activated is recorded here so later surfaces (and a
-- future billing integration) keep quoting the same one, whatever device or
-- locale they use next. NULL = never activated / not recorded.
--
-- Metadata-only: a nullable TEXT column with no default and no index (it is
-- read with the rest of the profile by primary key). The CHECK is added NOT
-- VALID then validated in the same transaction, which holds the ADD
-- CONSTRAINT lock through the scan; fine on `profiles` (one row per user),
-- split into two migrations for a table with millions of rows. No row
-- growth.
--
-- Rollback: ALTER TABLE public.profiles DROP COLUMN currency;

ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS currency TEXT;

ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_currency_check
    CHECK (currency IS NULL OR currency IN ('INR', 'USD')) NOT VALID;

ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_currency_check;

COMMENT ON COLUMN public.profiles.currency IS
    'ISO 4217 currency the user saw when activating Pro (INR | USD). NULL until then.';
