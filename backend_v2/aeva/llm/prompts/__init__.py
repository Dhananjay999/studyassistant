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

from aeva.llm.prompts.blocks import (
    current_date,
    planner_note_segment,
    user_profile_segment,
)
from aeva.llm.prompts.builder import (
    PromptBuilder,
    PromptError,
    PromptTemplate,
    RenderedPrompt,
)
from aeva.llm.prompts.exam_research import EXAM_STYLE_RESEARCH_TEMPLATE
from aeva.llm.prompts.flashcard import (
    FLASHCARD_GENERATION_SCHEMA,
    FLASHCARD_GENERATION_TEMPLATE,
    FLASHCARD_GENERATOR_PARAMS,
)
from aeva.llm.prompts.general import (
    GENERAL_ANSWER_PARAMS,
    GENERAL_ANSWER_TEMPLATE,
)
from aeva.llm.prompts.image import (
    IMAGE_GENERATION_PARAMS,
    IMAGE_TEMPLATE,
)
from aeva.llm.prompts.image_skills import (
    IMAGE_SKILLS,
    ImageSkill,
    pick_skill,
    skill_ids,
    skills_for_planner,
)
from aeva.llm.prompts.media import (
    MEDIA_PARAMS,
    MEDIA_TEMPLATE,
    NO_CONTEXT_MESSAGE,
    NO_MEDIA_MESSAGE,
    PROCESSING_MESSAGE,
    attached_files_block,
    no_context_message,
)
from aeva.llm.prompts.orchestrator import (
    PLAN_TURN_SCHEMA,
    PLAN_TURN_TEMPLATE,
)
from aeva.llm.prompts.personalization import (
    build_identity_block,
    build_personalization_block,
    build_space_block,
)
from aeva.llm.prompts.product_info import (
    PRODUCT_INFO_PARAMS,
    PRODUCT_INFO_TEMPLATE,
)
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
    exam_pattern_segment,
)
from aeva.llm.prompts.response_meta import META_SENTINEL
from aeva.llm.prompts.retrieval import (
    PARAPHRASE_RULE_OFF,
    PARAPHRASE_RULE_ON,
    QUERY_REWRITE_SCHEMA,
    QUERY_REWRITE_TEMPLATE,
    RERANK_SCHEMA,
    RERANK_TEMPLATE,
)
from aeva.llm.prompts.system import SYSTEM_PROMPT
from aeva.llm.prompts.web_search import (
    SEARCH_INTENT_GUIDANCE,
    SEARCH_INTENTS,
    WEB_SEARCH_PARAMS,
    WEB_SEARCH_TEMPLATE,
    guess_search_intent,
    search_mode_block,
)

__all__ = [
    "EXAM_STYLE_RESEARCH_TEMPLATE",
    "FLASHCARD_GENERATION_SCHEMA",
    "FLASHCARD_GENERATION_TEMPLATE",
    "FLASHCARD_GENERATOR_PARAMS",
    "GENERAL_ANSWER_PARAMS",
    "GENERAL_ANSWER_TEMPLATE",
    "IMAGE_GENERATION_PARAMS",
    "IMAGE_SKILLS",
    "IMAGE_TEMPLATE",
    "MEDIA_PARAMS",
    "MEDIA_TEMPLATE",
    "META_SENTINEL",
    "NO_CONTEXT_MESSAGE",
    "NO_MEDIA_MESSAGE",
    "PARAPHRASE_RULE_OFF",
    "PARAPHRASE_RULE_ON",
    "PLAN_TURN_SCHEMA",
    "PLAN_TURN_TEMPLATE",
    "PROCESSING_MESSAGE",
    "PRODUCT_INFO_PARAMS",
    "PRODUCT_INFO_TEMPLATE",
    "QUERY_REWRITE_SCHEMA",
    "QUERY_REWRITE_TEMPLATE",
    "QUIZ_ANALYSIS_SCHEMA",
    "QUIZ_ANALYSIS_TEMPLATE",
    "QUIZ_FEEDBACK_SCHEMA",
    "QUIZ_FEEDBACK_TEMPLATE",
    "QUIZ_GENERATION_SCHEMA",
    "QUIZ_GENERATION_TEMPLATE",
    "QUIZ_GENERATOR_PARAMS",
    "RERANK_SCHEMA",
    "RERANK_TEMPLATE",
    "SEARCH_INTENTS",
    "SEARCH_INTENT_GUIDANCE",
    "SYSTEM_PROMPT",
    "WEB_SEARCH_PARAMS",
    "WEB_SEARCH_TEMPLATE",
    "ImageSkill",
    "PromptBuilder",
    "PromptError",
    "PromptTemplate",
    "RenderedPrompt",
    "attached_files_block",
    "build_identity_block",
    "build_personalization_block",
    "build_space_block",
    "current_date",
    "exam_pattern_segment",
    "guess_search_intent",
    "no_context_message",
    "pick_skill",
    "planner_note_segment",
    "search_mode_block",
    "skill_ids",
    "skills_for_planner",
    "user_profile_segment",
]
