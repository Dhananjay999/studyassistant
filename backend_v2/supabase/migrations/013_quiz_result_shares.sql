-- Public result sharing: an owner mints one stable share link per quiz
-- ATTEMPT so others can view the scored result (and jump into attempting the
-- same quiz via the quiz-level share). Mirrors 012_quiz_shares.sql.
--
-- The backend connects as the Supabase service role (bypasses RLS), so these
-- policies are defense-in-depth for direct DB access; the app enforces the
-- share token and ownership in Python.

CREATE TABLE IF NOT EXISTS quiz_result_shares (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    share_token TEXT NOT NULL UNIQUE,
    attempt_id UUID NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
    quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    open_count INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_opened_at TIMESTAMPTZ
);

-- At most one share per attempt, so re-sharing returns the same link.
CREATE UNIQUE INDEX IF NOT EXISTS idx_quiz_result_shares_attempt
    ON quiz_result_shares(attempt_id);
CREATE INDEX IF NOT EXISTS idx_quiz_result_shares_user
    ON quiz_result_shares(user_id);

ALTER TABLE quiz_result_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own result shares"
    ON quiz_result_shares FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own result shares"
    ON quiz_result_shares FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Atomic counter bump (avoids read-modify-write races on concurrent opens).
CREATE OR REPLACE FUNCTION increment_result_share_open(p_share_id UUID)
RETURNS VOID LANGUAGE SQL AS $$
    UPDATE quiz_result_shares
    SET open_count = open_count + 1, last_opened_at = NOW()
    WHERE id = p_share_id;
$$;
