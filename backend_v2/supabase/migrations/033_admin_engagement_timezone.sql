-- Admin engagement, part 3: count days in the admin's timezone instead of UTC.
--
-- The dashboard's "New Today" tile and the users-per-day graph bucketed
-- signups and activity by UTC calendar day, while the user list shows joined
-- dates in the browser's local time (IST for our admins). Anyone who signed up
-- between 00:00 and 05:30 IST showed as "today" in the list but "yesterday" in
-- the graph. The function now takes the timezone as a third argument; the
-- backend passes its configured admin timezone (ADMIN_TIMEZONE, default
-- Asia/Kolkata) and uses the same zone for the overview counter.
--
-- The 2-argument form is dropped rather than overloaded: with a defaulted
-- third parameter both signatures would match a 2-argument call and Postgres
-- would reject it as ambiguous. Omitting p_tz keeps the old UTC behaviour.
--
-- Cost is unchanged: the time window is still bounded by scan_from and read
-- through idx_sessions_updated_at, idx_messages_created_at and
-- idx_profiles_created_at (031). Converting a timestamptz to a local date is
-- done per row after the index range scan, exactly as the UTC version did.
--
-- HOW TO APPLY: plain transactional DDL, apply as one statement block.

DROP FUNCTION IF EXISTS admin_engagement(INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION admin_engagement(
    p_days INTEGER DEFAULT 7,
    p_cohort_days INTEGER DEFAULT 30,
    p_tz TEXT DEFAULT 'UTC'
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
        COALESCE(NULLIF(p_tz, ''), 'UTC') AS tz
),
bounds AS (
    SELECT
        p.tz,
        (NOW() AT TIME ZONE p.tz)::date AS today,
        (NOW() AT TIME ZONE p.tz)::date - (p.days - 1) AS window_start,
        (NOW() AT TIME ZONE p.tz)::date - p.cohort_days AS cohort_start,
        -- Earliest row we need to read: local midnight at the start of
        -- whichever range is longer, converted back to an absolute instant.
        (((NOW() AT TIME ZONE p.tz)::date
            - GREATEST(p.days - 1, p.cohort_days))::timestamp
            AT TIME ZONE p.tz) AS scan_from
    FROM params p
),
-- One row per (user, local day) with any product activity since scan_from.
-- updated_at >= created_at always, so one range scan on updated_at covers
-- both the session's creation day and its last-touched day.
activity AS (
    SELECT s.user_id, (s.created_at AT TIME ZONE b.tz)::date AS day
    FROM sessions s, bounds b
    WHERE s.updated_at >= b.scan_from
    UNION
    SELECT s.user_id, (s.updated_at AT TIME ZONE b.tz)::date AS day
    FROM sessions s, bounds b
    WHERE s.updated_at >= b.scan_from
    UNION
    SELECT s.user_id, (m.created_at AT TIME ZONE b.tz)::date AS day
    FROM messages m
    JOIN sessions s ON s.id = m.session_id, bounds b
    WHERE m.created_at >= b.scan_from
      AND m.role = 'user'
),
signups AS (
    SELECT p.id AS user_id, (p.created_at AT TIME ZONE b.tz)::date AS day
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
    'timezone', (SELECT tz FROM params),
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
-- the public PostgREST surface, as 030 did.
REVOKE EXECUTE ON FUNCTION admin_engagement(INTEGER, INTEGER, TEXT)
    FROM PUBLIC, anon, authenticated;
