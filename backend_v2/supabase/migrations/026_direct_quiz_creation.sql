-- Quizzes can now be created directly from the Quizzes page, outside of any
-- chat session (flashcard_sets.session_id has always been nullable).
-- Chat-created quizzes keep their session and still cascade with it.
ALTER TABLE quizzes ALTER COLUMN session_id DROP NOT NULL;
