-- Orchestration runs (clarification state)
CREATE TABLE IF NOT EXISTS orchestration_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'awaiting_clarification',
    plan JSONB DEFAULT '{}',
    original_message TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_orchestration_runs_session ON orchestration_runs(session_id);
CREATE INDEX idx_orchestration_runs_user ON orchestration_runs(user_id);

ALTER TABLE orchestration_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own orchestration runs"
    ON orchestration_runs FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own orchestration runs"
    ON orchestration_runs FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own orchestration runs"
    ON orchestration_runs FOR UPDATE
    USING (auth.uid() = user_id);

-- Quizzes
CREATE TABLE IF NOT EXISTS quizzes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'Quiz',
    topic TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_quizzes_session ON quizzes(session_id);
CREATE INDEX idx_quizzes_user ON quizzes(user_id);

ALTER TABLE quizzes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own quizzes"
    ON quizzes FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own quizzes"
    ON quizzes FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Quiz questions
CREATE TABLE IF NOT EXISTS quiz_questions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('single_select', 'multi_select', 'true_false')),
    prompt TEXT NOT NULL,
    options JSONB NOT NULL DEFAULT '[]',
    correct_answers JSONB NOT NULL DEFAULT '[]',
    explanation TEXT,
    sort_order INT NOT NULL DEFAULT 0
);

CREATE INDEX idx_quiz_questions_quiz ON quiz_questions(quiz_id);

ALTER TABLE quiz_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view questions in own quizzes"
    ON quiz_questions FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM quizzes q
            WHERE q.id = quiz_questions.quiz_id
            AND q.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert questions in own quizzes"
    ON quiz_questions FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM quizzes q
            WHERE q.id = quiz_questions.quiz_id
            AND q.user_id = auth.uid()
        )
    );

-- Quiz attempts
CREATE TABLE IF NOT EXISTS quiz_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quiz_id UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    answers JSONB NOT NULL DEFAULT '{}',
    score FLOAT,
    evaluation JSONB DEFAULT '{}',
    feedback JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_quiz_attempts_quiz ON quiz_attempts(quiz_id);

ALTER TABLE quiz_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own quiz attempts"
    ON quiz_attempts FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own quiz attempts"
    ON quiz_attempts FOR INSERT
    WITH CHECK (auth.uid() = user_id);
