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
from aeva.llm.prompts.media import (
    MEDIA_PARAMS,
    MEDIA_PROMPT,
    NO_CONTEXT_MESSAGE,
    NO_MEDIA_MESSAGE,
)
from aeva.llm.prompts.orchestrator import (
    PLAN_SYSTEM_PROMPT,
    PLAN_TURN_PROMPT,
    PLAN_TURN_SCHEMA,
)
from aeva.llm.prompts.personalization import (
    build_personalization_block,
    personalize,
)
from aeva.llm.prompts.quiz_analysis import (
    QUIZ_ANALYSIS_PROMPT,
    QUIZ_ANALYSIS_SCHEMA,
)
from aeva.llm.prompts.quiz_feedback import (
    QUIZ_FEEDBACK_PROMPT,
    QUIZ_FEEDBACK_SCHEMA,
)
from aeva.llm.prompts.quiz_generation import (
    QUIZ_GENERATION_PROMPT,
    QUIZ_GENERATION_SCHEMA,
    QUIZ_GENERATOR_PARAMS,
)
from aeva.llm.prompts.response_meta import (
    ANSWER_META_INSTRUCTION,
    META_SENTINEL,
)
from aeva.llm.prompts.system import SYSTEM_PROMPT
from aeva.llm.prompts.web_search import WEB_SEARCH_PARAMS, WEB_SEARCH_PROMPT

__all__ = [
    "ANSWER_META_INSTRUCTION",
    "FLASHCARD_GENERATION_PROMPT",
    "FLASHCARD_GENERATION_SCHEMA",
    "FLASHCARD_GENERATOR_PARAMS",
    "MEDIA_PARAMS",
    "MEDIA_PROMPT",
    "META_SENTINEL",
    "NO_CONTEXT_MESSAGE",
    "NO_MEDIA_MESSAGE",
    "PLAN_SYSTEM_PROMPT",
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
