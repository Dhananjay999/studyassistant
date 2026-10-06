-- Exam Prep V1: one active exam plan per user; Exam → Days → Subjects → Topics.
-- Lightweight roadmap at setup; per-day detail (exam_plan_days.detail) and
-- quizzes/flashcards (exam_plan_topics.quiz_id/flashcard_set_id) are
-- generated lazily on explicit user action. Progress is per topic
-- (not_started | in_progress | completed). Extensible for adaptive planning
-- later (plan_meta / detail JSONB, status columns) without schema churn.
-- Growth: ~1 plan/user, ≤60 days/plan, ≤~200 topics/plan.
--
-- RELEASE ORDER (read before deploying):
--   1. Apply THIS file (plain transactional DDL; any tool may run it as one
--      batch). It adds `sessions.kind` and `sessions.exam_plan_id`.
--   2. Deploy the backend. The backend filters the chat list and search on
--      `sessions.kind = 'chat'`, so deploying it BEFORE this file breaks
--      GET /sessions and search for every user (42703 column does not
--      exist) — not only Exam Prep users.
--   3. Run 028_exam_prep_session_indexes.sql: the two CREATE INDEX
--      CONCURRENTLY statements on `sessions`, each on its own and outside a
--      transaction. Until they exist the `kind = 'chat'` filter falls back
--      to the existing idx_sessions_user_id index (correct, slightly
--      slower) and a plan delete scans `sessions` for its SET NULL.
--
-- Locks on the large, live `sessions` table: ADD COLUMN ... DEFAULT is
-- metadata-only on PG11+ (no rewrite); the FK is added NOT VALID (no scan
-- under ACCESS EXCLUSIVE) and validated in a separate statement that takes
-- only SHARE UPDATE EXCLUSIVE, so reads and writes keep flowing.
--
-- updated_at: no trigger function exists in migrations 001–026, so
-- `updated_at` is set from application code on every UPDATE.

CREATE TABLE IF NOT EXISTS exam_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'completed', 'archived')),
    exam_name TEXT NOT NULL,
    exam_date DATE NOT NULL,
    class_level TEXT NOT NULL DEFAULT '',
    stream TEXT NOT NULL DEFAULT '',
    subjects JSONB NOT NULL DEFAULT '[]'::jsonb,          -- ["Physics", ...]
    daily_minutes INT NOT NULL DEFAULT 120,
    target_score TEXT,                                     -- optional, free text
    syllabus_text TEXT,                                    -- optional pasted syllabus
    material_media_ids JSONB NOT NULL DEFAULT '[]'::jsonb, -- uploaded media ids
    -- Dedicated Exam Prep conversation (sessions.kind = 'exam_prep').
    session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    total_days INT NOT NULL DEFAULT 0,
    plan_meta JSONB NOT NULL DEFAULT '{}'::jsonb,          -- {summary, strategy_tips[], model, generated_at}
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Dashboard lookup: the user's active plan (also serves "my plans" lists).
CREATE INDEX IF NOT EXISTS idx_exam_plans_user_status
    ON exam_plans(user_id, status, created_at DESC);
-- Invariant: at most one active plan per user (archive before create).
CREATE UNIQUE INDEX IF NOT EXISTS idx_exam_plans_one_active
    ON exam_plans(user_id) WHERE status = 'active';
-- FK index (session → plan reverse lookup).
CREATE INDEX IF NOT EXISTS idx_exam_plans_session
    ON exam_plans(session_id) WHERE session_id IS NOT NULL;
-- Service-role access only (same model as study_spaces / feature_flags):
-- RLS on, no policies, every query filters user_id in the backend.
ALTER TABLE exam_plans ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS exam_plan_days (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL REFERENCES exam_plans(id) ON DELETE CASCADE,
    day_number INT NOT NULL,
    date DATE NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    focus TEXT NOT NULL DEFAULT '',
    detail JSONB,                       -- lazily generated detailed day plan
    detail_generated_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (plan_id, day_number)
);
-- (plan_id, day_number) — the dashboard's "days by plan ordered by
-- day_number" query — is served by the UNIQUE index above (it also covers
-- the plan_id FK).
ALTER TABLE exam_plan_days ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS exam_plan_topics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID NOT NULL REFERENCES exam_plans(id) ON DELETE CASCADE,
    day_id UUID NOT NULL REFERENCES exam_plan_days(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    est_minutes INT NOT NULL DEFAULT 30,
    sort_order INT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'not_started'
        CHECK (status IN ('not_started', 'in_progress', 'completed')),
    status_updated_at TIMESTAMPTZ,
    quiz_id UUID REFERENCES quizzes(id) ON DELETE SET NULL,
    flashcard_set_id UUID REFERENCES flashcard_sets(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Day page: topics of one day in display order (also covers the day_id FK).
CREATE INDEX IF NOT EXISTS idx_exam_topics_day
    ON exam_plan_topics(day_id, sort_order);
-- Dashboard: all topics of a plan + progress counts by status.
CREATE INDEX IF NOT EXISTS idx_exam_topics_plan_status
    ON exam_plan_topics(plan_id, status);
-- FK indexes for the ON DELETE SET NULL links (quiz / set deletion).
CREATE INDEX IF NOT EXISTS idx_exam_topics_quiz
    ON exam_plan_topics(quiz_id) WHERE quiz_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_exam_topics_flashcards
    ON exam_plan_topics(flashcard_set_id) WHERE flashcard_set_id IS NOT NULL;
ALTER TABLE exam_plan_topics ENABLE ROW LEVEL SECURITY;

-- Dedicated conversations: tag the session so the normal chat list never
-- shows it. ADD COLUMN ... DEFAULT is metadata-only on PG11+ (no rewrite);
-- every existing row reads as 'chat', so nothing changes for them.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'chat';
-- Column first, constraint second: an inline REFERENCES would scan the whole
-- sessions table for validation while holding ACCESS EXCLUSIVE, even though
-- every value is NULL. NOT VALID skips that scan; VALIDATE below runs it
-- under SHARE UPDATE EXCLUSIVE (writes are not blocked).
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS exam_plan_id UUID;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'sessions_exam_plan_id_fkey'
          AND conrelid = 'sessions'::regclass
    ) THEN
        ALTER TABLE sessions
            ADD CONSTRAINT sessions_exam_plan_id_fkey
            FOREIGN KEY (exam_plan_id) REFERENCES exam_plans(id)
            ON DELETE SET NULL NOT VALID;
    END IF;
END $$;
ALTER TABLE sessions VALIDATE CONSTRAINT sessions_exam_plan_id_fkey;

-- The indexes that serve `sessions.kind` / `sessions.exam_plan_id` live in
-- 028_exam_prep_session_indexes.sql (CREATE INDEX CONCURRENTLY cannot run
-- inside a transaction block, so they must not share a batch with this file).
