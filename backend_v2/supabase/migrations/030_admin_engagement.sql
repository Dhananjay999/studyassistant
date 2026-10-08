-- Admin dashboard engagement: a daily active/new user timeline and
-- returning-user (retention) rates, computed in one index-backed query.
--
-- Everything is bounded by a time window so the cost does not grow with the
-- total size of the tables: the function reads only the rows written in the
-- last GREATEST(p_days, p_cohort_days) days (sessions via
-- idx_sessions_updated_at, messages via idx_messages_created_at, profiles via
-- idx_profiles_created_at from 031). At millions of users the 30-day message
-- range is still the heaviest part; if the dashboard call grows slow, the
-- `activity` CTE is the thing to replace with a nightly (user_id, day) rollup.
--
-- "Activity" on a calendar day (UTC, like the overview's New Today counter)
-- is: the user created or touched a chat session that day, or sent a message
-- that day. "Returned" means activity on a later day than the signup day.
--
-- HOW TO APPLY: this file is plain transactional DDL. Apply 031 after it,
-- following the instructions in that file (CREATE INDEX CONCURRENTLY).

CREATE OR REPLACE FUNCTION admin_engagement(
    p_days INTEGER DEFAULT 7,
    p_cohort_days INTEGER DEFAULT 30
)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public
AS $$
WITH params AS (
    SELECT
        GREATEST(LEAST(COALESCE(p_days, 7), 90), 1) AS days,
        GREATEST(LEAST(COALESCE(p_cohort_days, 30), 365), 1) AS cohort_days,
        (NOW() AT TIME ZONE 'UTC')::date AS today
),
bounds AS (
    SELECT
        today,
        today - (days - 1) AS window_start,
        today - cohort_days AS cohort_start,
        -- Earliest row we need to read: the start of whichever range is longer.
        ((today - GREATEST(days - 1, cohort_days))::timestamp
            AT TIME ZONE 'UTC') AS scan_from
    FROM params
),
-- One row per (user, UTC day) with any product activity since scan_from.
-- updated_at >= created_at always, so one range scan on updated_at covers
-- both the session's creation day and its last-touched day.
activity AS (
    SELECT s.user_id, (s.created_at AT TIME ZONE 'UTC')::date AS day
    FROM sessions s, bounds b
    WHERE s.updated_at >= b.scan_from
    UNION
    SELECT s.user_id, (s.updated_at AT TIME ZONE 'UTC')::date AS day
    FROM sessions s, bounds b
    WHERE s.updated_at >= b.scan_from
    UNION
    SELECT s.user_id, (m.created_at AT TIME ZONE 'UTC')::date AS day
    FROM messages m
    JOIN sessions s ON s.id = m.session_id, bounds b
    WHERE m.created_at >= b.scan_from
      AND m.role = 'user'
),
signups AS (
    SELECT p.id AS user_id, (p.created_at AT TIME ZONE 'UTC')::date AS day
    FROM profiles p, bounds b
    WHERE p.created_at >= b.scan_from
),
-- Timeline: one row per day in the window, including days with no activity.
days AS (
    SELECT generate_series(b.window_start, b.today, INTERVAL '1 day')::date AS day
    FROM bounds b
),
active_by_day AS (
    SELECT a.day, COUNT(DISTINCT a.user_id) AS active_users
    FROM activity a, bounds b
    WHERE a.day >= b.window_start
    GROUP BY a.day
),
new_by_day AS (
    SELECT s.day, COUNT(*) AS new_users
    FROM signups s, bounds b
    WHERE s.day >= b.window_start
    GROUP BY s.day
),
daily AS (
    SELECT
        d.day,
        COALESCE(ab.active_users, 0) AS active_users,
        COALESCE(nb.new_users, 0) AS new_users
    FROM days d
    LEFT JOIN active_by_day ab ON ab.day = d.day
    LEFT JOIN new_by_day nb ON nb.day = d.day
),
-- Window split: of everyone active in the window, who signed up inside it
-- (new) and who signed up before it (returning).
window_users AS (
    SELECT
        a.user_id,
        COALESCE(BOOL_OR(s.day >= b.window_start), FALSE) AS is_new
    FROM activity a
    CROSS JOIN bounds b
    LEFT JOIN signups s ON s.user_id = a.user_id
    WHERE a.day >= b.window_start
    GROUP BY a.user_id
),
-- Retention cohort: users who signed up in the last cohort_days days and at
-- least one full day ago, so each has had a chance to come back.
cohort AS (
    SELECT s.user_id, s.day AS signup_day
    FROM signups s, bounds b
    WHERE s.day >= b.cohort_start
      AND s.day < b.today
),
cohort_flags AS (
    SELECT
        c.user_id,
        c.signup_day + 7 <= b.today AS eligible_d7,
        COALESCE(BOOL_OR(a.day > c.signup_day), FALSE) AS returned_any,
        COALESCE(BOOL_OR(a.day = c.signup_day + 1), FALSE) AS returned_d1,
        COALESCE(BOOL_OR(a.day > c.signup_day
                         AND a.day <= c.signup_day + 7), FALSE) AS returned_d7
    FROM cohort c
    CROSS JOIN bounds b
    LEFT JOIN activity a ON a.user_id = c.user_id
    GROUP BY c.user_id, c.signup_day, b.today
)
SELECT jsonb_build_object(
    'days', (SELECT days FROM params),
    'daily', (
        SELECT COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'day', to_char(day, 'YYYY-MM-DD'),
                    'active_users', active_users,
                    'new_users', new_users
                )
                ORDER BY day
            ),
            '[]'::jsonb
        )
        FROM daily
    ),
    'window', (
        SELECT jsonb_build_object(
            'active_users', COUNT(*),
            'new_users', COUNT(*) FILTER (WHERE is_new),
            'returning_users', COUNT(*) FILTER (WHERE NOT is_new)
        )
        FROM window_users
    ),
    'retention', (
        SELECT jsonb_build_object(
            'cohort_days', (SELECT cohort_days FROM params),
            'cohort_size', COUNT(*),
            'returned_any', COUNT(*) FILTER (WHERE returned_any),
            'returned_d1', COUNT(*) FILTER (WHERE returned_d1),
            'eligible_d7', COUNT(*) FILTER (WHERE eligible_d7),
            'returned_d7', COUNT(*) FILTER (WHERE eligible_d7 AND returned_d7)
        )
        FROM cohort_flags
    )
);
$$;

-- Admin-only: the backend calls this with the service-role key. Keep it off
-- the public PostgREST surface (RLS would hide other users' rows anyway, but
-- there is no reason for app clients to be able to call it at all).
REVOKE EXECUTE ON FUNCTION admin_engagement(INTEGER, INTEGER)
    FROM PUBLIC, anon, authenticated;
