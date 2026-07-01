"""Shared quiz-result context for the feedback and analysis prompts.

Both post-quiz prompts feed the model the same three things — the quiz, the
student's answers, and the backend's authoritative scoring — with the same
"trust the score, don't re-grade" rule. Defining it once keeps the two prompts
consistent and trims duplicated tokens.
"""

# Formatted with quiz / answers / evaluation by each prompt's caller.
QUIZ_RESULT_CONTEXT = """Quiz:
{quiz}

Student answers:
{answers}

Evaluation (backend scored — the source of truth; includes per-question
correctness):
{evaluation}

Trust the evaluation for correctness; do not re-grade or re-score."""
