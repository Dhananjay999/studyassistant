-- Public quiz sharing: an owner mints one stable share link per quiz; anyone
-- can open it and attempt the quiz with no account. Guest attempts are stored
-- anonymously (no user_id / PII) for owner-facing analytics.
--
-- The backend connects as the Supabase service role (bypasses RLS), so these
-- policies are defense-in-depth for direct DB access; the app enforces the
-- share token and ownership in Python.

-- One share record per quiz (reused link). The opaque token is the only thing
-- a public visitor needs; it never exposes the quiz UUID or owner.
CREATE TABLE IF NOT EXISTS quiz_shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    share_token TEXT NOT NULL UNIQUE,
    quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    open_count INT NOT NULL DEFAULT 0,
    attempt_count INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_opened_at TIMESTAMPTZ
);

-- At most one share per quiz, so re-sharing returns the same link.
CREATE UNIQUE INDEX IF NOT EXISTS idx_quiz_shares_quiz ON quiz_shares(quiz_id);
CREATE INDEX IF NOT EXISTS idx_quiz_shares_user ON quiz_shares(user_id);

ALTER TABLE quiz_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own quiz shares"
    ON quiz_shares FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own quiz shares"
    ON quiz_shares FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Anonymous guest attempts on a shared quiz — analytics only, no identity.
CREATE TABLE IF NOT EXISTS quiz_share_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    share_id UUID NOT NULL REFERENCES quiz_shares(id) ON DELETE CASCADE,
    quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    score FLOAT,
    total INT,
    correct_count INT,
    completed BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quiz_share_attempts_share
    ON quiz_share_attempts(share_id);

ALTER TABLE quiz_share_attempts ENABLE ROW LEVEL SECURITY;

-- Only the quiz owner (via the parent share) may read guest attempts.
CREATE POLICY "Owners can view guest attempts on their shares"
    ON quiz_share_attempts FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM quiz_shares s
            WHERE s.id = quiz_share_attempts.share_id
            AND s.user_id = auth.uid()
        )
    );

-- Atomic counter bumps (avoid read-modify-write races on concurrent opens).
CREATE OR REPLACE FUNCTION increment_share_open(p_share_id UUID)
RETURNS VOID LANGUAGE SQL AS $$
    UPDATE quiz_shares
    SET open_count = open_count + 1, last_opened_at = NOW()
    WHERE id = p_share_id;
$$;

CREATE OR REPLACE FUNCTION increment_share_attempt(p_share_id UUID)
RETURNS VOID LANGUAGE SQL AS $$
    UPDATE quiz_shares
    SET attempt_count = attempt_count + 1
    WHERE id = p_share_id;
$$;
