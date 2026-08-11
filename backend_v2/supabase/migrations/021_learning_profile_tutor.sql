-- Learning-profile tutor fields: exam target + learning traits.
-- exam_target (e.g. "JEE", "NEET", "Boards") lets answers and quiz/flashcard
-- generation adapt to the student's exam level. learning_traits is a small
-- whitelisted JSON of learning preferences (likes_funny_examples,
-- likes_visual_explanations, preferred_depth, wants_concept_check_questions,
-- curiosity_level) — learning-related data only, never personal/sensitive.
-- Backward compatible: additive columns, no backfill; missing values render
-- as "absent" in every existing code path.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS exam_target TEXT;
ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS learning_traits JSONB NOT NULL DEFAULT '{}'::jsonb;
