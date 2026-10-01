-- Learning profile → one JSONB document.
--
-- Every learning-profile field moves from its own column into
-- `profiles.learning_profile`, the same document the branching onboarding,
-- Settings, admin and the prompt builder all read and write:
--
--   {
--     "version": 2,
--     "context": { "type": "college", "degree": "B.Tech / B.E.", "year": "3rd Year" },
--     "goal": "Prepare for placements",
--     "focus_areas": ["Data Structures", "System Design"],
--     "explanation_style": "Step-by-Step",
--     "response_language": "Hinglish",        -- Aeva's replies only, not the UI
--     "ai_personality": "Mentor",
--     "communication_style": "Short & Direct",
--     "custom_instructions": "…",
--     "learning_traits": { "likes_funny_examples": true }
--   }
--
-- context.type is one of school | college | competitive_exam | skill_learning
-- | working_professional | other; the other context keys hold display labels
-- (class, board, degree, year, exam, skill, other). Empty fields are omitted;
-- '{}' means "nothing set".
--
-- Existing users are converted into exactly this shape, so old and new
-- profiles behave the same:
--   * education_level from the old flat onboarding becomes a context
--     ("B.Tech" → college / "B.Tech / B.E.", "JEE" → competitive_exam / JEE,
--     "Class 11–12" → school / "Class 11–12"); unrecognised text becomes
--     { "type": "other", "other": <text> }.
--   * exam_target joins the context for exam aspirants; for anyone else a
--     real exam (not "Boards"/"None") becomes the goal when none is set.
--   * favorite_subjects → focus_areas, preferred_language → response_language,
--     learning_goal → goal; the rest keep their names.
--
-- personalization_status / personalization_updated_at stay columns: they are
-- onboarding state (auth payload, admin filters), not profile data.
--
-- The old values are copied to profiles_learning_backup_025 (service role
-- only) before the columns are dropped. Rollback = restore from that table.

BEGIN;

-- Present only on databases that ran an earlier draft of this migration.
ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS learning_context JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 1. Backup of every value about to move.
CREATE TABLE IF NOT EXISTS profiles_learning_backup_025 AS
SELECT
    id,
    education_level,
    preferred_language,
    explanation_style,
    favorite_subjects,
    learning_goal,
    exam_target,
    learning_traits,
    ai_personality,
    communication_style,
    custom_instructions,
    learning_context,
    now() AS backed_up_at
FROM profiles;

-- Not readable through the public API (RLS on, no policies).
ALTER TABLE profiles_learning_backup_025 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON profiles_learning_backup_025 FROM anon, authenticated;

-- 2. The document column.
ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS learning_profile JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 3. Convert every row.
WITH legacy_level (level_key, context) AS (
    VALUES
        ('school (class 6–8)', '{"type": "school", "class": "Class 6–8"}'::jsonb),
        ('class 9–10', '{"type": "school", "class": "Class 9–10"}'),
        ('class 11–12', '{"type": "school", "class": "Class 11–12"}'),
        ('diploma', '{"type": "college", "degree": "Diploma"}'),
        ('b.tech', '{"type": "college", "degree": "B.Tech / B.E."}'),
        ('b.sc', '{"type": "college", "degree": "B.Sc"}'),
        ('m.tech', '{"type": "college", "degree": "M.Tech"}'),
        ('mba', '{"type": "college", "degree": "MBA"}'),
        ('upsc', '{"type": "competitive_exam", "exam": "UPSC"}'),
        ('ssc', '{"type": "competitive_exam", "exam": "SSC"}'),
        ('jee', '{"type": "competitive_exam", "exam": "JEE"}'),
        ('neet', '{"type": "competitive_exam", "exam": "NEET"}'),
        ('working professional', '{"type": "working_professional"}')
),
src AS (
    SELECT
        p.id,
        NULLIF(btrim(p.education_level), '') AS level,
        NULLIF(btrim(p.exam_target), '') AS exam,
        NULLIF(btrim(p.learning_goal), '') AS goal,
        CASE
            WHEN p.learning_context ? 'type' THEN p.learning_context - 'version'
        END AS onboarded_context,
        p.favorite_subjects,
        NULLIF(btrim(p.explanation_style), '') AS explanation_style,
        NULLIF(btrim(p.preferred_language), '') AS response_language,
        NULLIF(btrim(p.ai_personality), '') AS ai_personality,
        NULLIF(btrim(p.communication_style), '') AS communication_style,
        NULLIF(btrim(p.custom_instructions), '') AS custom_instructions,
        p.learning_traits
    FROM profiles p
),
resolved AS (
    SELECT
        s.*,
        COALESCE(
            s.onboarded_context,
            l.context,
            CASE WHEN s.level IS NOT NULL
                THEN jsonb_build_object('type', 'other', 'other', s.level)
            END,
            CASE WHEN lower(s.exam) IN ('jee', 'neet', 'upsc')
                THEN jsonb_build_object('type', 'competitive_exam', 'exam', s.exam)
            END,
            '{}'::jsonb
        ) AS base_context
    FROM src s
    LEFT JOIN legacy_level l ON l.level_key = lower(s.level)
),
contexts AS (
    SELECT
        r.*,
        CASE
            -- Exam aspirants keep the exam inside their context.
            WHEN r.base_context ->> 'type' = 'competitive_exam'
                 AND NOT r.base_context ? 'exam'
                 AND r.exam IS NOT NULL
                THEN r.base_context || jsonb_build_object('exam', r.exam)
            ELSE r.base_context
        END AS context,
        CASE
            WHEN r.goal IS NOT NULL THEN r.goal
            -- Anyone else with a real target exam: keep it as the goal.
            WHEN r.base_context ->> 'type' IS DISTINCT FROM 'competitive_exam'
                 AND r.exam IS NOT NULL
                 AND lower(r.exam) NOT IN ('none', 'boards')
                THEN 'Preparing for ' || r.exam
        END AS final_goal
    FROM resolved r
),
documents AS (
    SELECT
        c.id,
        jsonb_strip_nulls(jsonb_build_object(
            'context', NULLIF(c.context, '{}'::jsonb),
            'goal', c.final_goal,
            'focus_areas', CASE
                WHEN jsonb_typeof(c.favorite_subjects) = 'array'
                     AND jsonb_array_length(c.favorite_subjects) > 0
                    THEN c.favorite_subjects
            END,
            'explanation_style', c.explanation_style,
            'response_language', c.response_language,
            'ai_personality', c.ai_personality,
            'communication_style', c.communication_style,
            'custom_instructions', c.custom_instructions,
            'learning_traits', NULLIF(c.learning_traits, '{}'::jsonb)
        )) AS doc
    FROM contexts c
)
UPDATE profiles p
SET learning_profile = CASE
    WHEN d.doc = '{}'::jsonb THEN '{}'::jsonb
    ELSE d.doc || '{"version": 2}'::jsonb
END
FROM documents d
WHERE d.id = p.id;

-- 4. Drop the old columns.
ALTER TABLE profiles
    DROP COLUMN IF EXISTS education_level,
    DROP COLUMN IF EXISTS preferred_language,
    DROP COLUMN IF EXISTS explanation_style,
    DROP COLUMN IF EXISTS favorite_subjects,
    DROP COLUMN IF EXISTS learning_goal,
    DROP COLUMN IF EXISTS exam_target,
    DROP COLUMN IF EXISTS learning_traits,
    DROP COLUMN IF EXISTS ai_personality,
    DROP COLUMN IF EXISTS communication_style,
    DROP COLUMN IF EXISTS custom_instructions,
    DROP COLUMN IF EXISTS learning_context;

COMMIT;
