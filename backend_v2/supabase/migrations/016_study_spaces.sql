-- Study Spaces: subject-centric workspaces that own sessions, media, quizzes,
-- flashcard sets, and bookmarks. Fully opt-in at the product level — every
-- user gets an invisible default "General" space and all existing content is
-- backfilled into it, so the app behaves identically until a user creates a
-- real space. See docs/study-spaces-design.md.

CREATE TABLE IF NOT EXISTS study_spaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    -- App-level palette / icon keys (rendered by the client, free to evolve).
    color TEXT NOT NULL DEFAULT 'brand',
    icon TEXT NOT NULL DEFAULT 'book',
    cover_url TEXT,
    -- The user's General space: created automatically, cannot be deleted.
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    -- Bumped by activity inside the space; drives "Continue Learning" order.
    last_activity_at TIMESTAMPTZ DEFAULT NOW(),
    -- Future per-space settings (AI tone, exam target, memory digest, …).
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_spaces_user
    ON study_spaces(user_id, last_activity_at DESC);
-- Exactly one General space per user.
CREATE UNIQUE INDEX IF NOT EXISTS idx_spaces_one_default
    ON study_spaces(user_id) WHERE is_default;

ALTER TABLE study_spaces ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Scope the four content roots. Children (messages, quiz_questions,
-- flashcards, media_chunks, …) inherit through their parents. Nullable +
-- SET NULL: the app always writes an explicit space_id and reads NULL as the
-- General space; deletion semantics (move vs purge) live in the API, never in
-- a cascade.
-- ---------------------------------------------------------------------------

ALTER TABLE sessions
    ADD COLUMN IF NOT EXISTS space_id UUID
    REFERENCES study_spaces(id) ON DELETE SET NULL;
ALTER TABLE media
    ADD COLUMN IF NOT EXISTS space_id UUID
    REFERENCES study_spaces(id) ON DELETE SET NULL;
ALTER TABLE quizzes
    ADD COLUMN IF NOT EXISTS space_id UUID
    REFERENCES study_spaces(id) ON DELETE SET NULL;
ALTER TABLE flashcard_sets
    ADD COLUMN IF NOT EXISTS space_id UUID
    REFERENCES study_spaces(id) ON DELETE SET NULL;
ALTER TABLE bookmarks
    ADD COLUMN IF NOT EXISTS space_id UUID
    REFERENCES study_spaces(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_space
    ON sessions(space_id, updated_at DESC) WHERE space_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_media_space
    ON media(space_id, created_at DESC) WHERE space_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quizzes_space
    ON quizzes(space_id, created_at DESC) WHERE space_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_flashcard_sets_space
    ON flashcard_sets(space_id, created_at DESC) WHERE space_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bookmarks_space
    ON bookmarks(space_id, created_at DESC) WHERE space_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Backfill: one General space per existing user, then file every existing row
-- into it. New users get theirs lazily from the API (idempotent get-or-create).
-- ---------------------------------------------------------------------------

INSERT INTO study_spaces (user_id, name, is_default, icon)
SELECT id, 'General', TRUE, 'sparkles' FROM profiles
ON CONFLICT DO NOTHING;

UPDATE sessions s SET space_id = sp.id
FROM study_spaces sp
WHERE sp.user_id = s.user_id AND sp.is_default AND s.space_id IS NULL;

UPDATE media m SET space_id = sp.id
FROM study_spaces sp
WHERE sp.user_id = m.user_id AND sp.is_default AND m.space_id IS NULL;

UPDATE quizzes q SET space_id = sp.id
FROM study_spaces sp
WHERE sp.user_id = q.user_id AND sp.is_default AND q.space_id IS NULL;

UPDATE flashcard_sets f SET space_id = sp.id
FROM study_spaces sp
WHERE sp.user_id = f.user_id AND sp.is_default AND f.space_id IS NULL;

UPDATE bookmarks b SET space_id = sp.id
FROM study_spaces sp
WHERE sp.user_id = b.user_id AND sp.is_default AND b.space_id IS NULL;
