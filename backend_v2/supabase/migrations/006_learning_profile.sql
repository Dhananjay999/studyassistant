-- Personalized learning profile.
--
-- Stored on `profiles` (one row per user) so it lives alongside the user's
-- identity and entirely separate from chat history. Onboarding is optional:
-- `personalization_status` tracks whether the user finished, skipped, or has
-- not yet seen the welcome flow ('pending' | 'completed' | 'skipped').

ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS education_level TEXT,
    ADD COLUMN IF NOT EXISTS preferred_language TEXT,
    ADD COLUMN IF NOT EXISTS explanation_style TEXT,
    ADD COLUMN IF NOT EXISTS favorite_subjects JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS learning_goal TEXT,
    ADD COLUMN IF NOT EXISTS personalization_status TEXT NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS personalization_updated_at TIMESTAMPTZ;

-- Existing RLS policies on `profiles` (own-row SELECT/UPDATE) already cover
-- these columns, so no new policy is required.
