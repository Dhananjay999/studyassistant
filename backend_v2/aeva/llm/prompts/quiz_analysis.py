"""On-demand quiz performance-analysis contract: prompt + output schema.

Used by ``POST /quiz/<id>/analyze``. ``QUIZ_ANALYSIS_SCHEMA`` is
provider-independent so the analysis structure stays stable across
models/vendors. The shared result context lives in ``quiz_common`` (also used
by the feedback prompt).
"""

from aeva.llm.prompts.quiz_common import QUIZ_RESULT_CONTEXT

QUIZ_ANALYSIS_PROMPT = f"""Analyze the student's quiz performance as Aeva.

{QUIZ_RESULT_CONTEXT}

Return a concise, encouraging analysis based only on the quiz results.

Include:
- strengths: concepts the student understands well.
- weaknesses: concepts they struggled with, referencing incorrect questions when relevant.
- common_mistakes: recurring error patterns.
- revise_topics: priority topics or subtopics to review.
- study_plan: ordered, actionable next steps.

Keep every item short, specific, and evidence-based.

If all answers are correct:
- Leave weaknesses, common_mistakes, and revise_topics empty.
- Acknowledge the excellent performance.
- Recommend a more challenging next step in study_plan.
"""

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
