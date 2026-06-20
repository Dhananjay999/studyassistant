-- Flashcard sets (a generated deck).
CREATE TABLE IF NOT EXISTS flashcard_sets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    title TEXT NOT NULL DEFAULT 'Flashcards',
    topic TEXT NOT NULL DEFAULT '',
    source_type TEXT NOT NULL DEFAULT 'chat'
        CHECK (source_type IN
            ('response', 'media', 'quiz', 'bookmark', 'chat')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_flashcard_sets_user ON flashcard_sets(user_id);

ALTER TABLE flashcard_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own flashcard sets"
    ON flashcard_sets FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own flashcard sets"
    ON flashcard_sets FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own flashcard sets"
    ON flashcard_sets FOR DELETE
    USING (auth.uid() = user_id);

-- Individual cards.
CREATE TABLE IF NOT EXISTS flashcards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    set_id UUID NOT NULL REFERENCES flashcard_sets(id) ON DELETE CASCADE,
    front TEXT NOT NULL,
    back TEXT NOT NULL,
    example TEXT,
    sort_order INT NOT NULL DEFAULT 0
);

CREATE INDEX idx_flashcards_set ON flashcards(set_id);

ALTER TABLE flashcards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view cards in own sets"
    ON flashcards FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM flashcard_sets s
            WHERE s.id = flashcards.set_id AND s.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert cards in own sets"
    ON flashcards FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM flashcard_sets s
            WHERE s.id = flashcards.set_id AND s.user_id = auth.uid()
        )
    );

-- Per-card study ratings (drives analytics).
CREATE TABLE IF NOT EXISTS flashcard_study (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    set_id UUID NOT NULL REFERENCES flashcard_sets(id) ON DELETE CASCADE,
    flashcard_id UUID NOT NULL REFERENCES flashcards(id) ON DELETE CASCADE,
    rating TEXT NOT NULL
        CHECK (rating IN ('easy', 'medium', 'hard', 'needs_revision')),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, flashcard_id)
);

CREATE INDEX idx_flashcard_study_set ON flashcard_study(set_id);

ALTER TABLE flashcard_study ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own study"
    ON flashcard_study FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own study"
    ON flashcard_study FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own study"
    ON flashcard_study FOR UPDATE
    USING (auth.uid() = user_id);

-- Allow bookmarking flashcard sets.
ALTER TABLE bookmarks DROP CONSTRAINT IF EXISTS bookmarks_item_type_check;
ALTER TABLE bookmarks ADD CONSTRAINT bookmarks_item_type_check
    CHECK (item_type IN ('response', 'quiz', 'media', 'note', 'flashcard'));
