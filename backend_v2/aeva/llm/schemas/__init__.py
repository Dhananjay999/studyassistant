"""JSON schemas for structured LLM outputs."""

from aeva.llm.schemas.feedback import QUIZ_FEEDBACK_SCHEMA
from aeva.llm.schemas.plan_turn import PLAN_TURN_SCHEMA
from aeva.llm.schemas.quiz import QUIZ_GENERATION_SCHEMA

__all__ = [
    "PLAN_TURN_SCHEMA",
    "QUIZ_GENERATION_SCHEMA",
    "QUIZ_FEEDBACK_SCHEMA",
]
