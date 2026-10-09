-- Short-answer quiz questions (product-intelligence R26 / A6-F4).
--
-- Students whose real exams are written asked to practise written answers
-- and have them checked. A quiz question can now be `short_answer`: no
-- options, the student writes one to three sentences, and the answer is
-- graded against a rubric (aeva/quiz/short_answer_grading.py).
--
-- What a short-answer question stores:
--   options         = []                 (existing jsonb column)
--   correct_answers = [model answer]     (existing jsonb column, so the
--                                         answer key / report keep working)
--   rubric          = ["key point", ...] (NEW nullable jsonb, 2-4 points)
-- The grading of each written answer (score, verdict, feedback, matched
-- points) is stored inside the attempt's existing
-- quiz_attempts.evaluation.per_question[].grading jsonb, so quiz_attempts
-- needs no schema change.
--
-- Two changes to quiz_questions, both metadata-only (no table rewrite):
--
--   1. ADD COLUMN rubric JSONB, nullable, no default. Postgres 11+ only
--      updates the catalog; existing rows read NULL. NULL for every
--      selection question, so they cost nothing.
--   2. The CHECK on `type` (quiz_questions_type_check, created inline in
--      003, confirmed by name on production on 2026-10-09) lists only the
--      three selection types, so it is replaced by one that also allows
--      'short_answer'. The new constraint is added NOT VALID, which skips
--      the full-table scan while the ACCESS EXCLUSIVE lock is held, and is
--      validated in PART 2 under SHARE UPDATE EXCLUSIVE, which does not
--      block reads or writes. Every existing row already satisfies it (the
--      old constraint was a subset), so validation cannot fail.
--
-- No index: `rubric` is never filtered, joined or sorted on. It is read
-- only together with the rest of a quiz's questions through the existing
-- idx_quiz_questions_quiz (WHERE quiz_id = ? ORDER BY sort_order), the same
-- query as before, and no RLS policy references it. No new query is
-- introduced, so there is no new plan to check; the read stays
--   Index Scan using idx_quiz_questions_quiz (Index Cond: quiz_id = $1)
--   + in-memory sort on sort_order over at most 25 rows.
--
-- Row growth: none. quiz_questions grows by the questions of each generated
-- quiz as before (739 rows / 58 quizzes on 2026-10-09; at most 25 per
-- quiz). A short-answer row is wider by its rubric: 2-4 points capped at
-- 240 characters each by the backend, so under 1 kB and usually ~200 bytes,
-- stored inline (below the 2 kB TOAST threshold). quiz_attempts rows grow
-- by the grading of each written answer inside `evaluation`: feedback is
-- capped at 600 characters, the answer at 1 000 characters, so at most
-- ~2.5 kB per written answer and ~60 kB for a 25-question attempt in the
-- worst case, typically 5-10 kB. Attempts are one row per submit and are
-- read one at a time by primary key or per quiz (idx_quiz_attempts_quiz),
-- never scanned. Retention: quiz content is user-owned study material that
-- lives as long as the quiz (ON DELETE CASCADE from quizzes / profiles);
-- it is not log data and has no separate expiry.
--
-- Backend: QuizRepository.create sends `rubric` only on short-answer rows
-- (PostgREST rejects an unknown column), so the backend can deploy before
-- this migration without affecting selection quizzes. Creating a
-- short-answer quiz needs PART 1 applied first: until then the old CHECK
-- rejects the row and the request fails. Apply PART 1 before the frontend
-- that offers "Short answer" is released.
--
-- HOW TO APPLY: PART 1 is plain transactional DDL and must run as ONE
-- transaction, so the table is never without a type check. PART 2 is ONE
-- statement to run on its own AFTER PART 1 has committed: inside the same
-- transaction it would run under PART 1's ACCESS EXCLUSIVE lock, which is
-- exactly the long lock NOT VALID is there to avoid. If PART 2 is
-- interrupted, re-run it; it is idempotent.
--
-- Rollback (only while no short_answer row exists):
--   ALTER TABLE public.quiz_questions
--       DROP CONSTRAINT quiz_questions_type_check;
--   ALTER TABLE public.quiz_questions
--       ADD CONSTRAINT quiz_questions_type_check
--       CHECK (type IN ('single_select', 'multi_select', 'true_false'))
--       NOT VALID;
--   ALTER TABLE public.quiz_questions DROP COLUMN rubric;

-- ===========================================================================
-- PART 1 - transactional DDL (metadata-only, safe on a live table)
-- ===========================================================================

BEGIN;

-- Both ALTERs below need a brief ACCESS EXCLUSIVE lock. Give up quickly
-- instead of queueing behind a long-running query (a queued ACCESS
-- EXCLUSIVE request blocks every later reader and writer); just re-run.
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.quiz_questions
    ADD COLUMN IF NOT EXISTS rubric JSONB;

COMMENT ON COLUMN public.quiz_questions.rubric IS
    'short_answer only: JSON array of 2-4 key points the written answer is graded against; NULL for selection questions. The model answer is correct_answers[0].';

ALTER TABLE public.quiz_questions
    DROP CONSTRAINT IF EXISTS quiz_questions_type_check;

ALTER TABLE public.quiz_questions
    ADD CONSTRAINT quiz_questions_type_check
    CHECK (type IN (
        'single_select', 'multi_select', 'true_false', 'short_answer'
    )) NOT VALID;

COMMIT;

-- ===========================================================================
-- PART 2 - run on its own, after PART 1 has committed (see header)
-- ===========================================================================

-- Scans the table once under SHARE UPDATE EXCLUSIVE (reads and writes keep
-- going) and marks the constraint valid. New and updated rows are already
-- checked from PART 1 onwards.
ALTER TABLE public.quiz_questions
    VALIDATE CONSTRAINT quiz_questions_type_check;
