-- Exam Prep: the lesson Aeva teaches for a topic (markdown), generated lazily
-- the first time the student opens the topic page and cached on the row.
-- Both columns are nullable, so ADD COLUMN is metadata-only (no rewrite).
-- Applied to the production project on 2026-10-05.
ALTER TABLE exam_plan_topics ADD COLUMN IF NOT EXISTS lesson_md TEXT;
ALTER TABLE exam_plan_topics ADD COLUMN IF NOT EXISTS lesson_generated_at TIMESTAMPTZ;
