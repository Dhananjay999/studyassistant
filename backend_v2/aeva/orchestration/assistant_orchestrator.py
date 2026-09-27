"""Assistant orchestrator — clarification then tool execution."""

import copy
import json
import logging
import re
import time
from collections.abc import Generator
from typing import Any

from aeva.common.errors import ERROR_CODES, CustomError
from aeva.feature_flag import feature_flag_service
from aeva.llm import prompts
from aeva.llm.llm_client import LLMClient
from aeva.mcp.base import (
    ACTION_OPEN_FLASHCARDS,
    ACTION_OPEN_QUIZ,
    LEARNING_ACTIONS,
    BaseTool,
    PriorResult,
    ToolContext,
    ToolDefinition,
)
from aeva.mcp.registry import ToolRegistry
from aeva.orchestration.agent_runner import AgentRunner, TeamOutcome
from aeva.orchestration.model_candidates import models_for, resolve_model
from aeva.orchestration.models import (
    ANSWER_TOOLS,
    GENERATOR_TOOLS,
    STEP_INPUT_ANSWER,
    STEP_INPUT_MESSAGE,
    STEP_KIND_ANSWER,
    STEP_KIND_GENERATOR,
    AssistantContext,
    AssistantResult,
    ClarificationAction,
    ClarificationQuestion,
    ClarificationRequest,
    FlashcardOptions,
    QuizOptions,
    RunStatus,
    Step,
)
from aeva.supabase.supabase_service import SupabaseService

logger = logging.getLogger(__name__)

# Exact greetings / acknowledgements that never warrant learning-action chips.
_SMALLTALK = frozenset({
    "hi", "hello", "hey", "hiya", "howdy", "yo",
    "thanks", "thank you", "thx", "ok", "okay", "k", "kk", "cool", "nice",
    "bye", "goodbye", "good morning", "good afternoon", "good evening",
    "how are you", "what's up", "whats up", "sup",
})

# Demonstratives that stand in for a subject the request never names. Used only
# to PRESERVE a clarification the planner already asked for — so over-matching
# common words here cannot, on its own, trigger an unwanted clarification.
_REFERENCE_RE = re.compile(
    r"\b(this|that|these|those|the above|the following)\b",
)

# Repeat cues in a keyword-less follow-up ("create again", "another one",
# "one more") that mean "do the last thing again" rather than start a web
# search. Resolved against the previous turn's tool by _continuation_plan.
_REPEAT_RE = re.compile(
    r"\b(again|another|one more|once more|redo|re-?generate|"
    r"do it again|same (?:again|thing)|more of (?:these|those|them))\b",
)

# Tools whose "do it again" is unambiguous — a fresh quiz / flashcard set.
# web_search / media_llm are excluded: repeating them verbatim is rarely
# what the user means, so those fall through to normal routing.
_REPEATABLE_TOOLS = frozenset({"quiz_generator", "flashcard_generator"})

# Generator agents per turn (quiz + flashcards + image at most).
_MAX_GENERATORS = 3
_QUIZ_WORDS = ("quiz", "practice test", "test me")

# Cues that a question hinges on external, up-to-date information Aeva cannot
# already know — the only case the deterministic fast path routes to
# web_search. Everything else answers from Aeva's own knowledge (`general`),
# so greetings, identity questions, and concept explanations never search.
# Ambiguous cases still fall through to the planner, which weighs freshness
# with full context.
_FRESH_INFO_RE = re.compile(
    r"\b(latest|newest|current(?:ly)?|today|tonight|right now|as of|"
    r"recent(?:ly)?|up[- ]?to[- ]?date|this (?:week|month|year)|"
    r"news|headlines?|weather|forecast|temperature|"
    r"stock|share price|prices?|cost|exchange rate|score|standings|"
    r"who won|winner of|release date|released|launching|"
    r"schedule|deadline|exam date|admit card|result date|notification|"
    # Commerce cues: nobody wants a from-memory guess at specs or prices.
    r"specs?|specifications?|reviews?|cheapest|budget|worth (?:buying|it)|"
    r"which (?:one )?should i (?:buy|get|choose|pick)|"
    r"iphone|galaxy|pixel|macbook|ipad|oneplus|playstation|xbox|airpods)\b"
    r"|\b20\d{2}\b|\bsearch (?:the web|online|for)\b|\bgoogle it\b",
    re.IGNORECASE,
)

# "best/top/cheapest/latest <thing>" and "<model number> vs" — product or
# choice questions whose honest answer needs current data, even when no
# freshness word appears. Deliberately NOT bare "best"/"compare"/"vs": those
# also open academic questions ("best way to revise", "mitosis vs meiosis").
_PRODUCT_INTENT_RE = re.compile(
    r"\b(best|top|cheapest|latest|newest|good)\b.{0,40}\b(phones?|iphones?|"
    r"laptops?|tablets?|earbuds|headphones|cameras?|watch(?:es)?|tvs?|"
    r"consoles?|gpus?|bikes?|cars?|scooters?|courses?|colleges?|"
    r"universit(?:y|ies)|institutes?|books?|apps?|models?|brands?)\b"
    r"|\b\w+ ?\d{1,3}\w*\b.{0,20}\b(vs\.?|versus)\b",
    re.IGNORECASE,
)


def _needs_fresh_info(text: str) -> bool:
    """Report whether a message clearly depends on up-to-date information."""
    return bool(_FRESH_INFO_RE.search(text))


def _needs_web_upgrade(text: str) -> bool:
    """Report whether a `general` plan should be promoted to `web_search`.

    Catches product/choice questions ("suggest the best iPhone 17 model",
    "top colleges for CSE", "Pixel 9 vs iPhone 16") that the planner tends
    to answer from memory; concept questions never match.
    """
    return bool(_PRODUCT_INTENT_RE.search(text)) or _needs_fresh_info(text)


# Messages that are ONLY pleasantries — the one case cheap enough for the
# dedicated fast model. The whole message must match: "hello, explain
# photosynthesis" is a real question and must NOT ride the fast path.
_SMALL_TALK_RE = re.compile(
    r"^[\s!.,?\U0001F300-\U0001FAFF☀-➿]*(?:"
    r"(?:hi+|hello+|hey+|yo|namaste|hola|"
    r"good\s+(?:morning|afternoon|evening|night)|"
    r"thanks?(?:\s+you)?(?:\s+(?:a\s+lot|so\s+much|very\s+much))?|thx|ty|"
    r"shukriya|dhanyavaad?|"
    r"bye+|goodbye|see\s+(?:ya|you)(?:\s+later)?|tata|gtg|"
    r"ok(?:ay)?+|k+|cool|nice|great|awesome|perfect|got\s+it|"
    r"hmm+|haan?|acc?hh?a|theek\s+hai|sahi\s+hai|"
    r"no\s+problem|you'?re\s+welcome|welcome|please|pls)"
    r"[\s!.,?\U0001F300-\U0001FAFF☀-➿]*)+$",
    re.IGNORECASE,
)


def _is_small_talk(text: str) -> bool:
    """True when the message contains nothing but greetings/thanks/acks."""
    return len(text) <= 80 and bool(_SMALL_TALK_RE.match(text.strip()))


# A standing language request ("from now onwards talk in Hinglish", "hamesha
# hindi me baat karo") needs BOTH a durability cue and a language name — a
# one-off "explain this in hindi" has no cue and stays per-message.
_STANDING_CUE_RE = re.compile(
    r"\b(?:from now on(?:wards)?|always|permanently|going forward|"
    r"hamesha|ab se|aage se)\b",
    re.IGNORECASE,
)
_LANGUAGE_WORD_RE = re.compile(
    r"\b(hinglish|hindi|english)\b", re.IGNORECASE
)


def _standing_language_request(text: str) -> str | None:
    """Language the user asked to switch to permanently, or ``None``.

    Deterministic (no LLM call): requires a durability cue AND a language
    name in the same message. Returns the canonical profile value
    ("Hinglish" / "Hindi" / "English").
    """
    if not _STANDING_CUE_RE.search(text):
        return None
    match = _LANGUAGE_WORD_RE.search(text)
    return match.group(1).capitalize() if match else None


class AssistantOrchestrator:
    """Single coordinator: plan → clarify or run tool → respond."""

    def __init__(
        self,
        llm: LLMClient | None = None,
        registry: ToolRegistry | None = None,
        supabase: SupabaseService | None = None,
    ) -> None:
        self._llm = llm
        self._registry = registry
        self._supabase = supabase
        # Developer Mode flag for the CURRENT turn's user. Set by
        # _setup_and_plan from the profile row it already fetches, so normal
        # users pay no extra lookup. One orchestrator instance serves one
        # request (see assistant_repository), so instance state is safe.
        self._debug_enabled = False

    @property
    def llm(self) -> LLMClient:
        """Lazy LLM client."""
        return self._llm or LLMClient(config_key="LLM_ORCHESTRATOR_MODEL")

    @property
    def registry(self) -> ToolRegistry:
        """Lazy tool registry."""
        if self._registry is None:
            from flask import current_app

            container = current_app.extensions["container"]
            return container.tool_registry()
        return self._registry

    @property
    def supabase(self) -> SupabaseService:
        """Lazy Supabase client."""
        return self._supabase or SupabaseService()

    def run(self, ctx: AssistantContext) -> AssistantResult:
        """Execute one assistant turn (non-streaming)."""
        t_start = time.perf_counter()
        session, history, enriched_message, plan, personalization = (
            self._setup_and_plan(ctx)
        )
        planning_ms = int((time.perf_counter() - t_start) * 1000)
        debug_enabled = self._debug_enabled

        if self._should_open_quiz_setup(plan, ctx, enriched_message):
            return self._quiz_setup_result(plan, ctx)

        if plan.get("action") == "clarify":
            return self._handle_clarification(ctx, plan, enriched_message)

        steps = self._normalize_steps(plan, enriched_message)
        runner = self._runner(
            ctx, session, history, enriched_message, personalization
        )
        t_tool = time.perf_counter()
        outcome = self._drain(runner.run(steps))
        tool_ms = int((time.perf_counter() - t_tool) * 1000)
        display_text, _badge = self._finish_turn(
            plan, ctx, history, outcome, planning_ms, tool_ms, t_start,
            debug_enabled=debug_enabled,
        )
        msg = self._persist_answer(
            ctx,
            session,
            outcome.tool_used,
            outcome.result,
            display_text,
            tools_used=outcome.tools_used,
        )
        return AssistantResult(
            status=RunStatus.COMPLETED,
            tool_used=outcome.tool_used,
            tools_used=outcome.tools_used,
            content=outcome.result,
            message_id=msg["id"],
            display_text=display_text,
        )

    def run_stream(
        self, ctx: AssistantContext
    ) -> Generator[str, None, None]:
        """Execute one assistant turn, streaming the answer as SSE frames."""
        logger.info(
            "Assistant turn (stream) | session=%s | media=%d | msg=%r",
            ctx.session_id,
            len(ctx.media_ids or []),
            (ctx.message or "")[:80],
        )
        t_start = time.perf_counter()
        session, history, enriched_message, plan, personalization = (
            self._setup_and_plan(ctx)
        )
        planning_ms = int((time.perf_counter() - t_start) * 1000)
        debug_enabled = self._debug_enabled
        logger.info(
            "Turn planned | action=%s | steps=%s",
            plan.get("action"),
            [s.get("tool") for s in self._plan_steps(plan)],
        )

        # Quiz requested but not yet configured -> open the setup popover
        # first, pre-filled with whatever the planner detected. Explicit
        # settings in the message and multi-agent chains run straight away.
        if self._should_open_quiz_setup(plan, ctx, enriched_message):
            logger.info("Turn → quiz setup popover (pre-filled)")
            yield self._quiz_setup_frame(plan, ctx)
            return

        if plan.get("action") == "clarify":
            logger.info("Turn → clarification requested")
            clar = self._handle_clarification(ctx, plan, enriched_message)
            yield self._clarification_frame(clar)
            return

        steps = self._normalize_steps(plan, enriched_message)
        logger.info(
            "Turn → agents: %s",
            [f"{s.tool}[{s.input}]" for s in steps],
        )
        runner = self._runner(
            ctx, session, history, enriched_message, personalization
        )
        t_tool = time.perf_counter()
        outcome = yield from runner.run(steps)
        tool_ms = int((time.perf_counter() - t_tool) * 1000)

        display_text, badge = self._finish_turn(
            plan, ctx, history, outcome, planning_ms, tool_ms, t_start,
            debug_enabled=debug_enabled,
        )
        if badge:
            yield LLMClient.format_sse_chunk(badge)
        self._persist_answer(
            ctx,
            session,
            outcome.tool_used,
            outcome.result,
            display_text,
            tools_used=outcome.tools_used,
        )
        logger.info(
            "Turn complete | tools=%s | answer=%dchars | actions=%s | "
            "followups=%d",
            outcome.tools_used,
            len(display_text or ""),
            outcome.result.get("available_actions"),
            len(outcome.result.get("suggested_followups") or []),
        )
        yield LLMClient.format_sse_chunk(
            "",
            done=True,
            extra={
                "tool_used": outcome.tool_used,
                "tools_used": outcome.tools_used,
                "content": outcome.result,
            },
        )

    # ------------------------------------------------------------ agents

    def _runner(
        self,
        ctx: AssistantContext,
        session: dict[str, Any],
        history: list[dict[str, str]],
        enriched_message: str,
        personalization: str,
    ) -> AgentRunner:
        """Build the agent runner for this turn (binds the tool context)."""
        from flask import current_app

        app = current_app._get_current_object()  # type: ignore[attr-defined]  # noqa: SLF001
        cfg = current_app.config

        def build_ctx(step: Step, prior: list[PriorResult]) -> ToolContext:
            tool_ctx = self._build_tool_ctx(
                ctx, enriched_message, history, personalization,
                step.model, step.config_key, session.get("space_id"),
            )
            tool_ctx.prior_results = list(prior)
            return tool_ctx

        return AgentRunner(
            self.registry,
            app,
            build_ctx=build_ctx,
            stream_answer=self._stream_answer,
            split_meta=self._split_answer_meta,
            format_display=self._format_display,
            max_parallel=int(cfg.get("AGENT_MAX_PARALLEL", 3)),
            step_timeout_s=float(cfg.get("AGENT_STEP_TIMEOUT_S", 90)),
        )

    @staticmethod
    def _drain(
        frames: Generator[str, None, TeamOutcome],
    ) -> TeamOutcome:
        """Run a frame generator to completion, discarding the frames."""
        try:
            while True:
                next(frames)
        except StopIteration as stop:
            outcome: TeamOutcome = stop.value
            return outcome

    def _finish_turn(
        self,
        plan: dict[str, Any],
        ctx: AssistantContext,
        history: list[dict[str, str]],
        outcome: TeamOutcome,
        planning_ms: int,
        tool_ms: int,
        t_start: float,
        *,
        debug_enabled: bool,
    ) -> tuple[str, str]:
        """Stamp actions/diagnostics/badge; return (display_text, badge)."""
        result = outcome.result
        retrieval_diag = result.pop("_retrieval", None)
        self._attach_actions(outcome.tool_used, result, meta=outcome.meta)
        self._add_generator_actions(result)
        display_text = outcome.display_text
        dropped = plan.get("_dropped") or []
        if dropped:
            note = self._dropped_note(dropped)
            display_text = f"{display_text}\n\n{note}".strip()
            result["answer"] = f"{result.get('answer', '')}\n\n{note}".strip()
        if debug_enabled:
            result["model"] = outcome.primary_model
            result["debug"] = self._debug_info(
                plan, ctx, history, outcome.tool_used, outcome.primary_model,
                outcome.primary_config_key, planning_ms, tool_ms, t_start,
                streamed=outcome.streamed,
                agents=[a.to_public() for a in outcome.agents],
            )
            if retrieval_diag:
                result["debug"]["retrieval"] = retrieval_diag
        badge = self._model_badge(outcome.primary_model, debug_enabled)
        if badge:
            result["model"] = outcome.primary_model
            display_text = (display_text or "") + badge
        return display_text, badge

    @staticmethod
    def _dropped_note(dropped: list[str]) -> str:
        """Tell the student which requested generator is switched off."""
        labels = {
            "image_generator": "Image generation",
            "web_search": "Web search",
        }
        names = ", ".join(labels.get(t, t) for t in dropped)
        return f"_({names} is currently turned off.)_"

    @staticmethod
    def _add_generator_actions(result: dict[str, Any]) -> None:
        """Offer the open-card actions for artifacts produced this turn."""
        actions = list(result.get("available_actions") or [])
        if result.get("quiz") and ACTION_OPEN_QUIZ not in actions:
            actions.append(ACTION_OPEN_QUIZ)
        if result.get("flashcards") and ACTION_OPEN_FLASHCARDS not in actions:
            actions.append(ACTION_OPEN_FLASHCARDS)
        result["available_actions"] = actions

    @staticmethod
    def _plan_steps(plan: dict[str, Any]) -> list[dict[str, Any]]:
        """Raw step dicts of a plan (legacy single ``tool`` plans included)."""
        steps = plan.get("steps")
        if isinstance(steps, list) and steps:
            return [s for s in steps if isinstance(s, dict)]
        tool = plan.get("tool")
        if isinstance(tool, dict) and tool.get("name"):
            return [
                {
                    "tool": tool["name"],
                    "model": tool.get("model"),
                    "params": tool.get("params") or {},
                }
            ]
        return []

    @staticmethod
    def _answer_index(steps: list[dict[str, Any]]) -> int | None:
        """Index of the answer step (the one that streams text), if any."""
        for index, step in enumerate(steps):
            if step.get("tool") in ANSWER_TOOLS:
                return index
        return None

    def _primary_tool(self, plan: dict[str, Any]) -> str | None:
        """Tool that defines the turn's intent: the answer step, else first."""
        steps = self._plan_steps(plan)
        index = self._answer_index(steps)
        if index is not None:
            return str(steps[index].get("tool"))
        return str(steps[0].get("tool")) if steps else None

    def _normalize_steps(
        self, plan: dict[str, Any], message: str
    ) -> list[Step]:
        """Turn a plan into the ordered agent roster the runner executes.

        Keeps the first answer tool (streams), then up to three distinct
        generators. Flag-disabled generators are dropped (and noted); a
        disabled answer tool degrades to ``general``. Generators default to
        ``input="answer"`` when an answer step exists, else ``"message"``.
        The fast-path model override applies to the answer step only.
        """
        flags = feature_flag_service.get_flags()
        answer: Step | None = None
        generators: list[Step] = []
        dropped: list[str] = []
        for item in self._plan_steps(plan):
            name = str(item.get("tool") or "")
            params = dict(item.get("params") or {})
            if not self._tool_enabled(name, flags):
                if name in ANSWER_TOOLS:
                    logger.warning(
                        "Tool %s disabled by feature flag; using general",
                        name,
                    )
                    query = (
                        params.get("query")
                        or params.get("prompt")
                        or params.get("topic")
                        or message
                    )
                    name, params = "general", {"query": query}
                else:
                    dropped.append(name)
                    continue
            purpose = str(item.get("purpose") or "")
            if name in ANSWER_TOOLS:
                if answer is None:
                    answer = Step(
                        id="answer",
                        tool=name,
                        kind=STEP_KIND_ANSWER,
                        params=params,
                        model=resolve_model(name, item.get("model")),
                        purpose=purpose,
                    )
                continue
            if (
                name not in GENERATOR_TOOLS
                or any(g.tool == name for g in generators)
                or len(generators) >= _MAX_GENERATORS
            ):
                continue
            requested = item.get("input")
            generators.append(
                Step(
                    id=f"gen{len(generators) + 1}",
                    tool=name,
                    kind=STEP_KIND_GENERATOR,
                    params=params,
                    model=resolve_model(name, item.get("model")),
                    purpose=purpose,
                    input=(
                        str(requested)
                        if requested in (STEP_INPUT_MESSAGE, STEP_INPUT_ANSWER)
                        else STEP_INPUT_ANSWER
                    ),
                )
            )
        if answer is None and not generators:
            answer = Step(
                id="answer",
                tool="general",
                kind=STEP_KIND_ANSWER,
                params={"query": message},
                model=resolve_model("general", None),
            )
        if answer is not None:
            answer.model, answer.config_key = self._fast_override(
                plan, answer.model
            )
        else:
            for step in generators:
                step.input = STEP_INPUT_MESSAGE
        if dropped:
            plan["_dropped"] = dropped
        return ([answer] if answer else []) + generators

    def _setup_and_plan(
        self, ctx: AssistantContext
    ) -> tuple[
        dict[str, Any], list[dict[str, str]], str, dict[str, Any], str
    ]:
        """Shared prep for both run paths: load, record, and plan the turn.

        Returns ``(session, history, enriched_message, plan, personalization)``.
        The personalization block is built once here from the user's profile and
        reused for both planning (so clarifications honour the language) and the
        tool execution.
        """
        session = self.supabase.get_session(ctx.session_id, ctx.user_id)
        if not session:
            raise CustomError(ERROR_CODES["NOT_FOUND"])

        profile = self.supabase.get_profile(ctx.user_id)
        # Developer Mode rides the profile row that personalization already
        # needs — deciding it costs normal users nothing extra.
        self._debug_enabled = bool((profile or {}).get("is_debug_user"))
        # A standing language request ("from now on talk in Hinglish") is
        # persisted to the profile so it survives new sessions — and applied
        # to THIS turn by patching the already-fetched profile row.
        language = _standing_language_request(ctx.message)
        if language and (
            str((profile or {}).get("preferred_language") or "").lower()
            != language.lower()
        ):
            try:
                self.supabase.update_learning_profile(
                    ctx.user_id, {"preferred_language": language}
                )
                profile = {**(profile or {}), "preferred_language": language}
                logger.info(
                    "Persisted standing language preference: %s", language
                )
            except Exception:
                # Never fail the turn over a preference write; the in-chat
                # request still applies via the conversation itself.
                logger.exception("Failed to persist language preference")
        # Identity first: the student's name applies even when onboarding was
        # skipped, so Aeva never "forgets" who she is talking to.
        personalization = prompts.build_identity_block(profile)
        personalization += prompts.build_personalization_block(profile)
        # Study Space context rides the session fetch (embedded relation, no
        # extra query). General/legacy sessions contribute nothing, so
        # non-adopters get byte-identical prompts.
        personalization += prompts.build_space_block(
            session.get("study_spaces")
        )
        history = self._get_history(ctx.session_id)
        enriched_message = ctx.message

        # An action targeting a specific card carries its own content. Ground
        # the turn ONLY on that content and drop conversation history so the
        # action never picks up a later, unrelated response.
        if ctx.source_content:
            history = []
            enriched_message = (
                f"{ctx.message}\n\nUse ONLY the following content as the "
                'source.'
                f'conversation:\n"""\n{ctx.source_content}\n"""'
            )

        media_choice_ids: list[str] | None = None
        media_choice_query: str | None = None
        if ctx.run_id and ctx.clarification:
            run = self._get_run(ctx.run_id, ctx.user_id)
            if not run:
                raise CustomError(ERROR_CODES["CLARIFICATION_EXPIRED"])
            plan_questions = (
                (run.get("plan") or {}).get("clarification") or {}
            ).get("questions") or []
            enriched_message = self._merge_clarification(
                run["original_message"],
                ctx.clarification,
                {q["id"]: q["text"] for q in plan_questions if q.get("id")},
            )
            if (run.get("plan") or {}).get("kind") == "media_choice":
                media_choice_ids = self._resolve_media_choice(
                    run["plan"], ctx.clarification
                )
                # Retrieval must search for the QUESTION, not the merged
                # "the user answered: Choose a file: X" text.
                media_choice_query = run.get("original_message") or None
            self._complete_run(ctx.run_id)

        # Clarification replies are invisible: the answers are folded into the
        # enriched message for the tool, but no user bubble is persisted — on
        # reload the answer reads as a direct continuation of the original ask.
        if not (ctx.run_id and ctx.clarification):
            self.supabase.add_message(ctx.session_id, "user", ctx.message)

        # Deterministic plans (resolved file choice, popover-driven quiz/flash)
        # skip LLM planning entirely. Each path stamps `_source` (internal,
        # never persisted) so Developer Mode can show WHY a tool was chosen.
        forced = self._forced_plan(ctx, media_choice_ids, media_choice_query)
        if forced is not None:
            forced["_source"] = "forced"
            return session, history, enriched_message, forced, personalization

        # Several files selected + a vague request -> ask which file to use.
        if not ctx.clarification and ctx.media_ids and len(ctx.media_ids) > 1:
            decision = self._disambiguate_media(ctx, enriched_message)
            if decision is not None:
                decision["_source"] = "media_choice"
                return (
                    session, history, enriched_message, decision,
                    personalization,
                )

        # "Create again" / "another one" -> repeat the last generator tool
        # instead of falling through to a web search.
        cont = self._continuation_plan(ctx, enriched_message)
        if cont is not None:
            logger.info(
                "Turn → continuation of last tool: %s", self._primary_tool(cont)
            )
            cont["_source"] = "continuation"
            return session, history, enriched_message, cont, personalization

        # Deterministic outcome -> skip the planner LLM call entirely.
        fast = self._fast_path_plan(ctx, enriched_message, history)
        if fast is not None:
            logger.info("Turn planned deterministically (no plan LLM call)")
            fast["_source"] = "fast_path"
            return session, history, enriched_message, fast, personalization

        plan = self._plan_turn(
            ctx, history, enriched_message, ctx.clarification
        )
        plan = self._refine_plan(plan, ctx, enriched_message, history)
        plan["_source"] = "planner"
        plan = self._media_routing_guard(plan, ctx, enriched_message)
        return session, history, enriched_message, plan, personalization

    def _forced_plan(
        self,
        ctx: AssistantContext,
        media_choice_ids: list[str] | None,
        media_choice_query: str | None = None,
    ) -> dict[str, Any] | None:
        """Deterministic plan that bypasses the planner, or None to plan.

        ``media_choice_query`` is the student's original question when the
        turn resolves a "which file?" clarification; it becomes the retrieval
        query so the vector search is not polluted by the clarification text.
        """
        if media_choice_ids is not None:
            # A resolved "which file?" answer runs media_llm on the choice.
            params: dict[str, Any] = {"media_ids": media_choice_ids}
            if media_choice_query:
                params["query"] = media_choice_query
            return self._single_step("media_llm", params)
        if ctx.flashcard_options is not None:
            # Create Flashcards action forces flashcard generation.
            return self._single_step(
                "flashcard_generator",
                self._flashcard_params(ctx.flashcard_options),
            )
        if ctx.quiz_options is not None:
            # Explicit quiz settings from the setup popover.
            return self._single_step(
                "quiz_generator",
                self._quiz_params_from_options(ctx.quiz_options),
            )
        return None

    @staticmethod
    def _single_step(tool: str, params: dict[str, Any]) -> dict[str, Any]:
        """A run_tool plan with exactly one step."""
        return {
            "action": "run_tool",
            "steps": [{"tool": tool, "params": params}],
        }

    def _refine_plan(
        self,
        plan: dict[str, Any],
        ctx: AssistantContext,
        enriched_message: str,
        history: list[dict[str, str]],
    ) -> dict[str, Any]:
        """Apply the over-clarification guard.

        A "clarify" plan is downgraded to a tool only when clarification is
        genuinely unnecessary AND the message has no unresolved reference that
        forces it. Follow-up chips are no longer decided here — they are derived
        from the finished answer in ``_attach_actions``.
        """
        # Hard contract: once the user has responded to a clarification
        # (answered OR skipped), this turn MUST answer. Never re-clarify.
        if plan.get("action") == "clarify" and ctx.clarification is not None:
            logger.info("Blocking repeat clarification after user response")
            return self._fallback_tool_plan(ctx, enriched_message)

        if (
            plan.get("action") == "clarify"
            and not self._has_unresolved_reference(
                enriched_message, ctx, history
            )
            and self._clarification_unnecessary(
                enriched_message, ctx, history
            )
        ):
            logger.info(
                "Skipping unnecessary clarification for: %s",
                enriched_message[:80],
            )
            plan = self._fallback_tool_plan(ctx, enriched_message)

        return self._web_upgrade(plan, enriched_message)

    @staticmethod
    def _web_upgrade(plan: dict[str, Any], message: str) -> dict[str, Any]:
        """Promote a from-memory plan to web_search for product questions.

        The planner is biased toward `general`; "suggest the best iPhone 17
        model" answered from training data is stale and often wrong. When
        the wording signals a product/choice/fresh-data question and web
        search is enabled, the answer step is switched to `web_search` with
        a guessed intent. Media-attached turns are left to the media guard.
        """
        steps = AssistantOrchestrator._plan_steps(plan)
        index = AssistantOrchestrator._answer_index(steps)
        if (
            plan.get("action") != "run_tool"
            or index is None
            or steps[index].get("tool") != "general"
            or not _needs_web_upgrade(message)
            or not feature_flag_service.is_enabled("web_search")
        ):
            return plan
        params = steps[index].get("params") or {}
        query = params.get("query") or message
        logger.info("Upgrading general -> web_search (product/fresh intent)")
        steps[index] = {
            **steps[index],
            "tool": "web_search",
            "params": {
                "query": query,
                "search_intent": prompts.guess_search_intent(message),
            },
        }
        plan["steps"] = steps
        plan.pop("tool", None)
        plan["_upgraded"] = True
        return plan

    @staticmethod
    def _media_routing_guard(
        plan: dict[str, Any],
        ctx: AssistantContext,
        message: str,
    ) -> dict[str, Any]:
        """Keep study questions on ``media_llm`` while files are selected.

        The planner only sees a one-line media hint and is told ``general``
        is the default, so "what is osmosis?" with a biology PDF attached
        can route to a from-memory answer that never opens the document.
        A selected file is the student's explicit instruction to use it:
        a ``general`` plan (unless the message is pure small talk) or a
        ``web_search`` plan with no fresh-information cue is rewritten to
        ``media_llm`` over the selected ids. ``product_info``, generators,
        image requests, and clarifications are left alone.
        """
        if not ctx.media_ids or plan.get("action") != "run_tool":
            return plan
        steps = AssistantOrchestrator._plan_steps(plan)
        index = AssistantOrchestrator._answer_index(steps)
        if index is None:
            return plan
        name = steps[index].get("tool")
        divert = (name == "general" and not _is_small_talk(message)) or (
            name == "web_search" and not _needs_fresh_info(message)
        )
        if not divert:
            return plan
        params = steps[index].get("params") or {}
        query = params.get("query") or message
        logger.info(
            "Media guard: %s -> media_llm (files selected)", name
        )
        steps[index] = {
            **steps[index],
            "tool": "media_llm",
            "params": {"query": query, "media_ids": list(ctx.media_ids)},
        }
        plan["steps"] = steps
        plan.pop("tool", None)
        plan["_source"] = f"{plan.get('_source', 'planner')}+media_guard"
        return plan

    @staticmethod
    def _fast_override(
        plan: dict[str, Any], tool_model: str | None
    ) -> tuple[str | None, str | None]:
        """Redirect a fast-turn plan to its dedicated model/provider config.

        Returns ``(model, config_key)``. When the fast path tagged the plan with
        a ``model_config_key``, the tool resolves through that config pair and
        the model is that config's value (first entry if it holds a list, so the
        badge and logs show the real single model). Otherwise unchanged.
        """
        key = plan.get("model_config_key")
        if not key:
            return tool_model, None
        from flask import current_app

        raw = current_app.config.get(key) or ""
        model = raw.split(",")[0].strip() or tool_model
        return model, key

    @staticmethod
    def _model_badge(model: str | None, debug_enabled: bool = False) -> str:
        """Return a "powered by: <model>" trailer (empty unless enabled).

        Shown to Developer Mode users (``profiles.is_debug_user``, managed
        from the admin panel) or when the global ``SHOW_MODEL_BADGE`` env
        override is on (local dev/QA) — never to normal users. Display-only:
        it is appended to the display text, never to ``result["answer"]``, so
        the stored answer stays clean.
        """
        from flask import current_app

        enabled = debug_enabled or bool(
            current_app.config.get("SHOW_MODEL_BADGE")
        )
        if not model or not enabled:
            return ""
        return f"\n\n---\n_⚡ powered by: {model}_"

    @staticmethod
    def _debug_info(
        plan: dict[str, Any],
        ctx: AssistantContext,
        history: list[dict[str, str]],
        tool_name: str,
        tool_model: str | None,
        tool_config_key: str | None,
        planning_ms: int,
        tool_ms: int,
        t_start: float,
        streamed: bool,
        agents: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Diagnostics block attached to responses for Developer Mode users.

        Rides ``result["debug"]`` so it streams with the done frame, persists
        under ``metadata.content.debug``, and reloads with history. Only ever
        attached when the user is a debug user — normal responses carry no
        trace of it. Extend freely: the client renders unknown keys
        generically.
        """
        return {
            # Orchestrator
            "tool": tool_name,
            "model": tool_model,
            "model_config_key": tool_config_key,
            "plan_source": plan.get("_source", "planner"),
            "plan_action": plan.get("action", "run_tool"),
            "plan_upgraded": bool(plan.get("_upgraded")),
            "clarification_round": bool(ctx.run_id and ctx.clarification),
            # Context size
            "history_messages": len(history),
            "media_count": len(ctx.media_ids or []),
            # Timings
            "planning_ms": planning_ms,
            "tool_ms": tool_ms,
            "total_ms": int((time.perf_counter() - t_start) * 1000),
            "streamed": streamed,
            "agents": agents or [],
        }

    @staticmethod
    def _tool_line(t: "ToolDefinition") -> str:
        """One planner line per tool: description + its candidate models.

        The candidate set (in no particular order) is what lets the planner
        return a ``model`` alongside the tool. A tool with no configured
        candidates simply omits the models line and runs its own default.
        """
        line = f"- {t.name}: {t.description}"
        props = (t.parameters_schema or {}).get("properties") or {}
        if props:
            # Names only: the rules in the prompt explain each one, and the
            # planner cannot fill a parameter it has never seen listed.
            line += f"\n  params: {', '.join(props)}"
        models = models_for(t.name)
        if models:
            line += f"\n  available models: {', '.join(models)}"
        return line

    def _attach_actions(
        self,
        tool_name: str,
        result: dict[str, Any],
        tool: BaseTool | None = None,
        meta: dict[str, Any] | None = None,
    ) -> None:
        """Stamp response_type, available_actions, and suggested_followups.

        ``response_type`` is the tool's static category. Generator tools
        (quiz/flashcard) own a fixed action — a produced quiz always offers
        ``OPEN_QUIZ`` — so those ride verbatim. For a text answer the follow-up
        chips come from ``meta``: the metadata trailer the answer model appended
        in the SAME call (see ``_split_answer_meta``), so the chips are grounded
        in the actual answer at no extra LLM cost. All of it travels only in the
        final ``done`` SSE frame's ``content``.
        """
        if not isinstance(result, dict):
            return
        tool = tool or self.registry.get(tool_name)
        result["response_type"] = tool.response_type
        if tool.available_actions:
            result["available_actions"] = list(tool.available_actions)
            result.setdefault("suggested_followups", [])
            return
        meta = meta or {"available_actions": [], "suggested_followups": []}
        result["available_actions"] = meta.get("available_actions", [])
        # A tool may supply its own chips when the answer carried no trailer
        # (e.g. the "nothing found in your files" reply offers a general-
        # knowledge retry); the model's trailer wins when present.
        result["suggested_followups"] = meta.get("suggested_followups") or (
            result.get("suggested_followups") or []
        )

    def _stream_answer(
        self, gen: Generator[str, None, dict[str, Any]]
    ) -> Generator[str, None, tuple[str, dict[str, Any]]]:
        """Yield only the answer text, holding back the metadata trailer.

        The answer model appends ``META_SENTINEL`` + JSON after its reply. This
        streams the answer chunks but buffers a short tail so the sentinel is
        never leaked to the client, even when it straddles two chunks. Returns
        ``(raw_text, tool_result)`` — raw_text is the full model output
        including the trailer, for the caller to split.
        """
        sentinel = prompts.META_SENTINEL
        hold = len(sentinel)
        raw = ""
        emitted = 0
        stopped = False
        result: dict[str, Any] = {}
        try:
            while True:
                raw += next(gen)
                if stopped:
                    continue
                idx = raw.find(sentinel)
                if idx != -1:
                    if idx > emitted:
                        yield raw[emitted:idx]
                    emitted = idx
                    stopped = True
                else:
                    safe = len(raw) - (hold - 1)
                    if safe > emitted:
                        yield raw[emitted:safe]
                        emitted = safe
        except StopIteration as stop:
            result = stop.value or {}
        if not stopped and emitted < len(raw):
            yield raw[emitted:]
        return raw, result

    def _split_answer_meta(
        self, text: str
    ) -> tuple[str, dict[str, Any]]:
        """Split full model output into (visible answer, parsed metadata)."""
        empty: dict[str, Any] = {
            "available_actions": [],
            "suggested_followups": [],
        }
        idx = text.find(prompts.META_SENTINEL)
        if idx == -1:
            return text, empty
        answer = text[:idx].rstrip()
        tail = text[idx + len(prompts.META_SENTINEL):]
        return answer, self._parse_meta(tail)

    @staticmethod
    def _parse_meta(tail: str) -> dict[str, Any]:
        """Parse the JSON metadata trailer, tolerating minor formatting."""
        empty: dict[str, Any] = {
            "available_actions": [],
            "suggested_followups": [],
        }
        try:
            start = tail.index("{")
            end = tail.rindex("}") + 1
            data = json.loads(tail[start:end])
        except ValueError:
            return empty
        if not isinstance(data, dict):
            return empty
        actions = [
            a
            for a in (data.get("available_actions") or [])
            if a in LEARNING_ACTIONS
        ]
        followups = [
            {"title": f.get("title", ""), "prompt": f.get("prompt", "")}
            for f in (data.get("suggested_followups") or [])
            if isinstance(f, dict) and f.get("title") and f.get("prompt")
        ]
        return {
            "available_actions": actions,
            "suggested_followups": followups,
        }

    def _selected_media(
        self, ctx: AssistantContext
    ) -> list[dict[str, str]]:
        """Resolve selected media ids to {id, name} (single DB call)."""
        if not ctx.media_ids:
            return []
        by_id = {m["id"]: m for m in self.supabase.list_media(ctx.user_id)}
        return [
            {"id": mid, "name": by_id[mid]["file_name"]}
            for mid in ctx.media_ids
            if mid in by_id
        ]

    @staticmethod
    def _names_in_message(
        message: str, files: list[dict[str, str]]
    ) -> list[dict[str, str]]:
        """Files whose name (or stem) is mentioned in the message."""
        text = message.lower()
        found = []
        for f in files:
            name = f["name"].lower()
            stem = name.rsplit(".", 1)[0]
            if name in text or (len(stem) > 2 and stem in text):
                found.append(f)
        return found

    def _disambiguate_media(
        self, ctx: AssistantContext, message: str
    ) -> dict[str, Any] | None:
        """Resolve which selected file(s) a vague request refers to.

        Returns a clarify plan (ask which file) when none is named, a narrowed
        media_llm plan when a subset is named, or None to plan normally.
        """
        files = self._selected_media(ctx)
        if len(files) <= 1:
            return None
        named = self._names_in_message(message, files)
        if not named:
            return {
                "action": "clarify",
                "kind": "media_choice",
                "files": files,
                "clarification": {
                    "reason": (
                        "You have several files selected. "
                        "Which one should I use?"
                    ),
                    "questions": [
                        {
                            "id": "media_choice",
                            "text": "Choose a file",
                            "options": [f["name"] for f in files]
                            + ["All files"],
                        }
                    ],
                },
            }
        if len(named) < len(files):
            return self._single_step(
                "media_llm", {"media_ids": [f["id"] for f in named]}
            )
        return None

    @staticmethod
    def _resolve_media_choice(
        plan: dict[str, Any], clarification: object
    ) -> list[str]:
        """Map a file-choice answer back to media ids (defaults to all)."""
        files = plan.get("files", [])
        all_ids = [f["id"] for f in files]

        texts: list[str] = []
        action = clarification.action  # type: ignore[attr-defined]
        if action == ClarificationAction.ANSWER and clarification.answers:  # type: ignore[attr-defined]
            texts = [str(v) for v in clarification.answers.values()]  # type: ignore[attr-defined]
        elif action == ClarificationAction.CUSTOM:
            texts = [clarification.custom_text or ""]  # type: ignore[attr-defined]
        if not texts:
            return all_ids

        chosen: list[str] = []
        for raw in texts:
            t = raw.lower()
            if "all" in t:
                return all_ids
            for f in files:
                name = f["name"].lower()
                stem = name.rsplit(".", 1)[0]
                matches = name == t or name in t or (len(stem) > 2 and stem in t)
                if matches and f["id"] not in chosen:
                    chosen.append(f["id"])
        return chosen or all_ids

    def _build_tool_ctx(
        self,
        ctx: AssistantContext,
        enriched_message: str,
        history: list[dict[str, str]],
        personalization: str,
        model: str | None = None,
        config_key: str | None = None,
        space_id: str | None = None,
    ) -> ToolContext:
        """Build the runtime context passed to a tool.

        ``personalization`` is the block already built in ``_setup_and_plan`` so
        the user's profile is loaded once per turn. ``model`` is the planner's
        per-turn model choice for this tool (``None`` = the tool's default);
        ``config_key`` overrides which ``LLM_*_MODEL``/``LLM_*_PROVIDER`` pair
        the tool resolves through (``None`` = the tool's own key).
        """
        return ToolContext(
            user_id=ctx.user_id,
            session_id=ctx.session_id,
            message=ctx.message,
            enriched_message=enriched_message,
            media_ids=ctx.media_ids,
            space_id=space_id,
            history=history,
            personalization=personalization,
            model=model,
            config_key=config_key,
        )

    def _persist_answer(
        self,
        ctx: AssistantContext,
        session: dict[str, Any],
        tool_name: str,
        result: dict[str, Any],
        display_text: str,
        tools_used: list[str] | None = None,
    ) -> dict[str, Any]:
        """Persist the assistant message and auto-title a fresh session."""
        msg = self.supabase.add_message(
            ctx.session_id,
            "assistant",
            display_text,
            metadata={
                "status": "completed",
                "tool_used": tool_name,
                "tools_used": list(tools_used or [tool_name]),
                "content": result,
            },
        )
        if session["title"] == "New chat":
            self.supabase.update_session(
                ctx.session_id, ctx.user_id, title=ctx.message[:60]
            )
        # Bump the space's activity clock (Continue Learning order) — only
        # for real spaces, so General-only users pay no extra write.
        space = session.get("study_spaces")
        if space and not space.get("is_default") and session.get("space_id"):
            self.supabase.touch_space(session["space_id"])
        return msg

    @staticmethod
    def _flashcard_params(opts: FlashcardOptions) -> dict[str, Any]:
        """Turn FlashcardOptions into flashcard_generator params."""
        params: dict[str, Any] = {}
        if opts.count is not None:
            params["count"] = opts.count
        return params

    @staticmethod
    def _quiz_params_from_options(opts: QuizOptions) -> dict[str, Any]:
        """Turn the popover's QuizOptions into quiz_generator params."""
        params: dict[str, Any] = {}
        if opts.topic:
            params["topic"] = opts.topic
        if opts.question_count is not None:
            params["question_count"] = opts.question_count
        if opts.difficulty:
            params["difficulty"] = opts.difficulty
        if opts.question_types:
            params["question_types"] = opts.question_types
        if opts.use_media is not None:
            params["use_media"] = opts.use_media
        if opts.additional_instructions:
            params["additional_instructions"] = opts.additional_instructions
        if opts.exam_config:
            params["exam_config"] = opts.exam_config
        return params

    def _should_open_quiz_setup(
        self, plan: dict[str, Any], ctx: AssistantContext, message: str
    ) -> bool:
        """Whether to collect quiz settings in the popover before running.

        The popover opens for a plain quiz request whose settings are not
        already in the message. It is skipped when the setup form was just
        submitted (``quiz_options``), for a flashcard turn, for a multi-agent
        chain (the student typed a compound instruction; planner params +
        defaults apply), and when the message already names both a count
        and a difficulty ("10 hard questions from this PDF").
        """
        if ctx.quiz_options is not None or ctx.flashcard_options is not None:
            return False
        steps = self._plan_steps(plan)
        tools = [str(s.get("tool") or "") for s in steps]
        if "flashcard_generator" in tools or len(steps) > 1:
            return False
        if tools and tools[0] == "quiz_generator":
            params = steps[0].get("params") or {}
            return not (
                params.get("question_count") and params.get("difficulty")
            )
        text = message.lower()
        return any(w in text for w in _QUIZ_WORDS)

    def _quiz_setup_data(
        self, plan: dict[str, Any], ctx: AssistantContext
    ) -> dict[str, Any]:
        """Payload to open the quiz-setup popover, pre-filled with what we know.

        Every field the planner already detected (topic, count, types,
        difficulty, whether to use the files) is sent so the form opens
        populated — the user only fills the genuinely missing pieces rather
        than re-entering everything.
        """
        quiz_step = next(
            (
                s
                for s in self._plan_steps(plan)
                if s.get("tool") == "quiz_generator"
            ),
            {},
        )
        tool_params = quiz_step.get("params") or {}
        return {
            "status": "quiz_setup",
            "topic": tool_params.get("topic") or "",
            "question_count": tool_params.get("question_count"),
            "question_types": tool_params.get("question_types"),
            "difficulty": tool_params.get("difficulty"),
            "exam_config": tool_params.get("exam_config") or {},
            "media_available": bool(ctx.media_ids),
            "use_media": (
                bool(tool_params["use_media"])
                if "use_media" in tool_params
                else None
            ),
        }

    def _quiz_setup_result(
        self, plan: dict[str, Any], ctx: AssistantContext
    ) -> AssistantResult:
        """Non-streaming quiz-setup result."""
        return AssistantResult(
            status=RunStatus.QUIZ_SETUP,
            content=self._quiz_setup_data(plan, ctx),
        )

    def _quiz_setup_frame(
        self, plan: dict[str, Any], ctx: AssistantContext
    ) -> str:
        """SSE frame telling the client to open the quiz-setup popover."""
        payload = {
            "type": "quiz_setup",
            "data": self._quiz_setup_data(plan, ctx),
            "done": True,
        }
        return f"data: {json.dumps(payload)}\n\n"

    @staticmethod
    def _clarification_frame(clar: AssistantResult) -> str:
        """Build the SSE clarification frame for the streaming path."""
        request = clar.clarification
        questions = request.questions if request else []
        payload = {
            "type": "clarification",
            "data": {
                "status": "clarification_required",
                "run_id": clar.run_id,
                "clarification": {
                    "reason": request.reason if request else "",
                    "questions": [
                        {"id": q.id, "text": q.text, "options": q.options}
                        for q in questions
                    ],
                },
                "message_id": clar.message_id,
            },
            "done": True,
        }
        return f"data: {json.dumps(payload)}\n\n"

    @staticmethod
    def _history_limit() -> int:
        """Configured number of recent messages to send as LLM context.

        Read from ``CHAT_HISTORY_LIMIT`` (see ``app.py``); ``0`` or a negative
        value means the whole session. Falls back to the config default when
        called outside an app context (unit tests).
        """
        try:
            from flask import current_app

            return int(current_app.config.get("CHAT_HISTORY_LIMIT", 20))
        except RuntimeError:
            return 20

    def _get_history(
        self, session_id: str, limit: int | None = None
    ) -> list[dict[str, str]]:
        """Recent message history, in chronological order.

        ``limit`` defaults to the ``CHAT_HISTORY_LIMIT`` config (env-driven);
        non-positive values include the full session. Trimming happens in the
        database query, so only the tail of long sessions is transferred.

        Each assistant turn also carries the ``tool`` that produced it (from the
        persisted ``metadata.tool_used``) so the planner can route follow-ups by
        which tool answered each earlier turn. The extra key is ignored by the
        LLM providers (they read only ``role``/``content``), so the same list
        doubles as the untagged history handed to the answer model.
        """
        if limit is None:
            limit = self._history_limit()
        recent = self.supabase.get_messages(
            session_id, limit=limit if limit > 0 else None
        )
        history: list[dict[str, str]] = []
        for m in recent:
            item = {"role": m["role"], "content": m["content"]}
            meta = m.get("metadata") or {}
            tool = meta.get("tool_used")
            tools = meta.get("tools_used") or []
            if m["role"] == "assistant" and tool:
                item["tool"] = tool
                if len(tools) > 1:
                    item["tools"] = ", ".join(str(t) for t in tools)
            history.append(item)
        return history

    @staticmethod
    def _history_for_planner(
        history: list[dict[str, str]],
    ) -> list[dict[str, str]]:
        """Annotate assistant turns with the tool that produced them.

        The planner routes follow-ups ("another one", "explain more", "quiz me
        on that") by pattern, so it needs to see which tool answered each
        earlier turn, in order. Each assistant turn is tagged ``[tool: NAME]``
        ahead of its content so the model can self-determine the right tool from
        the conversation itself. These tags are for planning only — the answer
        model receives the untagged ``history``.
        """
        annotated: list[dict[str, str]] = []
        for item in history:
            content = item["content"]
            tool = item.get("tool")
            tools = item.get("tools")
            if item["role"] == "assistant" and tools:
                content = f"[tools: {tools}]\n{content}"
            elif item["role"] == "assistant" and tool:
                content = f"[tool: {tool}]\n{content}"
            annotated.append({"role": item["role"], "content": content})
        return annotated

    def _fast_path_plan(
        self,
        ctx: AssistantContext,
        message: str,
        history: list[dict[str, str]],
    ) -> dict[str, Any] | None:
        """Deterministic plan that makes the planner LLM call unnecessary.

        Reserved for pure small talk ("hi", "thanks", "theek hai"): the tool is
        settled (``general``) and the dedicated fast model is plenty. EVERY
        real question — even a simple-looking definition — goes through the
        planner instead, because the planner is what picks a strong enough
        model from the tool's candidate list; a hardwired fast model here is
        exactly how confused mini-model science answers reached students.
        """
        text = message.lower()
        needs_planner = (
            # Anything beyond pleasantries needs a planner model choice.
            not _is_small_talk(message)
            # A clarification reply may carry tool-specific params.
            or ctx.clarification is not None
            # Media: media_llm vs a quiz/flashcard fork or a which-file ask.
            or bool(ctx.media_ids)
            # Quiz/flashcard need natural-language parameter extraction.
            or any(w in text for w in ("quiz", "practice test", "test me"))
            or "flashcard" in text
            or "flash card" in text
            # Possible image request ("draw…", "diagram of…") — the planner
            # decides between image_generator and a text answer.
            or any(
                w in text
                for w in (
                    "draw", "image", "picture", "diagram", "illustrat",
                    "sketch", "infographic", "visualize", "visualise",
                    "flowchart", "flow chart", "mind map", "timeline",
                    "poster", "chart", "graph", "comic", "line art",
                )
            )
            # A demonstrative with nothing to resolve it must be clarified.
            or self._has_unresolved_reference(message, ctx, history)
            # Genuinely open-ended -> let the planner decide clarify vs tool.
            or not self._clarification_unnecessary(message, ctx, history)
        )
        if needs_planner:
            return None
        plan = self._fallback_tool_plan(ctx, message)
        # A planner-free `general` turn (greeting, simple chat) may run on the
        # dedicated fast model/provider — the same create_provider flow, just a
        # different config key. web_search keeps its own config (it needs the
        # search grounding the fast provider may not support).
        if self._primary_tool(plan) == "general":
            plan["model_config_key"] = "LLM_FAST_MODEL"
        return plan

    def _plan_turn(
        self,
        ctx: AssistantContext,
        history: list[dict[str, str]],
        enriched_message: str,
        clarification: object | None,
    ) -> dict[str, Any]:
        """Ask the LLM to clarify or pick a tool.

        Runs a lean, token-minimal structured call: a one-line planner system
        prompt (not the answer-facing ``SYSTEM_PROMPT``), a compact one-line-per
        -tool list (the parameter rules live in the prompt, so shipping each
        tool's full JSON schema is redundant), and no personalization block —
        the planner emits JSON, never prose, so none of that changes its output.
        """
        flags = feature_flag_service.get_flags()
        tools_desc = "\n".join(
            self._tool_line(t)
            for t in self.registry.list_definitions()
            if self._tool_enabled(t.name, flags)
        )
        media_hint = self._media_hint(ctx)
        clar_hint = ""
        if clarification:
            if clarification.action == ClarificationAction.SKIP:
                clar_hint = (
                    "\nThe user SKIPPED the clarifying questions. You MUST "
                    "choose run_tool and answer with the best reasonable "
                    "assumptions. Choosing clarify again is forbidden."
                )
            else:
                clar_hint = (
                    "\nThe user has answered the clarifying questions (see "
                    "the message). You MUST choose run_tool now; asking for "
                    "more clarification is forbidden."
                )

        rendered = prompts.PromptBuilder.build(
            prompts.PLAN_TURN_TEMPLATE,
            USER_MESSAGE=enriched_message,
            AVAILABLE_TOOLS=tools_desc,
            MEDIA_HINT=media_hint,
            CLARIFICATION_HINT=clar_hint,
            CURRENT_DATE=prompts.current_date(),
            IMAGE_SKILLS=prompts.skills_for_planner(),
        )
        return self.llm.generate_structured(
            rendered.user_message,
            self._plan_schema_for(flags),
            history=self._history_for_planner(history),
            system_prompt=rendered.system_prompt,
            log_label="orchestrator",
        )

    def _media_hint(self, ctx: AssistantContext) -> str:
        """Planner line describing the selected files (names + ids).

        File names let the planner tell a biology PDF from a screenshot and
        resolve "the diagram" / "my notes" without a clarification; the ids
        stay so it can still narrow ``media_ids`` in the tool params.
        """
        if not ctx.media_ids:
            return "No media selected."
        files = self._selected_media(ctx)
        names = ", ".join(f["name"] for f in files) or "unknown files"
        return (
            f"User has selected {len(ctx.media_ids)} file(s): {names}. "
            f"Selected media IDs: {ctx.media_ids}. Questions about study "
            "content default to media_llm while files are selected."
        )

    @staticmethod
    def _tool_enabled(name: str, flags: dict[str, bool]) -> bool:
        """Whether a tool passes the feature flags (unmapped = always on)."""
        flag_key = feature_flag_service.TOOL_FLAG_MAP.get(name)
        return flag_key is None or flags.get(flag_key, True)

    @staticmethod
    def _plan_schema_for(flags: dict[str, bool]) -> dict[str, Any]:
        """PLAN_TURN_SCHEMA with flag-disabled tools removed from the enum.

        Deep-copies the module-level schema — never mutate the shared dict.
        """
        schema = copy.deepcopy(prompts.PLAN_TURN_SCHEMA)
        name_spec = schema["properties"]["steps"]["items"]["properties"][
            "tool"
        ]
        name_spec["enum"] = [
            n
            for n in name_spec["enum"]
            if AssistantOrchestrator._tool_enabled(n, flags)
        ]
        return schema

    @staticmethod
    def _has_unresolved_reference(
        message: str,
        ctx: AssistantContext,
        history: list[dict[str, str]],
    ) -> bool:
        """Report a demonstrative ("explain this") with nothing to resolve it.

        True only when the message leans on "this/that/..." AND there is no
        attached media, no prior conversation, and no grounding source content —
        the subject genuinely cannot be recovered, so a clarification the model
        asked for must stand rather than be suppressed.
        """
        if ctx.media_ids or history or ctx.source_content is not None:
            return False
        return bool(_REFERENCE_RE.search(message.lower()))

    @staticmethod
    def _clarification_unnecessary(
        message: str,
        ctx: AssistantContext,
        history: list[dict[str, str]],
    ) -> bool:
        """Return True when clarification would be annoying, not helpful."""
        if ctx.clarification is not None:
            return True

        text = message.strip().lower()
        words = text.split()
        is_quiz = "quiz" in text or "test" in text

        # Flashcards + media is the same source fork as quizzes (build from
        # the document or from the discussion?) — let the planner ask which.
        # Without media, flashcards are a clear intent and never need it.
        if "flashcard" in text or "flash card" in text:
            return not ctx.media_ids

        # Quiz + media is a real fork (quiz the document or the discussion?) —
        # let the planner ask which.
        if is_quiz and ctx.media_ids:
            return False

        # Quiz without media: only worth clarifying when there is no subject to
        # infer — nothing specific in the message and no prior conversation.
        if is_quiz:
            return len(words) > 3 or bool(history)

        if text in _SMALLTALK:
            return True

        # Short casual messages (e.g. "hi there", "how are you")
        if len(words) <= 4:
            return True

        question_starts = (
            "what", "why", "how", "when", "where", "who", "which",
            "explain", "tell", "define", "describe", "is ", "are ",
            "can ", "does ", "do ",
        )
        if "?" in message or text.startswith(question_starts):
            return True

        # Media attached for a non-quiz request — media_llm handles it.
        if ctx.media_ids:
            return True

        return False

    @staticmethod
    def _fallback_tool_plan(
        ctx: AssistantContext,
        message: str,
    ) -> dict[str, Any]:
        """Rule-based tool pick when skipping over-clarification.

        No keyword route for ``product_info``: only the planner sends turns
        there, so on this fallback path app questions land on ``general`` —
        an acceptable degraded answer (identity survives in the system
        prompt).
        """
        text = message.lower()

        # Flashcards: a clear, self-contained intent.
        if "flashcard" in text or "flash card" in text:
            fc_params: dict[str, Any] = {"topic": message}
            if ctx.media_ids:
                fc_params["use_media"] = True
            return AssistantOrchestrator._single_step(
                "flashcard_generator", fc_params
            )

        # Quiz wins over media: a quiz request is its own intent, and the quiz
        # tool grounds itself in the conversation history.
        if any(w in text for w in _QUIZ_WORDS):
            params: dict[str, Any] = {"topic": message}
            if ctx.media_ids:
                params["use_media"] = True
            return AssistantOrchestrator._single_step("quiz_generator", params)

        if ctx.media_ids:
            return AssistantOrchestrator._single_step(
                "media_llm", {"query": message}
            )

        # Only reach for the web when the message clearly needs fresh, external
        # facts; otherwise Aeva answers from its own knowledge (no needless
        # search on greetings, identity questions, or concept explanations).
        if _needs_fresh_info(text) and feature_flag_service.is_enabled(
            "web_search"
        ):
            return AssistantOrchestrator._single_step(
                "web_search",
                {
                    "query": message,
                    "search_intent": prompts.guess_search_intent(message),
                },
            )
        return AssistantOrchestrator._single_step(
            "general", {"query": message}
        )

    def _continuation_plan(
        self,
        ctx: AssistantContext,
        message: str,
    ) -> dict[str, Any] | None:
        """Repeat the last generator tool for a keyword-less "again" follow-up.

        A short reply like "create again" / "another one" carries a repeat cue
        but no "quiz"/"flashcard" keyword, so it would otherwise fall through to
        web_search. When the previous assistant turn produced a quiz or
        flashcard set, inherit that tool so the follow-up repeats the actual
        last action (a quiz still routes through the setup popover downstream).
        Messages that already name a tool, carry media, or answer a
        clarification keep their normal routing.
        """
        if ctx.clarification is not None or ctx.media_ids:
            return None
        text = message.lower()
        if any(
            w in text
            for w in ("quiz", "practice test", "test me", "flashcard",
                      "flash card")
        ):
            return None
        if not _REPEAT_RE.search(text):
            return None
        last_tool = self._last_generator_tool(ctx.session_id)
        if last_tool is None:
            return None
        return self._single_step(last_tool, {"topic": message})

    def _last_generator_tool(self, session_id: str) -> str | None:
        """Name of the most recent assistant turn's repeatable generator tool.

        Scans messages newest-first and returns the first assistant
        ``tool_used`` that is a quiz/flashcard generator, or None when the last
        tool-bearing turn used something else (so "again" does not silently
        repeat an unrelated web search).
        """
        for msg in reversed(self.supabase.get_messages(session_id)):
            if msg.get("role") != "assistant":
                continue
            meta = msg.get("metadata") or {}
            tool_used = meta.get("tool_used")
            if not tool_used:
                continue
            for tool in meta.get("tools_used") or [tool_used]:
                if tool in _REPEATABLE_TOOLS:
                    return str(tool)
            return None
        return None

    def _handle_clarification(
        self,
        ctx: AssistantContext,
        plan: dict[str, Any],
        original_message: str,
    ) -> AssistantResult:
        """Persist clarification and return to client."""
        clar = plan.get("clarification") or {}
        questions = [
            ClarificationQuestion(
                id=q["id"],
                text=q["text"],
                options=q.get("options"),
                input_type=q.get("input_type") or "chips",
            )
            for q in clar.get("questions", [])
        ]
        run = self._save_run(
            ctx.session_id,
            ctx.user_id,
            plan,
            original_message,
        )
        clar_req = ClarificationRequest(
            reason=clar.get("reason", "Need more information."),
            questions=questions,
        )
        display = (
            f"**{clar_req.reason}**\n\n"
            + "\n".join(f"- {q.text}" for q in questions)
        )
        self.supabase.add_message(
            ctx.session_id,
            "assistant",
            display,
            metadata={
                "status": "clarification_required",
                "run_id": run["id"],
                "clarification": {
                    "reason": clar_req.reason,
                    "questions": [
                        {
                            "id": q.id,
                            "text": q.text,
                            "options": q.options,
                            "input_type": q.input_type,
                        }
                        for q in questions
                    ],
                },
            },
        )
        return AssistantResult(
            status=RunStatus.CLARIFICATION_REQUIRED,
            run_id=run["id"],
            clarification=clar_req,
            display_text=display,
        )

    @staticmethod
    def _merge_clarification(
        original: str,
        response: object,
        questions_by_id: dict[str, str] | None = None,
    ) -> str:
        """Build enriched message from clarification response.

        ``questions_by_id`` maps question ids to their text so answers read
        as "Question -> Answer" pairs instead of bare ids, which grounds the
        answering model much better. A skip is made explicit so the model
        answers with assumptions instead of asking again.
        """
        action = response.action
        if action == ClarificationAction.SKIP:
            return (
                f"{original}\n\n(The user skipped the clarifying questions. "
                "Answer with the best reasonable assumptions from the "
                "conversation, profile, and media — do not ask again.)"
            )
        if action == ClarificationAction.CUSTOM and response.custom_text:
            return f"{original}\n\nAdditional context: {response.custom_text}"
        if action == ClarificationAction.ANSWER and response.answers:
            labels = questions_by_id or {}
            parts = [
                f"- {labels.get(qid, qid)}: {ans}"
                for qid, ans in response.answers.items()
            ]
            return (
                f"{original}\n\nThe user answered the clarifying "
                "questions:\n" + "\n".join(parts)
            )
        return original

    @staticmethod
    def _format_display(tool_name: str, result: dict[str, Any]) -> str:
        """Human-readable assistant message."""
        if tool_name == "quiz_generator":
            title = result.get("title", "Quiz")
            count = len(result.get("questions", []))
            return (
                f"I've created a **{title}** quiz with {count} questions. "
                "Open it below to start."
            )
        if tool_name == "flashcard_generator":
            title = result.get("title", "Flashcards")
            count = len(result.get("cards", []))
            return (
                f"I've created the **{title}** flashcard set with {count} "
                "cards. Open it to start studying."
            )
        return result.get("answer", json.dumps(result, indent=2))

    def _save_run(
        self,
        session_id: str,
        user_id: str,
        plan: dict[str, Any],
        original_message: str,
    ) -> dict[str, Any]:
        """Save pending orchestration run."""
        result = (
            self.supabase.client.table("orchestration_runs")
            .insert({
                "session_id": session_id,
                "user_id": user_id,
                "status": "awaiting_clarification",
                "plan": plan,
                "original_message": original_message,
            })
            .execute()
        )
        return result.data[0]

    def _get_run(
        self, run_id: str, user_id: str
    ) -> dict[str, Any] | None:
        """Load orchestration run."""
        result = (
            self.supabase.client.table("orchestration_runs")
            .select("*")
            .eq("id", run_id)
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
        return result.data if result else None

    def _complete_run(self, run_id: str | None) -> None:
        """Mark run completed."""
        if not run_id:
            return
        self.supabase.client.table("orchestration_runs").update({
            "status": "completed",
        }).eq("id", run_id).execute()
