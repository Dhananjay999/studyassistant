-- Generic sharing platform: ONE table for every shareable resource (quiz,
-- quiz result, and future flashcards/notes/chats/...). A share row never
-- copies content — it points at it via (content_type, content_id) and keeps a
-- small metadata snapshot for link previews. Feature-specific share tables
-- (012/013) are migrated in and dropped.
--
-- The backend connects as the Supabase service role (bypasses RLS), so these
-- policies are defense-in-depth for direct DB access; the app enforces the
-- share id, visibility, and ownership in Python.

CREATE TABLE IF NOT EXISTS shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Public opaque handle used in /share/{share_id} URLs.
    share_id TEXT NOT NULL UNIQUE,
    owner_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    -- App-level enum (quiz, quiz_result, flashcards, note, chat, ...). TEXT so
    -- adding a content type never needs a migration.
    content_type TEXT NOT NULL,
    -- Id of the shared resource in its own table. TEXT for genericity.
    content_id TEXT NOT NULL,
    -- Snapshot for previews/SEO (title, counts, score, ...). Content itself is
    -- always re-resolved live from the source of truth.
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    visibility TEXT NOT NULL DEFAULT 'unlisted'
        CHECK (visibility IN ('public', 'unlisted', 'private')),
    expires_at TIMESTAMPTZ,
    password TEXT,                        -- reserved (password-protected links)
    allow_anonymous BOOLEAN NOT NULL DEFAULT TRUE,
    total_views INT NOT NULL DEFAULT 0,   -- OG/social page hits
    total_opens INT NOT NULL DEFAULT 0,   -- content actually loaded
    total_attempts INT NOT NULL DEFAULT 0,
    last_viewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

-- One live share per resource per owner, so re-sharing returns the same link.
CREATE UNIQUE INDEX IF NOT EXISTS idx_shares_owner_content
    ON shares(owner_user_id, content_type, content_id)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_shares_owner ON shares(owner_user_id);

ALTER TABLE shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own shares"
    ON shares FOR SELECT USING (auth.uid() = owner_user_id);
CREATE POLICY "Users can insert own shares"
    ON shares FOR INSERT WITH CHECK (auth.uid() = owner_user_id);
CREATE POLICY "Users can update own shares"
    ON shares FOR UPDATE USING (auth.uid() = owner_user_id);

-- Anonymous guest activity on a share (e.g. a guest quiz attempt). Analytics
-- only, no identity; the payload shape is content-type specific.
CREATE TABLE IF NOT EXISTS share_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    share_id UUID NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_share_attempts_share
    ON share_attempts(share_id);

ALTER TABLE share_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can view guest attempts on their shares"
    ON share_attempts FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM shares s
            WHERE s.id = share_attempts.share_id
            AND s.owner_user_id = auth.uid()
        )
    );

-- Atomic analytics bump (avoids read-modify-write races). The metric name is
-- whitelisted in the CASE arms — unknown metrics are a no-op.
CREATE OR REPLACE FUNCTION increment_share_metric(
    p_share_id UUID, p_metric TEXT
)
RETURNS VOID LANGUAGE SQL AS $$
    UPDATE shares
    SET total_views = total_views
            + CASE WHEN p_metric = 'views' THEN 1 ELSE 0 END,
        total_opens = total_opens
            + CASE WHEN p_metric = 'opens' THEN 1 ELSE 0 END,
        total_attempts = total_attempts
            + CASE WHEN p_metric = 'attempts' THEN 1 ELSE 0 END,
        last_viewed_at = CASE
            WHEN p_metric IN ('views', 'opens') THEN NOW()
            ELSE last_viewed_at END,
        updated_at = NOW()
    WHERE id = p_share_id
      AND p_metric IN ('views', 'opens', 'attempts');
$$;

-- ---------------------------------------------------------------------------
-- Migrate existing quiz shares (012) — tokens survive as share_id so every
-- link already in the wild keeps working.
-- ---------------------------------------------------------------------------

INSERT INTO shares (
    share_id, owner_user_id, content_type, content_id, metadata,
    total_views, total_opens, total_attempts, last_viewed_at, created_at
)
SELECT
    qs.share_token, qs.user_id, 'quiz', qs.quiz_id::text,
    jsonb_build_object(
        'title', q.title,
        'topic', q.topic,
        'difficulty', q.difficulty,
        'question_count',
            (SELECT COUNT(*) FROM quiz_questions qq WHERE qq.quiz_id = q.id),
        'is_exam', COALESCE(q.exam_config ->> 'pattern', '') <> ''
    ),
    qs.open_count, qs.open_count, qs.attempt_count,
    qs.last_opened_at, qs.created_at
FROM quiz_shares qs
JOIN quizzes q ON q.id = qs.quiz_id
WHERE qs.is_active
ON CONFLICT (share_id) DO NOTHING;

-- Migrate existing quiz-result shares (013).
INSERT INTO shares (
    share_id, owner_user_id, content_type, content_id, metadata,
    total_views, total_opens, last_viewed_at, created_at
)
SELECT
    rs.share_token, rs.user_id, 'quiz_result', rs.attempt_id::text,
    jsonb_build_object(
        'title', q.title,
        'topic', q.topic,
        'difficulty', q.difficulty,
        'score', a.score,
        'quiz_id', q.id
    ),
    rs.open_count, rs.open_count, rs.last_opened_at, rs.created_at
FROM quiz_result_shares rs
JOIN quizzes q ON q.id = rs.quiz_id
JOIN quiz_attempts a ON a.id = rs.attempt_id
WHERE rs.is_active
ON CONFLICT (share_id) DO NOTHING;

-- Migrate anonymous guest attempts, re-pointing at the new share rows.
INSERT INTO share_attempts (share_id, metadata, created_at)
SELECT
    s.id,
    jsonb_build_object(
        'score', qsa.score,
        'total', qsa.total,
        'correct_count', qsa.correct_count,
        'completed', qsa.completed
    ),
    qsa.created_at
FROM quiz_share_attempts qsa
JOIN quiz_shares qs ON qs.id = qsa.share_id
JOIN shares s ON s.share_id = qs.share_token;

-- Old feature-specific tables and helpers are fully replaced.
DROP TABLE IF EXISTS quiz_share_attempts;
DROP TABLE IF EXISTS quiz_result_shares;
DROP TABLE IF EXISTS quiz_shares;
DROP FUNCTION IF EXISTS increment_share_open(UUID);
DROP FUNCTION IF EXISTS increment_share_attempt(UUID);
DROP FUNCTION IF EXISTS increment_result_share_open(UUID);
