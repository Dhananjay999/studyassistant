"""Per-capability LLM contracts: prompts, output schemas, and tool params.

Each module groups everything that defines one capability's interaction with
the LLM, so the response contract stays stable when models or providers change.
Names are re-exported here so callers can use ``from aeva.llm import prompts``
and access ``prompts.SYSTEM_PROMPT``, ``prompts.PLAN_TURN_SCHEMA``, etc.
"""

from aeva.llm.prompts.flashcard import (
    FLASHCARD_GENERATION_PROMPT,
    FLASHCARD_GENERATION_SCHEMA,
    FLASHCARD_GENERATOR_PARAMS,
)
from aeva.llm.prompts.media import MEDIA_PARAMS, MEDIA_PROMPT
from aeva.llm.prompts.orchestrator import PLAN_TURN_PROMPT, PLAN_TURN_SCHEMA
from aeva.llm.prompts.personalization import (
    build_personalization_block,
    personalize,
)
from aeva.llm.prompts.quiz import (
    QUIZ_ANALYSIS_PROMPT,
    QUIZ_ANALYSIS_SCHEMA,
    QUIZ_FEEDBACK_PROMPT,
    QUIZ_FEEDBACK_SCHEMA,
    QUIZ_GENERATION_PROMPT,
    QUIZ_GENERATION_SCHEMA,
    QUIZ_GENERATOR_PARAMS,
)
from aeva.llm.prompts.system import SYSTEM_PROMPT
from aeva.llm.prompts.web_search import WEB_SEARCH_PARAMS, WEB_SEARCH_PROMPT

__all__ = [
    "FLASHCARD_GENERATION_PROMPT",
    "FLASHCARD_GENERATION_SCHEMA",
    "FLASHCARD_GENERATOR_PARAMS",
    "MEDIA_PARAMS",
    "MEDIA_PROMPT",
    "PLAN_TURN_PROMPT",
    "PLAN_TURN_SCHEMA",
    "QUIZ_ANALYSIS_PROMPT",
    "QUIZ_ANALYSIS_SCHEMA",
    "QUIZ_FEEDBACK_PROMPT",
    "QUIZ_FEEDBACK_SCHEMA",
    "QUIZ_GENERATION_PROMPT",
    "QUIZ_GENERATION_SCHEMA",
    "QUIZ_GENERATOR_PARAMS",
    "SYSTEM_PROMPT",
    "WEB_SEARCH_PARAMS",
    "WEB_SEARCH_PROMPT",
    "build_personalization_block",
    "personalize",
]
