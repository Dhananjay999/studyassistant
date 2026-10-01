-- AI execution traces: what actually happened while answering one message.
-- One `ai_traces` row per turn, one `ai_trace_spans` row per step (routing
-- decision, prompt build, LLM call with its full input and output, tool run,
-- retrieval), and `ai_prompt_versions` for every distinct prompt template
-- text that ever ran. Read by Admin → Traces / Prompt map.
--
-- The backend records a turn in memory and writes it here in one batch AFTER
-- the answer was delivered, so the chat tables and the user-facing request
-- are untouched. Rows hold full prompts, user messages, and retrieved
-- document excerpts: they cascade with the user / session, and are trimmed by
-- `purge_ai_traces` (Admin → Traces → Purge, or a scheduled job).
--
-- Backend-only (service role): RLS is enabled with no policies, like
-- admin_audit_log. Backward compatible: additive. Until this is applied the
-- backend detects the missing tables and simply skips tracing.

CREATE TABLE IF NOT EXISTS ai_traces (
    -- Minted by the backend at turn start (also stamped on the assistant
    -- message as metadata.trace_id), so there is no default.
    id UUID PRIMARY KEY,
    -- 'chat_turn' today; room for other traced flows.
    kind TEXT NOT NULL DEFAULT 'chat_turn',
    user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
    session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
    -- orchestration_runs id linking a clarification question to its reply.
    run_id UUID,
    user_message_id UUID,
    assistant_message_id UUID,
    -- Which route served the turn: 'stream' | 'sync'.
    endpoint TEXT,
    -- completed | partial (answered, but a step failed or timed out) |
    -- clarification | quiz_setup | error | aborted
    status TEXT NOT NULL DEFAULT 'completed',
    error TEXT,
    -- The user's message (truncated), for the list view and text search.
    query TEXT,
    -- How the plan was chosen: forced | media_choice | continuation |
    -- fast_path | planner | planner+media_guard.
    plan_source TEXT,
    -- run_tool | clarify
    plan_action TEXT,
    tools TEXT[] NOT NULL DEFAULT '{}',
    models TEXT[] NOT NULL DEFAULT '{}',
    -- Prompt templates rendered during the turn ("where is this prompt used").
    prompt_names TEXT[] NOT NULL DEFAULT '{}',
    span_count INTEGER NOT NULL DEFAULT 0,
    llm_calls INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Deployed commit, when the platform exposes it.
    git_sha TEXT,
    meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_traces_created
    ON ai_traces(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_traces_session
    ON ai_traces(session_id, created_at DESC)
    WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_traces_user
    ON ai_traces(user_id, created_at DESC)
    WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_traces_assistant_message
    ON ai_traces(assistant_message_id)
    WHERE assistant_message_id IS NOT NULL;
-- With these two, "search by any id" (an OR over the six id columns) can
-- use an index for every branch instead of scanning the table.
CREATE INDEX IF NOT EXISTS idx_ai_traces_user_message
    ON ai_traces(user_message_id)
    WHERE user_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_traces_run
    ON ai_traces(run_id)
    WHERE run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ai_traces_prompt_names
    ON ai_traces USING GIN (prompt_names);
CREATE INDEX IF NOT EXISTS idx_ai_traces_tools
    ON ai_traces USING GIN (tools);

CREATE TABLE IF NOT EXISTS ai_trace_spans (
    id UUID PRIMARY KEY,
    trace_id UUID NOT NULL REFERENCES ai_traces(id) ON DELETE CASCADE,
    -- Parent span within the same trace (NULL for the root 'turn' span).
    parent_id UUID,
    -- Creation order within the trace; siblings are displayed in this order.
    seq INTEGER NOT NULL,
    -- turn | context | router | decision | tool | prompt | llm | embedding |
    -- retrieval | persist
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    -- ok | error | aborted | timeout | skipped | unfinished
    status TEXT NOT NULL DEFAULT 'ok',
    -- Offset from the start of the trace, and how long the step took.
    start_ms INTEGER NOT NULL DEFAULT 0,
    duration_ms INTEGER,
    -- Set on llm / embedding spans.
    provider TEXT,
    model TEXT,
    -- Set on prompt spans and on the llm span that sent that prompt.
    -- prompt_hash is the template's content hash: its version.
    prompt_name TEXT,
    prompt_hash TEXT,
    input JSONB,
    output JSONB,
    meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_trace_spans_trace
    ON ai_trace_spans(trace_id, seq);
CREATE INDEX IF NOT EXISTS idx_ai_trace_spans_prompt
    ON ai_trace_spans(prompt_name, created_at DESC)
    WHERE kind = 'prompt';

-- Every distinct template text that has run, keyed by its content hash.
-- Lets Admin show which version of a prompt a trace used and when a prompt
-- last changed, without depending on git.
CREATE TABLE IF NOT EXISTS ai_prompt_versions (
    name TEXT NOT NULL,
    hash TEXT NOT NULL,
    system_template TEXT NOT NULL DEFAULT '',
    user_template TEXT NOT NULL DEFAULT '',
    -- Shared blocks the template embeds (placeholder name -> block text).
    defaults JSONB NOT NULL DEFAULT '{}'::jsonb,
    git_sha TEXT,
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (name, hash)
);

ALTER TABLE ai_traces ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_trace_spans ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_prompt_versions ENABLE ROW LEVEL SECURITY;

-- Per-prompt usage over the last p_days days, one row per (name, version).
CREATE OR REPLACE FUNCTION ai_prompt_usage(p_days INTEGER DEFAULT 7)
RETURNS TABLE (
    prompt_name TEXT,
    prompt_hash TEXT,
    uses BIGINT,
    traces BIGINT,
    first_used TIMESTAMPTZ,
    last_used TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        s.prompt_name,
        s.prompt_hash,
        COUNT(*) AS uses,
        COUNT(DISTINCT s.trace_id) AS traces,
        MIN(s.created_at) AS first_used,
        MAX(s.created_at) AS last_used
    FROM ai_trace_spans s
    WHERE s.kind = 'prompt'
      AND s.prompt_name IS NOT NULL
      AND s.created_at >= NOW() - make_interval(days => GREATEST(p_days, 1))
    GROUP BY s.prompt_name, s.prompt_hash
    ORDER BY s.prompt_name, MAX(s.created_at) DESC;
$$;

-- Retention: delete traces older than p_days days (spans cascade). Returns
-- how many traces were removed. There is no scheduler in this deployment, so
-- run it from Admin → Traces → Purge, or schedule it where pg_cron is on:
--   SELECT cron.schedule('purge-ai-traces', '0 3 * * *',
--                        $$SELECT purge_ai_traces(30)$$);
CREATE OR REPLACE FUNCTION purge_ai_traces(p_days INTEGER DEFAULT 30)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    removed INTEGER;
BEGIN
    DELETE FROM ai_traces
    WHERE created_at < NOW() - make_interval(days => GREATEST(p_days, 1));
    GET DIAGNOSTICS removed = ROW_COUNT;
    RETURN removed;
END;
$$;
