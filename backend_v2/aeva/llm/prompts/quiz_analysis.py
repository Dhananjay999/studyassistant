"""On-demand quiz performance-analysis contract: prompt + output schema.

Used by ``POST /quiz/<id>/analyze``. ``QUIZ_ANALYSIS_SCHEMA`` is
provider-independent so the analysis structure stays stable across
models/vendors. The shared result context lives in ``quiz_common`` (also used
by the feedback prompt).
"""

from aeva.llm.prompts.quiz_common import QUIZ_RESULT_CONTEXT

QUIZ_ANALYSIS_PROMPT = (
    "A student finished a quiz. Analyse their performance as Aeva.\n\n"
    + QUIZ_RESULT_CONTEXT
    + "\n\nWrite an encouraging, specific analysis grounded in the actual "
    "questions:\n"
    "- strengths: concepts the student clearly understands (what they got "
    "right).\n"
    "- weaknesses: concepts they struggled with (cite the questions they "
    "missed).\n"
    "- common_mistakes: recurring error patterns across the wrong answers.\n"
    "- revise_topics: concrete topics/subtopics to revise next, most "
    "important first.\n"
    "- study_plan: an ordered, actionable step-by-step plan to close the "
    "gaps.\n\n"
    "Keep each item short and concrete. If the student got everything right, "
    "say so and suggest a harder next step instead of inventing weaknesses.\n"
)

# Structured output for on-demand AI performance analysis.
QUIZ_ANALYSIS_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "strengths": {"type": "array", "items": {"type": "string"}},
        "weaknesses": {"type": "array", "items": {"type": "string"}},
        "common_mistakes": {"type": "array", "items": {"type": "string"}},
        "revise_topics": {"type": "array", "items": {"type": "string"}},
        "study_plan": {"type": "array", "items": {"type": "string"}},
    },
    "required": [
        "strengths",
        "weaknesses",
        "common_mistakes",
        "revise_topics",
        "study_plan",
    ],
}
