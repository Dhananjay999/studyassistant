-- AI personality & communication style.
--
-- Extends the learning profile (stored on `profiles`) with how the assistant
-- should *behave*, distinct from the existing fields that describe the learner:
--   * ai_personality      — a persona/teaching style (Teacher, Mentor, …)
--   * communication_style — answer shape (Short & Direct, Step-by-Step, …)
--   * custom_instructions — free-form long-term preferences from the student.
--
-- All optional; empty means "default assistant behavior", so existing users are
-- unaffected. Existing RLS policies on `profiles` already cover these columns.

ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS ai_personality TEXT,
    ADD COLUMN IF NOT EXISTS communication_style TEXT,
    ADD COLUMN IF NOT EXISTS custom_instructions TEXT;
