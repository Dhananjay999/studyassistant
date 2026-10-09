-- Admin dashboard drill-down: which users are behind the engagement numbers.
--
-- 030/033's admin_engagement() reports how many users were active in the
-- last N days and splits them into "new" (signed up inside the window) and
-- "returning" (signed up before it). This function lists those users, one
-- page at a time, so an admin can tap the figure and see who they are.
--
-- Same window, same timezone rules and the same bounded scan as
-- admin_engagement(): only sessions/messages written since the window's first
-- local midnight are read, through idx_sessions_updated_at and
-- idx_messages_created_at, then grouped per user. profiles is joined only for
-- the users found active (a few thousand rows at most per window at today's
-- size; at millions of users this is the same rollup admin_engagement() would
-- need, see the note in 030).
--
-- Pagination is keyset on (last_active DESC, user_id DESC), so a deep page
-- costs the same as the first; p_limit is capped at 100.
--
-- HOW TO APPLY: plain transactional DDL.

CREATE OR REPLACE FUNCTION admin_engagement_users(
    p_days INTEGER DEFAULT 7,
    p_tz TEXT DEFAULT 'UTC',
    p_kind TEXT DEFAULT 'returning',      -- 'returning' | 'new' | 'active'
    p_limit INTEGER DEFAULT 25,
    p_after_active TIMESTAMPTZ DEFAULT NULL,
    p_after_id UUID DEFAULT NULL
)
RETURNS TABLE (
    user_id UUID,
    last_active TIMESTAMPTZ,
    active_days INTEGER,
    is_new BOOLEAN
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
WITH params AS (
    SELECT
        GREATEST(LEAST(COALESCE(p_days, 7), 90), 1) AS days,
        COALESCE(NULLIF(p_tz, ''), 'UTC') AS tz,
        COALESCE(NULLIF(p_kind, ''), 'returning') AS kind,
        GREATEST(LEAST(COALESCE(p_limit, 25), 100), 1) AS lim
),
bounds AS (
    SELECT
        p.tz,
        -- First local midnight of the window, as an absolute instant.
        (((NOW() AT TIME ZONE p.tz)::date - (p.days - 1))::timestamp
            AT TIME ZONE p.tz) AS scan_from
    FROM params p
),
-- Every activity instant in the window (same definition as admin_engagement).
events AS (
    SELECT s.user_id, s.created_at AS ts
    FROM sessions s, bounds b
    WHERE s.updated_at >= b.scan_from AND s.created_at >= b.scan_from
    UNION ALL
    SELECT s.user_id, s.updated_at AS ts
    FROM sessions s, bounds b
    WHERE s.updated_at >= b.scan_from
    UNION ALL
    SELECT s.user_id, m.created_at AS ts
    FROM messages m
    JOIN sessions s ON s.id = m.session_id, bounds b
    WHERE m.created_at >= b.scan_from
      AND m.role = 'user'
),
per_user AS (
    SELECT
        e.user_id,
        MAX(e.ts) AS last_active,
        COUNT(DISTINCT (e.ts AT TIME ZONE b.tz)::date)::integer AS active_days
    FROM events e, bounds b
    GROUP BY e.user_id
),
split AS (
    SELECT
        u.user_id,
        u.last_active,
        u.active_days,
        COALESCE(p.created_at >= b.scan_from, FALSE) AS is_new
    FROM per_user u
    CROSS JOIN bounds b
    LEFT JOIN profiles p ON p.id = u.user_id
)
SELECT s.user_id, s.last_active, s.active_days, s.is_new
FROM split s, params pr
WHERE (
        pr.kind = 'active'
        OR (pr.kind = 'new' AND s.is_new)
        OR (pr.kind = 'returning' AND NOT s.is_new)
      )
  AND (
        p_after_active IS NULL
        OR (s.last_active, s.user_id) < (p_after_active, p_after_id)
      )
ORDER BY s.last_active DESC, s.user_id DESC
LIMIT (SELECT lim FROM params);
$$;

-- Admin-only, like admin_engagement(): the backend calls it with the
-- service-role key; app clients never need it.
REVOKE EXECUTE ON FUNCTION admin_engagement_users(
    INTEGER, TEXT, TEXT, INTEGER, TIMESTAMPTZ, UUID
) FROM PUBLIC, anon, authenticated;
