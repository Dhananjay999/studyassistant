"""Post-quiz feedback contract: prompt + structured-output schema.

``QUIZ_FEEDBACK_SCHEMA`` is provider-independent so the feedback structure
stays stable across models/vendors. The shared result context lives in
``quiz_common`` (also used by the analysis prompt).
"""

from aeva.llm.prompts.quiz_common import QUIZ_RESULT_CONTEXT

QUIZ_FEEDBACK_PROMPT = (
    "A student completed a quiz. Give learning feedback as Aeva.\n\n"
    + QUIZ_RESULT_CONTEXT
    + "\n\nWrite encouraging, specific feedback: explain each mistake, name "
    "the weak topics behind them, and suggest concrete study "
    "recommendations. Reference the actual questions; keep each item short.\n"
)

# Structured output for post-quiz AI feedback.
QUIZ_FEEDBACK_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "weak_topics": {
            "type": "array",
            "items": {"type": "string"},
        },
        "recommendations": {
            "type": "array",
            "items": {"type": "string"},
        },
        "per_question": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "question_id": {"type": "string"},
                    "explanation": {"type": "string"},
                },
                "required": ["question_id", "explanation"],
            },
        },
    },
    "required": ["summary", "weak_topics", "recommendations", "per_question"],
}
