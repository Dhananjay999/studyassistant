"""Static map of the prompts and the chat pipeline (Admin → Prompt map).

Answers, from the code alone and without a database: which prompt templates
exist, what each one is made of, where each is rendered, which shared blocks
it embeds (so editing a block shows its blast radius), and how a chat turn
flows from the HTTP request to the persisted answer.

What is derived and what is written by hand
-------------------------------------------
* **Derived** — the templates (every ``PromptTemplate`` exported by
  ``aeva.llm.prompts``), their placeholders, their content hash, the shared
  blocks and every ``path:line``. Line numbers are resolved from the source
  when the catalog is built, so they cannot drift.
* **Hand-written** — :data:`PROMPT_USAGE` (where a template sits in the
  pipeline) and :data:`FLOW` (the pipeline itself). ``tests/
  test_trace_admin.py`` keeps both honest: every template needs a usage
  entry, every call site must really contain that ``build()`` call, and
  every prompt / tool / code reference must exist.

:func:`deployed_version` serves the text of the template version running
now, for the Admin UI to show before any trace has stored it.

Pure Python: no database, no Flask app context.
"""

import ast
import copy
import importlib
import logging
import pkgutil
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Any

from aeva.llm import prompts
from aeva.llm.prompts.builder import _PLACEHOLDER_RE, PromptTemplate
from aeva.tracing.recorder import template_hash
from aeva.tracing.sanitize import clean_text

logger = logging.getLogger(__name__)

# ``backend_v2/`` on disk, and how paths are shown to the admin (repo-relative,
# whatever directory the deployment unpacked the code into).
_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_REPO_PREFIX = "backend_v2"

_ORCHESTRATOR = "aeva/orchestration/assistant_orchestrator.py"
_RUNNER = "aeva/orchestration/agent_runner.py"
_RETRIEVAL = "aeva/media/retrieval.py"
_TOOLS = "aeva/mcp/tools"
_EXAM_CONTROLLER = "aeva/exam_prep/exam_prep_controller.py"
_EXAM_SERVICE = "aeva/exam_prep/exam_prep_service.py"
_EXAM_REPOSITORY = "aeva/exam_prep/exam_prep_repository.py"
_EXAM_ORCHESTRATOR = "aeva/exam_prep/exam_prep_orchestrator.py"

# Stage a template belongs to when nothing registered it (a new template
# whose author forgot :data:`PROMPT_USAGE`; the tests fail on it).
STAGE_UNREGISTERED = "unregistered"


# ------------------------------------------------------------ usage registry


@dataclass(frozen=True)
class PromptUsage:
    """Where one prompt template sits in the pipeline (hand-written)."""

    # Id of the :data:`FLOW` stage that renders it.
    stage: str
    description: str
    # Tool whose step renders it, when it belongs to one.
    tool: str | None = None
    # ``(file under backend_v2/, function holding the build() call)``. The
    # line is looked up in the source; ``None`` when nothing renders it.
    site: tuple[str, str] | None = None
    # ``LLMClient`` method that sends the rendered prompt.
    llm_method: str | None = None
    # Config key that selects the model (``LLM_*_MODEL``).
    config_key: str | None = None
    # False for a template no code path renders.
    live: bool = True
    # Labels of the flow nodes that run before / after this prompt.
    upstream: tuple[str, ...] = ()
    downstream: tuple[str, ...] = ()


# ``upstream`` / ``downstream`` name :data:`FLOW` nodes by their label, so the
# Admin map can mark each one ("runs before" / "runs after").
_AFTER_ANSWER = (
    "Split the metadata trailer",
    "Hand the answer to the generators",
    "Stamp actions, notes and badge",
    "Save the assistant message",
)
_AFTER_GENERATOR = (
    "Stamp actions, notes and badge",
    "Save the assistant message",
)

# Keyed by ``PromptTemplate.name``, in pipeline order (the catalog lists the
# templates in this order).
PROMPT_USAGE: dict[str, PromptUsage] = {
    "plan_turn": PromptUsage(
        stage="routing",
        description=(
            "The planner. One structured call that decides between asking "
            "a clarifying question and running tools, and picks the steps "
            "(tool, model, params). It runs only when no deterministic "
            "routing branch matched, and it does not see the "
            "personalization block."
        ),
        site=(_ORCHESTRATOR, "_plan_turn"),
        llm_method="generate_structured",
        config_key="LLM_ORCHESTRATOR_MODEL",
        upstream=(
            "Load recent history",
            "Ground on a card's content",
            "Resume after a clarification",
            "Forced plan",
            "Which file?",
            "Repeat the last generator",
            "Small-talk fast path",
        ),
        downstream=(
            "Block a repeat clarification",
            "Over-clarification guard",
            "Web upgrade",
            "Media guard",
            "Quiz setup popover",
            "Ask a clarifying question",
            "Build the step roster",
            "Clamp the model",
            "General answer",
            "Web search answer",
            "Product info answer",
            "Answer from files",
            "Quiz generator",
            "Flashcard generator",
            "Image generator",
        ),
    ),
    "general_answer": PromptUsage(
        stage="answer_tools",
        description=(
            "The default answer: a streamed reply from the model's own "
            "knowledge, with the teaching protocol and the follow-up "
            "metadata trailer."
        ),
        tool="general",
        site=(f"{_TOOLS}/general.py", "_render"),
        llm_method="generate_stream",
        config_key="LLM_WEB_SEARCH_MODEL",
        upstream=(
            "Planner LLM",
            "Small-talk fast path",
            "Build the personalization block",
            "Load recent history",
            "Switched-off tools",
            "Clamp the model",
            "Fast-model override",
            "Default to general",
        ),
        downstream=_AFTER_ANSWER,
    ),
    "web_search": PromptUsage(
        stage="answer_tools",
        description=(
            "A streamed answer grounded by the provider's web search, "
            "shaped by the search intent (lookup, compare, recommend, "
            "news)."
        ),
        tool="web_search",
        site=(f"{_TOOLS}/web_search.py", "_render"),
        llm_method="generate_stream",
        config_key="LLM_WEB_SEARCH_MODEL",
        upstream=(
            "Planner LLM",
            "Web upgrade",
            "Build the personalization block",
            "Load recent history",
            "Clamp the model",
        ),
        downstream=_AFTER_ANSWER,
    ),
    "product_info": PromptUsage(
        stage="answer_tools",
        description=(
            "Questions about the app itself, answered from the built-in "
            "product knowledge block on the fast model. The planner's "
            "restated query replaces the student's message here."
        ),
        tool="product_info",
        site=(f"{_TOOLS}/product_info.py", "execute_stream"),
        llm_method="generate_stream",
        config_key="LLM_FAST_MODEL",
        upstream=(
            "Planner LLM",
            "Build the personalization block",
            "Load recent history",
            "Clamp the model",
        ),
        downstream=_AFTER_ANSWER,
    ),
    "media_llm": PromptUsage(
        stage="answer_tools",
        description=(
            "Answers from the student's files: retrieved excerpts go in "
            "DOCUMENT_CONTEXT, images and un-indexed documents are "
            "attached whole, and the answer cites its sources."
        ),
        tool="media_llm",
        site=(f"{_TOOLS}/media_llm.py", "_prepare"),
        llm_method="generate_stream",
        config_key="LLM_MEDIA_MODEL",
        upstream=(
            "Planner LLM",
            "Forced plan",
            "Which file?",
            "Media guard",
            "Build the personalization block",
            "Load recent history",
            "Clamp the model",
            "Query rewrite",
            "Embed the query",
            "Hybrid search",
            "Rerank",
            "Neighbours and context",
        ),
        downstream=_AFTER_ANSWER,
    ),
    "rag_query_rewrite": PromptUsage(
        stage="retrieval",
        description=(
            "Turns a follow-up into a standalone search query, with "
            "keywords and paraphrases. Runs inside media_llm only: the "
            "generators switch it off. A failure falls back to the raw "
            "message."
        ),
        tool="media_llm",
        site=(_RETRIEVAL, "_rewrite"),
        llm_method="generate_structured",
        config_key="LLM_FAST_MODEL",
        upstream=(
            "Planner LLM",
            "Forced plan",
            "Which file?",
            "Media guard",
            "Load recent history",
        ),
        downstream=(
            "Embed the query",
            "Hybrid search",
            "Rerank",
            "Neighbours and context",
            "Answer from files",
            "Canned file reply",
        ),
    ),
    "rag_rerank": PromptUsage(
        stage="retrieval",
        description=(
            "Scores the candidate excerpts against the query in one "
            "listwise call with a hard timeout. Runs inside media_llm "
            "only; on timeout or error the search order is kept."
        ),
        tool="media_llm",
        site=(_RETRIEVAL, "_rerank"),
        llm_method="generate_structured",
        config_key="LLM_FAST_MODEL",
        upstream=(
            "Query rewrite",
            "Embed the query",
            "Hybrid search",
        ),
        downstream=(
            "Neighbours and context",
            "Answer from files",
        ),
    ),
    "exam_style_research": PromptUsage(
        stage="generators",
        description=(
            "A web-search-grounded call that learns how an exam's "
            "previous-year questions on the topic are asked. Runs only "
            "for a quiz pitched at an exam's level; the brief becomes the "
            "quiz prompt's exam-pattern style guide."
        ),
        tool="quiz_generator",
        site=("aeva/quiz/exam_research.py", "research"),
        llm_method="generate",
        config_key="LLM_WEB_SEARCH_MODEL",
        upstream=(
            "Planner LLM",
            "Forced plan",
            "Pick the source material",
        ),
        downstream=("Quiz generator",),
    ),
    "quiz_generation": PromptUsage(
        stage="generators",
        description=(
            "One structured call that writes the quiz questions from the "
            "topic and the source material, in a worker thread."
        ),
        tool="quiz_generator",
        site=(f"{_TOOLS}/quiz_generator.py", "execute"),
        llm_method="generate_structured",
        config_key="LLM_QUIZ_MODEL",
        upstream=(
            "Planner LLM",
            "Forced plan",
            "Repeat the last generator",
            "Build the personalization block",
            "Load recent history",
            "Clamp the model",
            "Hand the answer to the generators",
            "Pick the source material",
            "Research the exam pattern",
        ),
        downstream=_AFTER_GENERATOR,
    ),
    "flashcard_generation": PromptUsage(
        stage="generators",
        description=(
            "One structured call that writes a flashcard set from the "
            "topic and the source material, in a worker thread."
        ),
        tool="flashcard_generator",
        site=(f"{_TOOLS}/flashcard_generator.py", "execute"),
        llm_method="generate_structured",
        config_key="LLM_FLASHCARD_MODEL",
        upstream=(
            "Planner LLM",
            "Forced plan",
            "Repeat the last generator",
            "Build the personalization block",
            "Load recent history",
            "Clamp the model",
            "Hand the answer to the generators",
            "Pick the source material",
        ),
        downstream=_AFTER_GENERATOR,
    ),
    "notes_generation": PromptUsage(
        stage="generators",
        description=(
            "One plain-text call that writes a note the student keeps (a "
            "revision sheet, a formula sheet, important questions with "
            "model answers) from the answer an action was tapped on, the "
            "selected files or the topic, in a worker thread. The planner "
            "never routes here: only the forced notes route does."
        ),
        tool="notes_generator",
        site=(f"{_TOOLS}/notes_generator.py", "execute"),
        llm_method="generate",
        config_key="LLM_MEDIA_MODEL",
        upstream=(
            "Forced plan",
            "Build the personalization block",
            "Load recent history",
            "Pick the source material",
        ),
        downstream=_AFTER_GENERATOR,
    ),
    "image_generation": PromptUsage(
        stage="generators",
        description=(
            "The image prompt: the chosen image skill's instructions plus "
            "the request, sent without a system prompt, in a worker "
            "thread."
        ),
        tool="image_generator",
        site=(f"{_TOOLS}/image_generator.py", "render_prompt"),
        llm_method="generate_image",
        config_key="LLM_IMAGE_MODEL",
        upstream=(
            "Planner LLM",
            "Switched-off tools",
            "Clamp the model",
            "Hand the answer to the generators",
        ),
        downstream=_AFTER_GENERATOR,
    ),
    "quiz_analysis": PromptUsage(
        stage="outside_chat",
        description=(
            "Performance analysis of a quiz attempt, requested from the "
            "results page. Not part of a chat turn, so chat traces never "
            "contain it."
        ),
        site=("aeva/quiz/quiz_service.py", "_generate_analysis"),
        llm_method="generate_structured",
        config_key="LLM_QUIZ_ANALYSIS_MODEL",
    ),
    "quiz_feedback": PromptUsage(
        stage="outside_chat",
        description=(
            "Defined and exported, but nothing renders it: quiz "
            "submission is scored without an LLM call."
        ),
        live=False,
    ),
    "exam_syllabus_research": PromptUsage(
        stage="exam_prep",
        description=(
            "Web-grounded research run before the roadmap: the official "
            "syllabus units, weightage and paper pattern of this exact "
            "exam, class and board. Best effort — the roadmap is built "
            "without it when the search fails. Not part of a chat turn."
        ),
        site=(_EXAM_SERVICE, "research_syllabus"),
        llm_method="generate",
        config_key="LLM_WEB_SEARCH_MODEL",
        upstream=("POST /exam-prep/plan",),
        downstream=("Exam plan roadmap",),
    ),
    "exam_plan": PromptUsage(
        stage="exam_prep",
        description=(
            "The Exam Prep roadmap: one structured call at setup turns the "
            "exam, date, subjects, daily time and optional syllabus into a "
            "day-by-day list of topics. Not part of a chat turn."
        ),
        site=(_EXAM_SERVICE, "create_plan"),
        llm_method="generate_structured",
        config_key="LLM_EXAM_PLAN_MODEL",
        upstream=("POST /exam-prep/plan",),
        downstream=("Save the roadmap",),
    ),
    "exam_topic_lesson": PromptUsage(
        stage="exam_prep",
        description=(
            "The lesson Aeva teaches when the student opens a topic: a "
            "complete exam-oriented explanation with worked examples, "
            "streamed as markdown and cached on the topic row. Not part of "
            "a chat turn."
        ),
        site=(_EXAM_SERVICE, "stream_topic_lesson"),
        llm_method="generate_stream",
        config_key="LLM_EXAM_PLAN_MODEL",
        upstream=("POST /exam-prep/topics/<id>/lesson/stream",),
        downstream=("Save the lesson",),
    ),
    "exam_day_detail": PromptUsage(
        stage="exam_prep",
        description=(
            "One day's detailed study plan (time blocks, objectives, key "
            "points, practice), generated the first time the student opens "
            "that day and cached on the day row."
        ),
        site=(_EXAM_SERVICE, "get_day_detail"),
        llm_method="generate_structured",
        config_key="LLM_EXAM_PLAN_MODEL",
        upstream=("GET /exam-prep/plan/<id>/days/<id>",),
        downstream=("Save the day detail",),
    ),
}


# ---------------------------------------------------------------- the flow


@dataclass(frozen=True)
class FlowNode:
    """One branch or step of a pipeline stage (hand-written)."""

    id: str
    label: str
    # One or two plain sentences: what happens here.
    description: str
    # entry | context | rule | llm | outcome | tool | retrieval | persist
    kind: str
    # When this node is taken.
    condition: str | None = None
    # Prompt template this node renders, if any.
    prompt: str | None = None
    tool: str | None = None
    # ``(file under backend_v2/, dotted symbol)``; shown as ``path:line``.
    code: tuple[str, str] | None = None


@dataclass(frozen=True)
class FlowStage:
    """One stage of the chat pipeline, top to bottom."""

    id: str
    title: str
    description: str
    nodes: tuple[FlowNode, ...]


def _orch(symbol: str) -> tuple[str, str]:
    """Code reference to an ``AssistantOrchestrator`` method."""
    return (_ORCHESTRATOR, f"AssistantOrchestrator.{symbol}")


FLOW: tuple[FlowStage, ...] = (
    FlowStage(
        id="entry",
        title="Request entry",
        description=(
            "The HTTP routes that start a chat turn. They all reach the "
            "same orchestrator."
        ),
        nodes=(
            FlowNode(
                id="http_stream",
                label="POST /assistant/stream",
                description=(
                    "Validates the body, authenticates the user and "
                    "streams the turn back as server-sent events."
                ),
                kind="entry",
                condition="Every message sent from the app.",
                code=(
                    "aeva/assistant/assistant_controller.py",
                    "AssistantStreamEndpoint.post",
                ),
            ),
            FlowNode(
                id="http_sync",
                label="POST /assistant/",
                description=(
                    "The same turn returned as one JSON response; the "
                    "progress frames are discarded."
                ),
                kind="entry",
                condition=(
                    "A client calls the non-streaming route (the app does not)."
                ),
                code=(
                    "aeva/assistant/assistant_controller.py",
                    "AssistantEndpoint.post",
                ),
            ),
            FlowNode(
                id="http_legacy_chat",
                label="POST /chat/ and /chat/stream",
                description=(
                    "Legacy shim: copies session_id, message and "
                    "media_ids into an assistant request and runs the "
                    "same turn."
                ),
                kind="entry",
                condition="A client still calls the old chat routes.",
                code=(
                    "aeva/chat/chat_repository.py",
                    "ChatRepository._to_assistant",
                ),
            ),
            FlowNode(
                id="turn_context",
                label="Build the turn",
                description=(
                    "Creates one orchestrator per request and the "
                    "AssistantContext: user, session, message, selected "
                    "files, clarification reply, quiz and flashcard "
                    "options, card content."
                ),
                kind="entry",
                condition="Always.",
                code=(
                    "aeva/assistant/assistant_repository.py",
                    "AssistantRepository._context",
                ),
            ),
        ),
    ),
    FlowStage(
        id="context",
        title="Context loading",
        description=(
            "Everything the turn needs before it can be routed. Nothing "
            "is streamed to the student until routing has finished."
        ),
        nodes=(
            FlowNode(
                id="load_session",
                label="Load the session and study space",
                description=(
                    "One query for the session and its study space. A "
                    "session that is missing or not the user's ends the "
                    "turn with NOT_FOUND."
                ),
                kind="context",
                condition="Always.",
                code=_orch("_setup_and_plan"),
            ),
            FlowNode(
                id="load_profile",
                label="Load the learning profile",
                description=(
                    "Reads the profile and the Developer Mode flag. A "
                    'standing language request ("from now on talk in '
                    'Hinglish") is saved to the profile and applied to '
                    "this turn."
                ),
                kind="context",
                condition="Always.",
                code=_orch("_setup_and_plan"),
            ),
            FlowNode(
                id="personalization",
                label="Build the personalization block",
                description=(
                    "Student name, learning profile and study-space "
                    "context, joined into the text answer tools and "
                    "generators receive as USER_PROFILE. The planner "
                    "does not get it."
                ),
                kind="context",
                condition="Always (empty sections are left out).",
                code=(
                    "aeva/llm/prompts/personalization.py",
                    "build_personalization_block",
                ),
            ),
            FlowNode(
                id="load_history",
                label="Load recent history",
                description=(
                    "The newest CHAT_HISTORY_LIMIT messages (default 20), "
                    "oldest first, each assistant turn tagged with the "
                    "tool that produced it. Loaded before the new "
                    "message is saved, so it excludes it."
                ),
                kind="context",
                condition="Always.",
                code=_orch("_get_history"),
            ),
            FlowNode(
                id="source_content",
                label="Ground on a card's content",
                description=(
                    "History is dropped and the message is extended with "
                    "the card's content as the only source."
                ),
                kind="context",
                condition=(
                    "The request carries source_content (an action on a "
                    "specific card)."
                ),
                code=_orch("_setup_and_plan"),
            ),
            FlowNode(
                id="clarification_resume",
                label="Resume after a clarification",
                description=(
                    "Loads the saved run, merges the original message "
                    "with the answers into the enriched message, "
                    'resolves a "which file?" choice and marks the run '
                    "completed. A missing run ends the turn with "
                    "CLARIFICATION_EXPIRED."
                ),
                kind="context",
                condition=(
                    "The request carries run_id and clarification (a "
                    "reply to a clarifying question)."
                ),
                code=_orch("_merge_clarification"),
            ),
            FlowNode(
                id="user_message",
                label="Save the user message",
                description=(
                    "Inserts the student's message into the session "
                    "before routing."
                ),
                kind="persist",
                condition=(
                    "Every turn except a clarification reply (those are "
                    "folded into the original message)."
                ),
                code=_orch("_setup_and_plan"),
            ),
        ),
    ),
    FlowStage(
        id="routing",
        title="Routing cascade",
        description=(
            "Evaluated in this order; the first branch that matches "
            "produces the plan. Only the last one calls an LLM."
        ),
        nodes=(
            FlowNode(
                id="forced_plan",
                label="Forced plan",
                description=(
                    "Skips planning: media_llm on the chosen files, "
                    "flashcard_generator, quiz_generator with the "
                    "popover settings, or notes_generator for a note to "
                    "keep. Plan source: forced."
                ),
                kind="rule",
                condition=(
                    'The request resolves a "which file?" '
                    "clarification, or carries flashcard_options, or "
                    "carries quiz_options, or its message asks for "
                    "revision notes, a formula sheet or important "
                    "questions (checked in that order)."
                ),
                code=_orch("_forced_plan"),
            ),
            FlowNode(
                id="media_choice",
                label="Which file?",
                description=(
                    'Asks "Choose a file" as a clarification when no '
                    "file is named, or runs media_llm on the named "
                    "subset. Plan source: media_choice."
                ),
                kind="rule",
                condition=(
                    "Not a clarification reply, more than one selected "
                    "file belongs to the user, and the message names "
                    "none of them or only some of them."
                ),
                code=_orch("_disambiguate_media"),
            ),
            FlowNode(
                id="continuation",
                label="Repeat the last generator",
                description=(
                    "Runs that generator again with the message as the "
                    "topic. Plan source: continuation."
                ),
                kind="rule",
                condition=(
                    "No clarification reply, no files, no quiz or "
                    'flashcard keyword, a repeat cue ("again", '
                    '"another", "one more"), and the latest '
                    "tool-bearing assistant message used quiz_generator "
                    "or flashcard_generator."
                ),
                code=_orch("_continuation_plan"),
            ),
            FlowNode(
                id="fast_path",
                label="Small-talk fast path",
                description=(
                    "Answers with general on the fast model "
                    "(LLM_FAST_MODEL) without calling the planner. Plan "
                    "source: fast_path."
                ),
                kind="rule",
                tool="general",
                condition=(
                    "The whole message is pleasantries (greeting, "
                    "thanks, acknowledgement; at most 80 characters), "
                    "with no clarification reply, no files and no quiz, "
                    "flashcard or image keyword; and the two checks of "
                    "the over-clarification guard agree that nothing "
                    "needs asking: _has_unresolved_reference() is false "
                    "and _clarification_unnecessary() is true (a known "
                    "small-talk phrase, at most four words, or phrased "
                    "as a question). Pleasantries of five or more words "
                    "that are not phrased as a question go to the "
                    "planner."
                ),
                code=_orch("_fast_path_plan"),
            ),
            FlowNode(
                id="plan_turn",
                label="Planner LLM",
                description=(
                    "One structured call returns clarify, or run_tool "
                    "with the steps (tool, model, params, purpose, "
                    "input). It sees the enabled tools, the media hint "
                    "and tool-tagged history. Plan source: planner."
                ),
                kind="llm",
                prompt="plan_turn",
                condition="No earlier branch matched.",
                code=_orch("_plan_turn"),
            ),
        ),
    ),
    FlowStage(
        id="post_planner",
        title="Post-planner rules",
        description=(
            "Applied in this order, only to the planner's output. Each "
            "one can rewrite the plan after the LLM call."
        ),
        nodes=(
            FlowNode(
                id="clarify_blocked",
                label="Block a repeat clarification",
                description=(
                    "The plan is replaced by the keyword fallback "
                    "(flashcards, quiz, media_llm, web_search or "
                    "general), so the turn always answers."
                ),
                kind="rule",
                condition=(
                    "The planner chose clarify, but the student already "
                    "answered or skipped a clarification for this turn."
                ),
                code=_orch("_refine_plan"),
            ),
            FlowNode(
                id="clarify_skipped",
                label="Over-clarification guard",
                description=(
                    "The plan is replaced by the keyword fallback "
                    "instead of asking."
                ),
                kind="rule",
                condition=(
                    "The planner chose clarify, the message has no "
                    '"this/that" reference left unresolved, and asking '
                    "is judged unnecessary: a flashcard request without "
                    "files; a quiz or test request without files that "
                    "has more than 3 words or follows earlier "
                    "conversation; a known small-talk phrase or a "
                    "message of at most 4 words; a direct question; or "
                    "files attached to a request that is neither a quiz "
                    "nor a flashcard one. For a quiz or flashcard request "
                    "with files the planner's question stands."
                ),
                code=_orch("_clarification_unnecessary"),
            ),
            FlowNode(
                id="web_upgrade",
                label="Web upgrade",
                description=(
                    "The answer step becomes web_search with a guessed "
                    "search intent."
                ),
                kind="rule",
                tool="web_search",
                condition=(
                    "The answer step is general, the message reads as a "
                    "product, choice or fresh-information question and "
                    "is not pasted study material, and the web_search "
                    "flag is on."
                ),
                code=_orch("_web_upgrade"),
            ),
            FlowNode(
                id="media_guard",
                label="Media guard",
                description=(
                    "The answer step becomes media_llm over the selected "
                    "files. Plan source becomes planner+media_guard."
                ),
                kind="rule",
                tool="media_llm",
                condition=(
                    "Files are selected and the answer step is general "
                    "(and the message is not small talk) or web_search "
                    "(and the message has no fresh-information cue)."
                ),
                code=_orch("_media_routing_guard"),
            ),
        ),
    ),
    FlowStage(
        id="outcome",
        title="Outcome",
        description=(
            "What the turn does with the plan. Checked in this order; "
            "the first two end the turn without running a tool."
        ),
        nodes=(
            FlowNode(
                id="quiz_setup",
                label="Quiz setup popover",
                description=(
                    "Sends the quiz setup form, pre-filled with what the "
                    "plan detected, and ends the turn. No tool runs and "
                    "no assistant message is saved."
                ),
                kind="outcome",
                condition=(
                    "No quiz_options or flashcard_options on the "
                    "request, no flashcard step, at most one step, and "
                    "either that step is quiz_generator without both a "
                    "question count and a difficulty, or (any other "
                    "plan, clarify included) the message contains "
                    '"quiz", "practice test" or "test me".'
                ),
                code=_orch("_should_open_quiz_setup"),
            ),
            FlowNode(
                id="clarification",
                label="Ask a clarifying question",
                description=(
                    "Saves the plan as an orchestration run and the "
                    "question as an assistant message, sends the "
                    "clarification and ends the turn. The reply comes "
                    "back with the run id."
                ),
                kind="outcome",
                condition="The plan's action is clarify.",
                code=_orch("_handle_clarification"),
            ),
            FlowNode(
                id="run_tools",
                label="Run tools",
                description=(
                    "The steps are normalised and handed to the agent "
                    "runner: independent generators start first, the "
                    "answer streams, then the generators that depend on "
                    "it."
                ),
                kind="outcome",
                condition="Otherwise.",
                code=(_RUNNER, "AgentRunner.run"),
            ),
        ),
    ),
    FlowStage(
        id="normalize",
        title="Step normalisation",
        description=(
            "Turns the plan into the final roster: at most one answer "
            "step plus up to three distinct generators."
        ),
        nodes=(
            FlowNode(
                id="normalize_steps",
                label="Build the step roster",
                description=(
                    "Keeps the first answer tool and up to three "
                    "distinct generators. A generator takes the answer "
                    "as its input when an answer step exists, otherwise "
                    "the message."
                ),
                kind="rule",
                condition="Always on the run-tools outcome.",
                code=_orch("_normalize_steps"),
            ),
            FlowNode(
                id="flag_disabled",
                label="Switched-off tools",
                description=(
                    "A disabled answer tool is replaced by general; a "
                    "disabled generator is dropped and the answer says "
                    "it is turned off."
                ),
                kind="rule",
                condition=(
                    "A planned tool is switched off by its feature flag "
                    "(web_search, image_generation)."
                ),
                code=_orch("_tool_enabled"),
            ),
            FlowNode(
                id="resolve_model",
                label="Clamp the model",
                description=(
                    "The planner's model pick is kept only when it is in "
                    "the tool's candidate list; otherwise the tool's "
                    "configured default model is used."
                ),
                kind="rule",
                condition="Every step.",
                code=(
                    "aeva/orchestration/model_candidates.py",
                    "resolve_model",
                ),
            ),
            FlowNode(
                id="fast_override",
                label="Fast-model override",
                description=(
                    "The answer step runs on the LLM_FAST_MODEL config "
                    "instead of the tool's own."
                ),
                kind="rule",
                condition="The plan came from the small-talk fast path.",
                code=_orch("_fast_override"),
            ),
            FlowNode(
                id="default_general",
                label="Default to general",
                description=(
                    "A single general step with the message as the query."
                ),
                kind="rule",
                tool="general",
                condition="The plan produced no usable step.",
                code=_orch("_normalize_steps"),
            ),
        ),
    ),
    FlowStage(
        id="answer_tools",
        title="Answer tools",
        description=(
            "The one step that streams text to the student, on the "
            "request thread. The hidden metadata trailer is held back "
            "from the stream."
        ),
        nodes=(
            FlowNode(
                id="general",
                label="General answer",
                description=(
                    "Streams an answer from the model's own knowledge, "
                    "with the teaching protocol."
                ),
                kind="tool",
                prompt="general_answer",
                tool="general",
                condition=(
                    "The answer step is general: the planner's default, "
                    "the fast path, the keyword fallback, or a "
                    "switched-off answer tool."
                ),
                code=(
                    f"{_TOOLS}/general.py",
                    "GeneralAnswerTool.execute_stream",
                ),
            ),
            FlowNode(
                id="web_search",
                label="Web search answer",
                description=(
                    "Streams an answer grounded by the provider's web "
                    "search; the sources are read from the client "
                    "afterwards."
                ),
                kind="tool",
                prompt="web_search",
                tool="web_search",
                condition=(
                    "The planner chose web_search, or the web upgrade or "
                    "keyword fallback picked it. Needs the web_search "
                    "flag."
                ),
                code=(
                    f"{_TOOLS}/web_search.py",
                    "WebSearchTool.execute_stream",
                ),
            ),
            FlowNode(
                id="product_info",
                label="Product info answer",
                description=(
                    "Answers questions about the app from the built-in "
                    "product knowledge, on the fast model."
                ),
                kind="tool",
                prompt="product_info",
                tool="product_info",
                condition=(
                    "The planner chose product_info. No rule routes here."
                ),
                code=(
                    f"{_TOOLS}/product_info.py",
                    "ProductInfoTool.execute_stream",
                ),
            ),
            FlowNode(
                id="media_llm",
                label="Answer from files",
                description=(
                    "Retrieves excerpts from the indexed files, attaches "
                    "images and un-indexed documents whole, and streams "
                    "a cited answer."
                ),
                kind="tool",
                prompt="media_llm",
                tool="media_llm",
                condition=(
                    "The planner chose media_llm, or the media guard, a "
                    "file choice or the keyword fallback routed here."
                ),
                code=(
                    f"{_TOOLS}/media_llm.py",
                    "MediaLLMTool.execute_stream",
                ),
            ),
            FlowNode(
                id="media_early_answer",
                label="Canned file reply",
                description=(
                    "Returns a fixed reply (no files, still processing, "
                    "or nothing relevant found) without calling the "
                    "model."
                ),
                kind="tool",
                tool="media_llm",
                condition=(
                    "No usable file, or un-indexed files with nothing to "
                    "attach, or retrieval found nothing and nothing is "
                    "attached."
                ),
                code=(f"{_TOOLS}/media_llm.py", "MediaLLMTool._prepare"),
            ),
        ),
    ),
    FlowStage(
        id="retrieval",
        title="Retrieval",
        description=(
            "Search over the student's indexed files. media_llm runs the "
            "whole pipeline; quiz and flashcard grounding run it with "
            "rewrite and rerank switched off."
        ),
        nodes=(
            FlowNode(
                id="rewrite",
                label="Query rewrite",
                description=(
                    "Rewrites the message into a standalone search query "
                    "with keywords and paraphrases. Any failure falls "
                    "back to the raw message."
                ),
                kind="retrieval",
                prompt="rag_query_rewrite",
                tool="media_llm",
                condition=(
                    "Rewrite is on and the message needs the "
                    "conversation to make sense (there is history and "
                    "the message is short or refers back), or "
                    "multi-query is on."
                ),
                code=(_RETRIEVAL, "RetrievalService._rewrite"),
            ),
            FlowNode(
                id="embed",
                label="Embed the query",
                description=(
                    "Embeds the query and its paraphrases (task type "
                    "RETRIEVAL_QUERY)."
                ),
                kind="retrieval",
                condition="Always.",
                code=(_RETRIEVAL, "RetrievalService._search_all"),
            ),
            FlowNode(
                id="search",
                label="Hybrid search",
                description=(
                    "Vector plus full-text search for each query "
                    "variant, fused into one ranking. Falls back to "
                    "vector-only search when the hybrid function is "
                    "missing."
                ),
                kind="retrieval",
                condition="Always.",
                code=(_RETRIEVAL, "RetrievalService._search"),
            ),
            FlowNode(
                id="rerank",
                label="Rerank",
                description=(
                    "Scores the candidates in one listwise call on the "
                    "fast model, in its own thread with a hard timeout. "
                    "On timeout or error the search order is kept."
                ),
                kind="retrieval",
                prompt="rag_rerank",
                tool="media_llm",
                condition=(
                    "Rerank mode is llm and more than one chunk passed "
                    "the similarity threshold."
                ),
                code=(_RETRIEVAL, "RetrievalService._rerank"),
            ),
            FlowNode(
                id="retrieval_context",
                label="Neighbours and context",
                description=(
                    "Adds the chunks next to each hit and builds the "
                    "excerpt text and its sources, capped at the context "
                    "limit."
                ),
                kind="retrieval",
                condition=(
                    "Always; neighbours are added only when chunks were kept."
                ),
                code=(_RETRIEVAL, "RetrievalService._neighbors"),
            ),
        ),
    ),
    FlowStage(
        id="generators",
        title="Generators",
        description=(
            "Quiz, flashcard and image steps. Each runs in a worker "
            "thread with a per-step timeout (AGENT_STEP_TIMEOUT_S, "
            "default 90 seconds)."
        ),
        nodes=(
            FlowNode(
                id="handoff",
                label="Hand the answer to the generators",
                description=(
                    "The finished answer text and its sources are passed "
                    "to the dependent generators as their source "
                    "material."
                ),
                kind="rule",
                condition=(
                    "There is an answer step and a generator whose input "
                    "is the answer."
                ),
                code=(_RUNNER, "AgentRunner.run"),
            ),
            FlowNode(
                id="grounding",
                label="Pick the source material",
                description=(
                    "In priority order: this turn's answer, excerpts "
                    "retrieved from the selected indexed files, then "
                    "whole files for images and un-indexed documents. "
                    "With material, chat history is dropped."
                ),
                kind="context",
                condition="Quiz and flashcard generation.",
                code=("aeva/media/grounding.py", "ground_generator"),
            ),
            FlowNode(
                id="exam_research",
                label="Research the exam pattern",
                description=(
                    "A web-grounded call learns how the target exam's "
                    "previous-year questions on the topic are asked; the "
                    "brief steers the quiz's style and level. Best-effort: "
                    "on failure the quiz falls back on the model's own "
                    "knowledge."
                ),
                kind="llm",
                prompt="exam_style_research",
                condition=(
                    "The quiz targets an exam's level (target_exam) "
                    "instead of a difficulty band."
                ),
                code=(
                    "aeva/quiz/exam_research.py",
                    "ExamResearchService.research",
                ),
            ),
            FlowNode(
                id="quiz_generator",
                label="Quiz generator",
                description=(
                    "One structured call writes the questions, which are "
                    "repaired per question type and saved as a quiz."
                ),
                kind="tool",
                prompt="quiz_generation",
                tool="quiz_generator",
                condition=(
                    "The plan has a quiz_generator step: from the "
                    "planner, the quiz setup popover, a continuation or "
                    "the keyword fallback."
                ),
                code=(
                    f"{_TOOLS}/quiz_generator.py",
                    "QuizGeneratorTool.execute",
                ),
            ),
            FlowNode(
                id="flashcard_generator",
                label="Flashcard generator",
                description=(
                    "One structured call writes the cards, which are "
                    "saved as a flashcard set."
                ),
                kind="tool",
                prompt="flashcard_generation",
                tool="flashcard_generator",
                condition=(
                    "The plan has a flashcard_generator step: from the "
                    "planner, the Create Flashcards action, a "
                    "continuation or the keyword fallback."
                ),
                code=(
                    f"{_TOOLS}/flashcard_generator.py",
                    "FlashcardGeneratorTool.execute",
                ),
            ),
            FlowNode(
                id="notes_generator",
                label="Notes generator",
                description=(
                    "One plain-text call writes the note in markdown; its "
                    "leading heading becomes the title and the note is "
                    "saved to the student's Notes. The full text is also "
                    "the chat answer."
                ),
                kind="tool",
                prompt="notes_generation",
                tool="notes_generator",
                condition=(
                    "The plan has a notes_generator step: the message "
                    "asks for revision notes, a formula sheet or "
                    "important questions (typed, or the Save as revision "
                    "sheet / Important questions actions) and the notes "
                    "flag is on."
                ),
                code=(
                    f"{_TOOLS}/notes_generator.py",
                    "NotesGeneratorTool.execute",
                ),
            ),
            FlowNode(
                id="image_generator",
                label="Image generator",
                description=(
                    "Picks an image skill from the planner's style or "
                    "the words in the message, generates one image and "
                    "saves it to the student's library."
                ),
                kind="tool",
                prompt="image_generation",
                tool="image_generator",
                condition=(
                    "The planner added an image_generator step and the "
                    "image_generation flag is on."
                ),
                code=(
                    f"{_TOOLS}/image_generator.py",
                    "ImageGeneratorTool.execute",
                ),
            ),
            FlowNode(
                id="agent_timeout",
                label="Generator timeout",
                description=(
                    'The step is marked failed with error "timeout" '
                    "and a failure note is added to the answer. The "
                    "worker thread is abandoned, not stopped."
                ),
                kind="rule",
                condition=(
                    "A generator did not finish within the step timeout, "
                    "counted from when it was submitted (time spent "
                    "queued behind AGENT_MAX_PARALLEL included)."
                ),
                code=(_RUNNER, "AgentRunner._expire_timeouts"),
            ),
        ),
    ),
    FlowStage(
        id="finish",
        title="Finish turn",
        description=(
            "Shapes the result after every step has ended, before "
            "anything is saved."
        ),
        nodes=(
            FlowNode(
                id="answer_meta",
                label="Split the metadata trailer",
                description=(
                    "The raw model output is split at the @@AEVA_META@@ "
                    "marker into the visible answer and a JSON trailer "
                    "that supplies the follow-up chips and available "
                    "actions."
                ),
                kind="rule",
                condition="A streamed answer tool ran.",
                code=_orch("_split_answer_meta"),
            ),
            FlowNode(
                id="finish_turn",
                label="Stamp actions, notes and badge",
                description=(
                    "Attaches the response type, actions and follow-up "
                    'chips, appends the "turned off" note for dropped '
                    "tools, and adds the debug block and model badge for "
                    "Developer Mode users."
                ),
                kind="rule",
                condition="Always on the run-tools outcome.",
                code=_orch("_finish_turn"),
            ),
        ),
    ),
    FlowStage(
        id="persist",
        title="Persist and trace flush",
        description=(
            "The answer is saved and delivered; only then is the "
            "execution trace written: after the last frame on the "
            "streaming routes, after the response was sent on the JSON "
            "routes."
        ),
        nodes=(
            FlowNode(
                id="assistant_message",
                label="Save the assistant message",
                description=(
                    "Inserts the assistant message with the full result "
                    'as metadata, titles a "New chat" session from the '
                    "message and bumps the study space's activity time."
                ),
                kind="persist",
                condition=(
                    "Run-tools outcome. A clarification saves its own "
                    "message; the quiz setup popover saves none."
                ),
                code=_orch("_persist_answer"),
            ),
            FlowNode(
                id="done_frame",
                label="Final frame",
                description=(
                    "The last event of the stream carries the complete "
                    "result: tool_used, tools_used and the content."
                ),
                kind="outcome",
                condition="Run-tools outcome on the streaming route.",
                code=_orch("run_stream"),
            ),
            FlowNode(
                id="trace_flush",
                label="Write the trace",
                description=(
                    "The turn recorded in memory is written in one batch "
                    "to ai_traces, ai_trace_spans and ai_prompt_versions. "
                    "A failure here loses the trace, never the answer."
                ),
                kind="persist",
                condition=(
                    "After the last frame on the streaming routes; after "
                    "the response was sent on the JSON routes. Only when "
                    "tracing is enabled (AI_TRACE_ENABLED), the turn was "
                    "sampled (AI_TRACE_SAMPLE_RATE) and the trace tables "
                    "exist; under AI_TRACE_SCOPE=debug_users only for "
                    "Developer Mode users."
                ),
                code=("aeva/tracing/recorder.py", "finish_turn"),
            ),
        ),
    ),
    FlowStage(
        id="outside_chat",
        title="Outside the chat turn",
        description=(
            "Prompts that are not rendered while answering a chat "
            "message, so no chat trace contains them."
        ),
        nodes=(
            FlowNode(
                id="quiz_analysis",
                label="Quiz attempt analysis",
                description=(
                    "One structured call analyses a quiz attempt; the "
                    "result is cached on the attempt."
                ),
                kind="llm",
                prompt="quiz_analysis",
                condition=(
                    "POST /quiz/<quiz_id>/analyze for an attempt that "
                    "has no cached analysis."
                ),
                code=(
                    "aeva/quiz/quiz_service.py",
                    "QuizService._generate_analysis",
                ),
            ),
        ),
    ),
    FlowStage(
        id="exam_prep",
        title="Exam Prep",
        description=(
            "The separate Exam Prep flow: plan generation at setup, lazy "
            "day detail, and the exam-coach chat turn that reuses the agent "
            "runner and tools."
        ),
        nodes=(
            FlowNode(
                id="exam_http_plan",
                label="POST /exam-prep/plan",
                description=(
                    "The setup form submits the exam, date, subjects, "
                    "daily time and optional syllabus / material; the "
                    "service builds the roadmap and returns the dashboard."
                ),
                kind="entry",
                condition=(
                    "The exam_prep feature flag is on and the student "
                    "submits the Exam Prep setup form."
                ),
                code=(_EXAM_CONTROLLER, "ExamPlanEndpoint.post"),
            ),
            FlowNode(
                id="exam_research_llm",
                label="Exam syllabus research",
                description=(
                    "A search-grounded call looks up the official syllabus "
                    "units, weightage and paper pattern for the exact exam, "
                    "class and board; the brief is stored on the plan and "
                    "handed to the roadmap prompt."
                ),
                kind="llm",
                prompt="exam_syllabus_research",
                condition=(
                    "Plan creation with research on (the default); skipped "
                    "when the student turns it off or the search fails."
                ),
                code=(_EXAM_SERVICE, "ExamPrepService.research_syllabus"),
            ),
            FlowNode(
                id="exam_plan_llm",
                label="Exam plan roadmap",
                description=(
                    "One structured call drafts every day of the plan "
                    "(title, focus, 2-6 topics across 2-3 subjects); the "
                    "result is normalised before anything is stored."
                ),
                kind="llm",
                prompt="exam_plan",
                condition="Every plan creation (no cache; one call per plan).",
                code=(_EXAM_SERVICE, "ExamPrepService.create_plan"),
            ),
            FlowNode(
                id="exam_persist_plan",
                label="Save the roadmap",
                description=(
                    "The plan row, its days (one insert) and its topics "
                    "(one insert) are written, then the dedicated coach "
                    "session is created and linked."
                ),
                kind="persist",
                condition="The roadmap call returned a usable plan.",
                code=(_EXAM_REPOSITORY, "ExamPrepRepository.insert_roadmap"),
            ),
            FlowNode(
                id="exam_http_day",
                label="GET /exam-prep/plan/<id>/days/<id>",
                description=(
                    "Opening a day returns its topics and the detailed "
                    "plan, generating the detail on first open."
                ),
                kind="entry",
                condition="The student opens a day of their active plan.",
                code=(_EXAM_CONTROLLER, "ExamDayEndpoint.get"),
            ),
            FlowNode(
                id="exam_day_llm",
                label="Exam day detail",
                description=(
                    "One structured call writes the day's time blocks and, "
                    "per topic, objectives, key points, practice and "
                    "common mistakes; unknown topic ids are dropped."
                ),
                kind="llm",
                prompt="exam_day_detail",
                condition=(
                    "The day row has no detail yet (a second concurrent "
                    "open may regenerate once)."
                ),
                code=(_EXAM_SERVICE, "ExamPrepService.get_day_detail"),
            ),
            FlowNode(
                id="exam_persist_day",
                label="Save the day detail",
                description=(
                    "The validated detail and its timestamp are cached on "
                    "the day row, so later opens make no LLM call."
                ),
                kind="persist",
                condition="The day-detail call returned a usable plan.",
                code=(_EXAM_REPOSITORY, "ExamPrepRepository.save_day_detail"),
            ),
            FlowNode(
                id="exam_http_lesson",
                label="POST /exam-prep/topics/<id>/lesson/stream",
                description=(
                    "The topic page asks for the lesson; a cached lesson is "
                    "replayed in one frame, otherwise it is generated and "
                    "streamed."
                ),
                kind="entry",
                condition="A topic page opens (or the student regenerates).",
                code=(_EXAM_CONTROLLER, "ExamTopicLessonStreamEndpoint.post"),
            ),
            FlowNode(
                id="exam_lesson_llm",
                label="Exam topic lesson",
                description=(
                    "One streamed call writes the lesson: why it matters, "
                    "core ideas, worked examples, things to remember, common "
                    "mistakes and a self-check — pitched at the exam and "
                    "class, informed by the researched syllabus."
                ),
                kind="llm",
                prompt="exam_topic_lesson",
                condition="No cached lesson for the topic, or regenerate.",
                code=(_EXAM_SERVICE, "ExamPrepService.stream_topic_lesson"),
            ),
            FlowNode(
                id="exam_persist_lesson",
                label="Save the lesson",
                description=(
                    "The streamed markdown is cached on the topic row and a "
                    "fresh topic becomes in-progress."
                ),
                kind="persist",
                condition="The lesson stream finished with text.",
                code=(_EXAM_REPOSITORY, "ExamPrepRepository.save_topic_lesson"),
            ),
            FlowNode(
                id="exam_http_chat",
                label="POST /exam-prep/plan/<id>/chat/stream",
                description=(
                    "The Ask Aeva panel sends a message with optional topic "
                    "/ day context into the plan's dedicated session; the "
                    "turn streams the same SSE frames as /assistant/stream."
                ),
                kind="entry",
                condition=(
                    "The student sends a message from the Exam Prep "
                    "dashboard, a day page or a topic sheet."
                ),
                code=(_EXAM_CONTROLLER, "ExamChatStreamEndpoint.post"),
            ),
            FlowNode(
                id="exam_route",
                label="Exam coach routing",
                description=(
                    "Deterministic routing, no planner LLM: popover options "
                    "force a generator; quiz / flashcard words pick the "
                    "generator on the current topic; material words with "
                    "uploaded files pick media_llm; fresh-info cues pick "
                    "web_search (when enabled); everything else is general. "
                    "The exam block rides the personalization text."
                ),
                kind="rule",
                condition="Every exam-coach turn, after the context loads.",
                code=(_EXAM_ORCHESTRATOR, "ExamPrepOrchestrator._exam_plan"),
            ),
        ),
    ),
)


# ------------------------------------------------------- source resolution


@cache
def _parse(path: str) -> ast.Module | None:
    """Parse ``backend_v2/<path>``; ``None`` when it cannot be read."""
    try:
        source = (_BACKEND_ROOT / path).read_text(encoding="utf-8")
        return ast.parse(source)
    except (OSError, SyntaxError, ValueError):
        logger.debug("Prompt catalog could not parse %s", path)
        return None


def _shown(path: str, line: int) -> str:
    """``backend_v2/<path>:<line>`` as shown in the Admin UI."""
    return f"{_REPO_PREFIX}/{path}:{line}"


def symbol_ref(path: str, symbol: str) -> str | None:
    """``path:line`` of a dotted function / class / nested function name."""
    tree = _parse(path)
    if tree is None:
        return None
    body: list[ast.stmt] = tree.body
    found: ast.stmt | None = None
    for part in symbol.split("."):
        found = next(
            (
                node
                for node in body
                if isinstance(
                    node,
                    ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef,
                )
                and node.name == part
            ),
            None,
        )
        if found is None:
            return None
        body = found.body
    return _shown(path, found.lineno) if found is not None else None


def _is_build_of(node: ast.Call, constant: str) -> bool:
    """Whether ``node`` is ``<anything>.build(<...>.CONSTANT, ...)``."""
    if not node.args:
        return False
    func = node.func
    if not isinstance(func, ast.Attribute) or func.attr != "build":
        return False
    first = node.args[0]
    if isinstance(first, ast.Attribute):
        return first.attr == constant
    return isinstance(first, ast.Name) and first.id == constant


def _collect_builds(
    node: ast.AST,
    scope: tuple[str, ...],
    constant: str,
    found: list[tuple[str, int]],
) -> None:
    """Depth-first search for ``build(CONSTANT, ...)`` calls under ``node``."""
    for child in ast.iter_child_nodes(node):
        inner = scope
        if isinstance(
            child, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef
        ):
            inner = (*scope, child.name)
        elif isinstance(child, ast.Call) and _is_build_of(child, constant):
            found.append((".".join(scope), child.lineno))
        _collect_builds(child, inner, constant, found)


def build_calls(path: str, constant: str) -> list[tuple[str, int]]:
    """Every ``PromptBuilder.build(CONSTANT, ...)`` call in a file.

    Returns ``(enclosing dotted scope, line)`` pairs in source order.
    """
    tree = _parse(path)
    if tree is None:
        return []
    found: list[tuple[str, int]] = []
    _collect_builds(tree, (), constant, found)
    return sorted(found, key=lambda item: item[1])


def _call_site(constant: str, usage: PromptUsage) -> str | None:
    """``path:line`` of the build() call the usage entry points at."""
    if usage.site is None:
        return None
    path, function = usage.site
    calls = build_calls(path, constant)
    if not calls:
        return None
    # Prefer the named function (product_info also has an unreachable
    # non-streaming twin); fall back to the first call in the file.
    for scope, line in calls:
        if scope.rsplit(".", 1)[-1] == function:
            return _shown(path, line)
    return _shown(path, calls[0][1])


@cache
def _prompt_definitions() -> tuple[tuple[str, int, Any], ...]:
    """Module-level definitions in the prompts package.

    ``(path, line, value)`` for every name assigned a value that is written
    out where it is assigned. Plain aliases (``SYSTEM_PROMPT_BLOCK =
    SYSTEM_PROMPT``) are skipped, so a block resolves to the file that holds
    its text.
    """
    out: list[tuple[str, int, Any]] = []
    for info in pkgutil.iter_modules(prompts.__path__):
        try:
            module = importlib.import_module(f"{prompts.__name__}.{info.name}")
            path = (
                Path(str(module.__file__))
                .resolve()
                .relative_to(_BACKEND_ROOT)
                .as_posix()
            )
        except (ImportError, ValueError):
            continue
        tree = _parse(path)
        if tree is None:
            continue
        for node in tree.body:
            if isinstance(node, ast.Assign):
                targets, value = node.targets, node.value
            elif isinstance(node, ast.AnnAssign) and node.value is not None:
                targets, value = [node.target], node.value
            else:
                continue
            if isinstance(value, ast.Name | ast.Attribute):
                continue
            out.extend(
                (path, node.lineno, getattr(module, target.id))
                for target in targets
                if isinstance(target, ast.Name) and hasattr(module, target.id)
            )
    return tuple(out)


def _block_source(text: str) -> str | None:
    """``path:line`` where a shared block's text is defined."""
    for path, line, value in _prompt_definitions():
        if isinstance(value, str) and value == text:
            return _shown(path, line)
    return None


def _template_source(template: PromptTemplate) -> str | None:
    """``path:line`` where a template is declared."""
    for path, line, value in _prompt_definitions():
        if value is template:
            return _shown(path, line)
    return None


# ---------------------------------------------------------------- templates


def discover_templates() -> dict[str, tuple[str, PromptTemplate]]:
    """Every exported ``PromptTemplate``: ``name -> (constant, template)``.

    Found by introspecting ``aeva.llm.prompts``, so a new template shows up
    without touching this module. Ordered like :data:`PROMPT_USAGE`, then
    alphabetically for templates nothing registered.
    """
    found: dict[str, tuple[str, PromptTemplate]] = {}
    seen: set[int] = set()
    for constant, value in sorted(vars(prompts).items()):
        if not isinstance(value, PromptTemplate) or id(value) in seen:
            continue
        seen.add(id(value))
        if value.name in found:
            logger.warning(
                "Two prompt templates share the name %r; the catalog "
                "shows %s only",
                value.name,
                found[value.name][0],
            )
            continue
        found[value.name] = (constant, value)
    order = {name: index for index, name in enumerate(PROMPT_USAGE)}
    return dict(
        sorted(
            found.items(),
            key=lambda item: (order.get(item[0], len(order)), item[0]),
        )
    )


def _scan_placeholders(
    text: str, defaults: dict[str, str], seen: list[str]
) -> None:
    """Collect placeholder names in first-use order, expanding blocks.

    A default block may itself hold placeholders (``{QUIZ_RESULTS}`` brings
    in ``{QUIZ_DATA}``), exactly as the builder's static pass expands them.
    Each name is visited once, so a block cycle cannot recurse forever.
    """
    for match in _PLACEHOLDER_RE.finditer(text):
        name = match.group(1)
        if name in seen:
            continue
        seen.append(name)
        if name in defaults:
            _scan_placeholders(defaults[name], defaults, seen)


def placeholders(template: PromptTemplate) -> dict[str, list[str]]:
    """Classify every placeholder a template can resolve.

    ``required`` are the ones the caller must supply to ``build()``;
    ``optional`` and ``markers`` resolve to nothing when omitted; ``blocks``
    are the shared default blocks.
    """
    defaults = {str(k): str(v) for k, v in template.defaults.items()}
    seen: list[str] = []
    _scan_placeholders(template.system, defaults, seen)
    _scan_placeholders(template.user, defaults, seen)
    static = set(defaults) | set(template.optional) | set(template.markers)
    return {
        "required": [name for name in seen if name not in static],
        "optional": list(template.optional),
        "markers": list(template.markers),
        "blocks": list(defaults),
    }


def _usage_dict(constant: str, usage: PromptUsage) -> dict[str, Any]:
    """Build the ``AdminPromptUsage`` JSON for one template."""
    return {
        "stage": usage.stage,
        "tool": usage.tool,
        "call_site": _call_site(constant, usage),
        "llm_method": usage.llm_method,
        "config_key": usage.config_key,
        "live": usage.live,
        "description": usage.description,
        "upstream": list(usage.upstream),
        "downstream": list(usage.downstream),
    }


_UNREGISTERED = PromptUsage(
    stage=STAGE_UNREGISTERED,
    description=(
        "No usage is registered for this template. Add it to PROMPT_USAGE "
        "in aeva/tracing/catalog.py."
    ),
    live=False,
)


def _template_dict(constant: str, template: PromptTemplate) -> dict[str, Any]:
    """Build the static part of one ``AdminPromptTemplate``."""
    usage = PROMPT_USAGE.get(template.name, _UNREGISTERED)
    return {
        "name": template.name,
        "constant": constant,
        "source": _template_source(template),
        "hash": template_hash(template),
        "system": template.system,
        "user": template.user,
        "defaults": {str(k): str(v) for k, v in template.defaults.items()},
        "placeholders": placeholders(template),
        "uses_history": bool(template.uses_history),
        "uses_attachments": bool(template.uses_attachments),
        "usage": _usage_dict(constant, usage),
    }


def _blocks(templates: list[PromptTemplate]) -> list[dict[str, Any]]:
    """Every distinct default block and the templates that embed it."""
    blocks: dict[tuple[str, str], dict[str, Any]] = {}
    for template in templates:
        for name, value in template.defaults.items():
            text = str(value)
            block = blocks.setdefault(
                (str(name), text),
                {
                    "name": str(name),
                    "source": _block_source(text),
                    "chars": len(text),
                    "text": text,
                    "used_by": [],
                },
            )
            block["used_by"].append(template.name)
    # Widest blast radius first.
    ordered = sorted(
        blocks.values(), key=lambda b: (-len(b["used_by"]), b["name"])
    )
    # The Admin UI keys blocks by name. Should two templates ever fill the
    # same placeholder with different text, the variants are numbered.
    seen: dict[str, int] = {}
    for block in ordered:
        count = seen[block["name"]] = seen.get(block["name"], 0) + 1
        if count > 1:
            block["name"] = f"{block['name']}#{count}"
    return ordered


def _flow() -> dict[str, Any]:
    """Build the ``flow`` JSON: stages, nodes, code refs resolved."""
    return {
        "stages": [
            {
                "id": stage.id,
                "title": stage.title,
                "description": stage.description,
                "nodes": [
                    {
                        "id": node.id,
                        "label": node.label,
                        "description": node.description,
                        "kind": node.kind,
                        "prompt": node.prompt,
                        "tool": node.tool,
                        "condition": node.condition,
                        "code": (symbol_ref(*node.code) if node.code else None),
                    }
                    for node in stage.nodes
                ],
            }
            for stage in FLOW
        ]
    }


@cache
def _static_catalog() -> dict[str, Any]:
    """Build the catalog once per process (the code cannot change)."""
    discovered = discover_templates()
    return {
        "templates": [
            _template_dict(constant, template)
            for constant, template in discovered.values()
        ],
        "blocks": _blocks([template for _, template in discovered.values()]),
        "flow": _flow(),
    }


def deployed_version(name: str, digest: str) -> dict[str, Any] | None:
    """Return the deployed template ``name`` as a stored-version row.

    Same shape as an ``ai_prompt_versions`` row, for the version the Admin
    UI can ask about before any trace has stored it: the one running now.
    ``first_seen_at`` and ``git_sha`` are ``None`` because no trace recorded
    it. ``None`` when ``digest`` is not the hash of the deployed template.
    """
    found = discover_templates().get(name)
    if found is None:
        return None
    _, template = found
    if template_hash(template) != digest:
        return None
    return {
        "name": template.name,
        "hash": digest,
        "system_template": clean_text(template.system),
        "user_template": clean_text(template.user),
        "defaults": {
            str(key): clean_text(str(value))
            for key, value in template.defaults.items()
        },
        "git_sha": None,
        "first_seen_at": None,
    }


def build_catalog() -> dict[str, Any]:
    """Return ``{templates, blocks, flow}`` — the static prompt map.

    A fresh copy on every call, so callers may add runtime data (usage
    stats) to it.
    """
    return copy.deepcopy(_static_catalog())
