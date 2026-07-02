-- Persist a quiz's difficulty on the quiz row.
--
-- Difficulty is chosen at generation time (defaulting to "medium") but was
-- previously only returned inline by the quiz tool and never stored. Persisting
-- it lets the quizzes list show difficulty for every card without re-opening
-- each quiz. Existing rows are backfilled to "medium".

ALTER TABLE quizzes
    ADD COLUMN IF NOT EXISTS difficulty TEXT NOT NULL DEFAULT 'medium';

-- Existing RLS policies on `quizzes` already cover this column.
