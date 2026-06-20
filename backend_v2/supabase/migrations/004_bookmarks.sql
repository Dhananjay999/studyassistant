-- Bookmark collections (folders). Every user gets a default "Favorites".
CREATE TABLE IF NOT EXISTS bookmark_collections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT 'Favorites',
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bookmark_collections_user ON bookmark_collections(user_id);

ALTER TABLE bookmark_collections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own collections"
    ON bookmark_collections FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own collections"
    ON bookmark_collections FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own collections"
    ON bookmark_collections FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own collections"
    ON bookmark_collections FOR DELETE
    USING (auth.uid() = user_id);

-- Bookmarks. Store a content snapshot so a bookmark survives deletion of the
-- source message/quiz/media. item_ref holds the source id when known (quiz_id,
-- media id, or message id) for rendering the bookmarked state on the client.
CREATE TABLE IF NOT EXISTS bookmarks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    collection_id UUID REFERENCES bookmark_collections(id) ON DELETE SET NULL,
    item_type TEXT NOT NULL
        CHECK (item_type IN ('response', 'quiz', 'media', 'note')),
    item_ref TEXT,
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_bookmarks_user ON bookmarks(user_id);
CREATE INDEX idx_bookmarks_user_collection ON bookmarks(user_id, collection_id);

ALTER TABLE bookmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own bookmarks"
    ON bookmarks FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own bookmarks"
    ON bookmarks FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own bookmarks"
    ON bookmarks FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own bookmarks"
    ON bookmarks FOR DELETE
    USING (auth.uid() = user_id);
