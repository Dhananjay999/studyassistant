"""Shared quiz-result context block for the feedback and analysis templates.

Both post-quiz prompts feed the model the same three things — the quiz, the
student's answers, and the backend's authoritative scoring — with the same
"trust the score, don't re-grade" rule. Defining it once keeps the two prompts
consistent and trims duplicated tokens.

Templates pull it in as the ``{QUIZ_RESULTS}`` shared block; its inner
``{QUIZ_DATA}`` / ``{STUDENT_ANSWERS}`` / ``{EVALUATION}`` placeholders are
supplied at build time by the caller (JSON dumps of the three records).
"""

QUIZ_RESULTS_BLOCK = """Quiz:
{QUIZ_DATA}

Student answers:
{STUDENT_ANSWERS}

Evaluation (backend scored — the source of truth; includes per-question
correctness):
{EVALUATION}

Trust the evaluation for correctness; do not re-grade or re-score."""
