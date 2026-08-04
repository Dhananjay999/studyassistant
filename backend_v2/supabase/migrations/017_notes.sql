-- AI Notes (Study Spaces Phase 2): user-editable markdown notes, typically
-- saved from an assistant answer and refined over time. Notes are scoped to a
-- Study Space like every other content type; quiz/flashcard generation from a
-- note reuses the existing source_content flow, so no extra columns needed.
--
-- The search_vector mirrors migration 008's pattern; wiring notes into
-- search_all() lands with the unified in-space search (Phase 4).

CREATE TABLE IF NOT EXISTS notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    space_id UUID REFERENCES study_spaces(id) ON DELETE SET NULL,
    title TEXT NOT NULL DEFAULT 'Untitled note',
    -- Markdown body (tables, KaTeX math, code fences — rendered client-side).
    content_md TEXT NOT NULL DEFAULT '',
    -- Where the note came from; 'response' notes keep the message id in
    -- source_ref so "saved from chat" can link back later.
    source_type TEXT NOT NULL DEFAULT 'manual'
        CHECK (source_type IN ('manual', 'response', 'media', 'quiz')),
    source_ref TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notes_user
    ON notes(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_space
    ON notes(space_id, updated_at DESC) WHERE space_id IS NOT NULL;

ALTER TABLE notes
    ADD COLUMN IF NOT EXISTS search_vector tsvector
    GENERATED ALWAYS AS (
        setweight(to_tsvector('english', coalesce(title, '')), 'A')
        || setweight(to_tsvector('english', coalesce(content_md, '')), 'B')
    ) STORED;
CREATE INDEX IF NOT EXISTS idx_notes_search
    ON notes USING gin (search_vector);

ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
