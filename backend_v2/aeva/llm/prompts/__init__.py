"""Per-capability LLM contracts: prompt templates, schemas, and tool params.

Each module declares one complete :class:`PromptTemplate` — the *entire*
prompt its capability sends, with ``{PLACEHOLDER}`` tokens for the shared
blocks and runtime values — plus its structured-output schema and MCP tool
parameters, so the response contract stays stable when models or providers
change. :class:`PromptBuilder` (``builder``) is the single place placeholders
are resolved; no prompt concatenation happens anywhere else.

Names are re-exported here so callers can use ``from aeva.llm import prompts``
and access ``prompts.WEB_SEARCH_TEMPLATE``, ``prompts.PLAN_TURN_SCHEMA``, etc.
"""

from aeva.llm.prompts.blocks import user_profile_segment
from aeva.llm.prompts.builder import (
    PromptBuilder,
    PromptError,
    PromptTemplate,
    RenderedPrompt,
)
from aeva.llm.prompts.flashcard import (
    FLASHCARD_GENERATION_SCHEMA,
    FLASHCARD_GENERATION_TEMPLATE,
    FLASHCARD_GENERATOR_PARAMS,
)
from aeva.llm.prompts.general import (
    GENERAL_ANSWER_PARAMS,
    GENERAL_ANSWER_TEMPLATE,
)
from aeva.llm.prompts.media import (
    MEDIA_PARAMS,
    MEDIA_TEMPLATE,
    NO_CONTEXT_MESSAGE,
    NO_MEDIA_MESSAGE,
)
from aeva.llm.prompts.orchestrator import (
    PLAN_TURN_SCHEMA,
    PLAN_TURN_TEMPLATE,
)
from aeva.llm.prompts.personalization import build_personalization_block
from aeva.llm.prompts.quiz_analysis import (
    QUIZ_ANALYSIS_SCHEMA,
    QUIZ_ANALYSIS_TEMPLATE,
)
from aeva.llm.prompts.quiz_feedback import (
    QUIZ_FEEDBACK_SCHEMA,
    QUIZ_FEEDBACK_TEMPLATE,
)
from aeva.llm.prompts.quiz_generation import (
    QUIZ_GENERATION_SCHEMA,
    QUIZ_GENERATION_TEMPLATE,
    QUIZ_GENERATOR_PARAMS,
)
from aeva.llm.prompts.response_meta import META_SENTINEL
from aeva.llm.prompts.system import SYSTEM_PROMPT
from aeva.llm.prompts.web_search import (
    WEB_SEARCH_PARAMS,
    WEB_SEARCH_TEMPLATE,
)

__all__ = [
    "FLASHCARD_GENERATION_SCHEMA",
    "FLASHCARD_GENERATION_TEMPLATE",
    "FLASHCARD_GENERATOR_PARAMS",
    "GENERAL_ANSWER_PARAMS",
    "GENERAL_ANSWER_TEMPLATE",
    "MEDIA_PARAMS",
    "MEDIA_TEMPLATE",
    "META_SENTINEL",
    "NO_CONTEXT_MESSAGE",
    "NO_MEDIA_MESSAGE",
    "PLAN_TURN_SCHEMA",
    "PLAN_TURN_TEMPLATE",
    "QUIZ_ANALYSIS_SCHEMA",
    "QUIZ_ANALYSIS_TEMPLATE",
    "QUIZ_FEEDBACK_SCHEMA",
    "QUIZ_FEEDBACK_TEMPLATE",
    "QUIZ_GENERATION_SCHEMA",
    "QUIZ_GENERATION_TEMPLATE",
    "QUIZ_GENERATOR_PARAMS",
    "SYSTEM_PROMPT",
    "WEB_SEARCH_PARAMS",
    "WEB_SEARCH_TEMPLATE",
    "PromptBuilder",
    "PromptError",
    "PromptTemplate",
    "RenderedPrompt",
    "build_personalization_block",
    "user_profile_segment",
]
