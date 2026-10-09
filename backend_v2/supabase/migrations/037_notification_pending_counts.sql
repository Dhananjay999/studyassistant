-- Return hook (product-intelligence R7): the "waiting for you" strip at the
-- top of the chat. It reads state the backend already has
-- (revision_items.due_at, today's exam_plan_days row, quizzes never
-- attempted, flashcard sets never studied). This migration adds one read
-- function and nothing else: no new table, no change to an existing table,
-- no new index.
--
--   notification_digest_counts()  one grouped read that returns, for the
--       given user ids, what each of them has waiting. Called by
--       GET /notifications/pending with one user id.
--
-- ROW GROWTH
--   None. The function only reads.
--
-- QUERY PLAN
--   Every branch filters on user_id = ANY(<= 200 ids) as an index condition,
--   so the cost is bounded by those users' own rows, never by table size:
--     revision_items   -> idx_revision_items_user_due (user_id, due_at)
--     exam_plans       -> idx_exam_plans_one_active (user_id) WHERE active
--     exam_plan_days   -> UNIQUE (plan_id, day_number), <= 60 rows per plan
--     exam_plan_topics -> idx_exam_topics_day (day_id, sort_order)
--     quizzes          -> idx_quizzes_user; quiz_attempts -> idx_quiz_attempts_quiz
--     flashcard_sets   -> idx_flashcard_sets_user;
--     flashcard_study  -> idx_flashcard_study_set
--   No new index is added to an existing table: each lookup is already
--   served, and the created_at filter on quizzes / flashcard_sets runs over
--   one user's rows (tens), which does not justify a second index on the
--   write path.
--
-- HOW TO APPLY: one CREATE FUNCTION, no lock on any table. Until it is
-- applied GET /notifications/pending answers "nothing waiting".

-- What each of the given users has waiting. Only users with at least one
-- thing waiting are returned. Ids and counts only, no titles.
--
--   p_due_before / p_mastered_after  the revision engine's "due" rule
--       (aeva.revision.revision_engine.due_window): an item counts when
--       due_at < p_due_before and it is not "recently mastered". The engine
--       owns the rule and its thresholds; this function only applies the two
--       instants it is given, so the count matches the revision dashboard.
--   p_today   the plan day to look up (exam_plan_days.date).
--   p_since / p_until   a quiz or flashcard set is "waiting" when it was
--       created in [p_since, p_until) and its owner never attempted /
--       studied it. p_until keeps something generated a minute ago from
--       being called "waiting"; p_since lets old leftovers age out.
CREATE OR REPLACE FUNCTION notification_digest_counts(
    p_user_ids UUID[],
    p_today DATE,
    p_due_before TIMESTAMPTZ,
    p_mastered_after TIMESTAMPTZ,
    p_since TIMESTAMPTZ,
    p_until TIMESTAMPTZ
)
RETURNS TABLE (
    user_id UUID,
    revision_due INTEGER,
    plan_id UUID,
    plan_day_id UUID,
    plan_day_number INTEGER,
    plan_total_days INTEGER,
    plan_topics_open INTEGER,
    quizzes_waiting INTEGER,
    quiz_id UUID,
    sets_waiting INTEGER,
    set_id UUID
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
WITH ids AS (
    -- Bounded input: a caller can never make this scan more than 200 users.
    SELECT DISTINCT u.id
    FROM unnest(p_user_ids[1:200]) AS u(id)
),
rev AS (
    SELECT r.user_id AS uid, count(*)::int AS n
    FROM revision_items r
    WHERE r.user_id = ANY(p_user_ids[1:200])
      AND r.due_at < p_due_before
      AND NOT (r.status = 'mastered' AND r.updated_at > p_mastered_after)
    GROUP BY r.user_id
),
plan AS (
    -- At most one active plan per user (idx_exam_plans_one_active) and one
    -- day per date; DISTINCT ON keeps that true even if a plan had two rows
    -- for the same date.
    SELECT DISTINCT ON (ep.user_id)
        ep.user_id AS uid,
        ep.id AS plan_id,
        ep.total_days,
        d.id AS day_id,
        d.day_number,
        (SELECT count(*)::int FROM exam_plan_topics t
          WHERE t.day_id = d.id AND t.status <> 'completed') AS topics_open
    FROM exam_plans ep
    JOIN exam_plan_days d ON d.plan_id = ep.id AND d.date = p_today
    WHERE ep.user_id = ANY(p_user_ids[1:200])
      AND ep.status = 'active'
    ORDER BY ep.user_id, d.day_number
),
quiz AS (
    SELECT
        q.user_id AS uid,
        count(*)::int AS n,
        (array_agg(q.id ORDER BY q.created_at DESC))[1] AS quiz_id
    FROM quizzes q
    WHERE q.user_id = ANY(p_user_ids[1:200])
      AND q.created_at >= p_since
      AND q.created_at < p_until
      AND NOT EXISTS (
          SELECT 1 FROM quiz_attempts a
          WHERE a.quiz_id = q.id AND a.user_id = q.user_id
      )
    GROUP BY q.user_id
),
sets AS (
    SELECT
        s.user_id AS uid,
        count(*)::int AS n,
        (array_agg(s.id ORDER BY s.created_at DESC))[1] AS set_id
    FROM flashcard_sets s
    WHERE s.user_id = ANY(p_user_ids[1:200])
      AND s.created_at >= p_since
      AND s.created_at < p_until
      AND NOT EXISTS (
          SELECT 1 FROM flashcard_study fs
          WHERE fs.set_id = s.id AND fs.user_id = s.user_id
      )
    GROUP BY s.user_id
)
SELECT
    i.id,
    COALESCE(rev.n, 0),
    plan.plan_id,
    plan.day_id,
    plan.day_number,
    plan.total_days,
    COALESCE(plan.topics_open, 0),
    COALESCE(quiz.n, 0),
    quiz.quiz_id,
    COALESCE(sets.n, 0),
    sets.set_id
FROM ids i
LEFT JOIN rev ON rev.uid = i.id
LEFT JOIN plan ON plan.uid = i.id
LEFT JOIN quiz ON quiz.uid = i.id
LEFT JOIN sets ON sets.uid = i.id
WHERE COALESCE(rev.n, 0) > 0
   OR COALESCE(plan.topics_open, 0) > 0
   OR COALESCE(quiz.n, 0) > 0
   OR COALESCE(sets.n, 0) > 0
ORDER BY i.id;
$$;

-- Backend only (service-role key); app clients never call it.
REVOKE EXECUTE ON FUNCTION notification_digest_counts(
    UUID[], DATE, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION notification_digest_counts(
    UUID[], DATE, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ
) TO service_role;
