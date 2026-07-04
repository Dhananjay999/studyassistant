-- Persist a quiz's exam configuration (Exam Mode).
--
-- A quiz can optionally simulate a competitive exam (JEE, NEET, SSC, UPSC, ...)
-- with a marking scheme (+correct / -negative / skip marks) and a timer. The
-- whole scheme lives in one JSONB blob so new fields need no schema churn:
--
--   { "pattern": "neet", "correct": 4, "negative": -1, "skip": 0,
--     "timer_seconds": 10800 }
--
-- An empty object ('{}') means an ordinary practice quiz (no marking, no timer),
-- so existing rows keep their current accuracy-only behavior.

ALTER TABLE quizzes
    ADD COLUMN IF NOT EXISTS exam_config JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Existing RLS policies on `quizzes` already cover this column.
