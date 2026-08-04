-- AI Revision Mode (MVP): topic-level spaced repetition. One revision_items
-- row per (user, normalized topic); the schedule is updated inline on quiz
-- submit / flashcard study / confidence report, and seeded lazily from
-- historical quizzes and flashcard reviews the first time a user opens the
-- revision dashboard (profiles.revision_seeded_at marks completion).
--
-- topic_key is computed in Python (lower/trim/collapse whitespace) because
-- items are written through PostgREST upserts which cannot evaluate SQL
-- expressions. revision_events is an append-only audit of schedule changes —
-- flashcard_study is overwrite-only, so this is the only durable history of
-- study signals. Backward compatible: purely additive, existing rows and
-- endpoints are unaffected.

CREATE TABLE IF NOT EXISTS revision_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    -- Latest-seen space for deep-linking only; the item itself is user-global
    -- so the same topic studied across spaces converges on one schedule.
    space_id UUID REFERENCES study_spaces(id) ON DELETE SET NULL,
    topic TEXT NOT NULL,
    topic_key TEXT NOT NULL,
    -- Index into the interval ladder (REVISION_INTERVALS_DAYS, default 1,3,7,14,30).
    strength SMALLINT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'learning'
        CHECK (status IN ('learning', 'reviewing', 'mastered')),
    due_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_reviewed_at TIMESTAMPTZ,
    review_count INT NOT NULL DEFAULT 0,
    last_quiz_score NUMERIC,
    last_quiz_at TIMESTAMPTZ,
    -- Mean batch quality 0-1 (easy=1.0, medium=0.6, hard=0.3, needs_revision=0.0).
    last_flashcard_quality NUMERIC,
    last_flashcard_at TIMESTAMPTZ,
    last_confidence TEXT
        CHECK (last_confidence IN ('confused', 'better', 'mastered')),
    last_confidence_at TIMESTAMPTZ,
    -- Deep links back to the newest source of each kind:
    -- {"quiz_id": ..., "set_id": ..., "session_id": ...}
    sources JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, topic_key)
);

CREATE INDEX IF NOT EXISTS idx_revision_items_user_due
    ON revision_items(user_id, due_at);

CREATE TABLE IF NOT EXISTS revision_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    item_id UUID NOT NULL REFERENCES revision_items(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL
        CHECK (event_type IN ('quiz_attempt', 'flashcard_study', 'confidence', 'backfill')),
    -- Raw signal that moved the schedule, e.g. {"score": 58} or
    -- {"quality": 0.4, "rated": 12} or {"confidence": "better"}.
    signal JSONB NOT NULL DEFAULT '{}'::jsonb,
    strength_before SMALLINT,
    strength_after SMALLINT,
    due_at_after TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_revision_events_user
    ON revision_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_revision_events_item
    ON revision_events(item_id, created_at DESC);

-- Lazy-backfill marker: set once after historical quizzes/flashcards are
-- seeded into revision_items on the user's first dashboard load.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS revision_seeded_at TIMESTAMPTZ;

-- quiz_attempts is only indexed on quiz_id today; backfill and streak
-- computation query it per user in time order.
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_user
    ON quiz_attempts(user_id, created_at DESC);

-- RLS is defence-in-depth only: the backend uses the service-role key and
-- enforces ownership by filtering user_id in every query.
ALTER TABLE revision_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE revision_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own revision items" ON revision_items;
CREATE POLICY "Users can manage own revision items" ON revision_items
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage own revision events" ON revision_events;
CREATE POLICY "Users can manage own revision events" ON revision_events
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
