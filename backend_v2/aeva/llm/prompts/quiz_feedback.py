"""Post-quiz feedback contract: template + structured-output schema.

``QUIZ_FEEDBACK_TEMPLATE`` below IS the prompt the model receives; the shared
``{QUIZ_RESULTS}`` block lives in ``quiz_common`` (also used by the analysis
template). ``QUIZ_FEEDBACK_SCHEMA`` is provider-independent so the feedback
structure stays stable across models/vendors.
"""

from aeva.llm.prompts.blocks import SYSTEM_PROMPT_BLOCK
from aeva.llm.prompts.builder import PromptTemplate
from aeva.llm.prompts.quiz_common import QUIZ_RESULTS_BLOCK

QUIZ_FEEDBACK_TEMPLATE = PromptTemplate(
    name="quiz_feedback",
    system="{SYSTEM_PROMPT}{USER_PROFILE}",
    user=(
        "A student completed a quiz. Give learning feedback as Aeva.\n\n"
        "{QUIZ_RESULTS}\n\n"
        "Write encouraging, specific feedback: explain each mistake, name "
        "the weak topics behind them, and suggest concrete study "
        "recommendations. Reference the actual questions; keep each item "
        "short.\n"
    ),
    defaults={
        "SYSTEM_PROMPT": SYSTEM_PROMPT_BLOCK,
        "QUIZ_RESULTS": QUIZ_RESULTS_BLOCK,
    },
    optional=("USER_PROFILE",),
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
