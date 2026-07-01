"""Assistant orchestrator — clarification then tool execution."""

import json
import logging
import re
from collections.abc import Generator
from typing import Any

from aeva.common.errors import ERROR_CODES, CustomError
from aeva.llm import prompts
from aeva.llm.llm_client import LLMClient
from aeva.mcp.base import LEARNING_ACTIONS, BaseTool, ToolContext
from aeva.mcp.registry import ToolRegistry
from aeva.orchestration.models import (
    AssistantContext,
    AssistantResult,
    ClarificationAction,
    ClarificationQuestion,
    ClarificationRequest,
    FlashcardOptions,
    QuizOptions,
    RunStatus,
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
        session, history, enriched_message, plan, personalization = (
            self._setup_and_plan(ctx)
        )

        # Quiz requested but not yet configured -> open the setup popover ONLY
        # when required fields are missing. If the message already carries the
        # topic, count, and type, generate straight away. A forced/planned
        # flashcard turn never diverts here — its injected source content may
        # merely mention "quiz" without being a quiz request.
        if (
            ctx.quiz_options is None
            and ctx.flashcard_options is None
            and (plan.get("tool") or {}).get("name") != "flashcard_generator"
            and self._is_quiz_intent(plan, enriched_message)
            and not self._quiz_ready(plan, ctx)
        ):
            return self._quiz_setup_result(plan, ctx)

        if plan.get("action") == "clarify":
            return self._handle_clarification(ctx, plan, enriched_message)

        tool_name, tool_params = self._resolve_tool(plan)
        tool_ctx = self._build_tool_ctx(
            ctx, enriched_message, history, personalization
        )

        result = self.registry.execute(tool_name, tool_ctx, tool_params)
        answer, meta = self._split_answer_meta(result.get("answer", ""))
        if answer:
            result["answer"] = answer
        self._attach_actions(tool_name, result, meta=meta)
        display_text = self._format_display(tool_name, result)
        msg = self._persist_answer(
            ctx, session, tool_name, result, display_text
        )

        return AssistantResult(
            status=RunStatus.COMPLETED,
            tool_used=tool_name,
            content=result,
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
        session, history, enriched_message, plan, personalization = (
            self._setup_and_plan(ctx)
        )
        logger.info(
            "Turn planned | action=%s | tool=%s",
            plan.get("action"),
            (plan.get("tool") or {}).get("name"),
        )

        # Quiz requested but not yet configured -> open the setup popover ONLY
        # when required fields are missing; otherwise fall through and generate.
        # A forced/planned flashcard turn never diverts here — its injected
        # source content may merely mention "quiz" without being a quiz request.
        if (
            ctx.quiz_options is None
            and ctx.flashcard_options is None
            and (plan.get("tool") or {}).get("name") != "flashcard_generator"
            and self._is_quiz_intent(plan, enriched_message)
            and not self._quiz_ready(plan, ctx)
        ):
            logger.info("Turn → quiz setup popover (missing quiz fields)")
            yield self._quiz_setup_frame(plan, ctx)
            return

        if plan.get("action") == "clarify":
            logger.info("Turn → clarification requested")
            clar = self._handle_clarification(ctx, plan, enriched_message)
            yield self._clarification_frame(clar)
            return

        tool_name, tool_params = self._resolve_tool(plan)
        logger.info("Turn → running tool: %s", tool_name)
        tool_ctx = self._build_tool_ctx(
            ctx, enriched_message, history, personalization
        )
        tool = self.registry.get(tool_name)

        result: dict[str, Any] = {}
        meta: dict[str, Any] | None = None
        if tool.can_stream():
            # Stream only the answer; the follow-up metadata trailer the model
            # appends is held back here and parsed (no second LLM call).
            stream = self._stream_answer(
                tool.execute_stream(tool_ctx, tool_params)
            )
            raw = ""
            try:
                while True:
                    yield LLMClient.format_sse_chunk(next(stream))
            except StopIteration as stop:
                raw, result = stop.value if stop.value else ("", {})
            if not isinstance(result, dict):
                result = {}
            answer, meta = self._split_answer_meta(raw)
            result["answer"] = answer
            display_text = answer or self._format_display(tool_name, result)
        else:
            result = self.registry.execute(tool_name, tool_ctx, tool_params)
            display_text = self._format_display(tool_name, result)
            yield LLMClient.format_sse_chunk(display_text)

        # Follow-up chips ride the finished answer's metadata trailer.
        self._attach_actions(tool_name, result, tool, meta)
        self._persist_answer(ctx, session, tool_name, result, display_text)
        logger.info(
            "Turn complete | tool=%s | answer=%dchars | actions=%s | "
            "followups=%d",
            tool_name,
            len(display_text or ""),
            result.get("available_actions"),
            len(result.get("suggested_followups") or []),
        )
        yield LLMClient.format_sse_chunk(
            "",
            done=True,
            extra={"tool_used": tool_name, "content": result},
        )

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

        personalization = prompts.build_personalization_block(
            self.supabase.get_profile(ctx.user_id)
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
                'source. Ignore any other messages in this '
                f'conversation:\n"""\n{ctx.source_content}\n"""'
            )

        media_choice_ids: list[str] | None = None
        if ctx.run_id and ctx.clarification:
            run = self._get_run(ctx.run_id, ctx.user_id)
            if not run:
                raise CustomError(ERROR_CODES["CLARIFICATION_EXPIRED"])
            enriched_message = self._merge_clarification(
                run["original_message"],
                ctx.clarification,
            )
            if (run.get("plan") or {}).get("kind") == "media_choice":
                media_choice_ids = self._resolve_media_choice(
                    run["plan"], ctx.clarification
                )
            self._complete_run(ctx.run_id)

        self.supabase.add_message(ctx.session_id, "user", ctx.message)

        # Deterministic plans (resolved file choice, popover-driven quiz/flash)
        # skip LLM planning entirely.
        forced = self._forced_plan(ctx, media_choice_ids)
        if forced is not None:
            return session, history, enriched_message, forced, personalization

        # Several files selected + a vague request -> ask which file to use.
        if not ctx.clarification and ctx.media_ids and len(ctx.media_ids) > 1:
            decision = self._disambiguate_media(ctx, enriched_message)
            if decision is not None:
                return (
                    session, history, enriched_message, decision,
                    personalization,
                )

        # Deterministic outcome -> skip the planner LLM call entirely.
        fast = self._fast_path_plan(ctx, enriched_message, history)
        if fast is not None:
            logger.info("Turn planned deterministically (no plan LLM call)")
            return session, history, enriched_message, fast, personalization

        plan = self._plan_turn(
            ctx, history, enriched_message, ctx.clarification
        )
        plan = self._refine_plan(plan, ctx, enriched_message, history)
        return session, history, enriched_message, plan, personalization

    def _forced_plan(
        self,
        ctx: AssistantContext,
        media_choice_ids: list[str] | None,
    ) -> dict[str, Any] | None:
        """Deterministic plan that bypasses the planner, or None to plan."""
        if media_choice_ids is not None:
            # A resolved "which file?" answer runs media_llm on the choice.
            return {
                "action": "run_tool",
                "tool": {
                    "name": "media_llm",
                    "params": {"media_ids": media_choice_ids},
                },
            }
        if ctx.flashcard_options is not None:
            # Create Flashcards action forces flashcard generation.
            return {
                "action": "run_tool",
                "tool": {
                    "name": "flashcard_generator",
                    "params": self._flashcard_params(ctx.flashcard_options),
                },
            }
        if ctx.quiz_options is not None:
            # Explicit quiz settings from the setup popover.
            return {
                "action": "run_tool",
                "tool": {
                    "name": "quiz_generator",
                    "params": self._quiz_params_from_options(ctx.quiz_options),
                },
            }
        return None

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

        return plan

    @staticmethod
    def _resolve_tool(plan: dict[str, Any]) -> tuple[str, dict[str, Any]]:
        """Pull the tool name and params from a run_tool plan."""
        tool_info = plan.get("tool") or {}
        return tool_info.get("name", "web_search"), tool_info.get("params") or {}

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
        result["suggested_followups"] = meta.get("suggested_followups", [])

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
            return {
                "action": "run_tool",
                "tool": {
                    "name": "media_llm",
                    "params": {"media_ids": [f["id"] for f in named]},
                },
            }
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
    ) -> ToolContext:
        """Build the runtime context passed to a tool.

        ``personalization`` is the block already built in ``_setup_and_plan`` so
        the user's profile is loaded once per turn.
        """
        return ToolContext(
            user_id=ctx.user_id,
            session_id=ctx.session_id,
            message=ctx.message,
            enriched_message=enriched_message,
            media_ids=ctx.media_ids,
            history=history,
            personalization=personalization,
        )

    def _persist_answer(
        self,
        ctx: AssistantContext,
        session: dict[str, Any],
        tool_name: str,
        result: dict[str, Any],
        display_text: str,
    ) -> dict[str, Any]:
        """Persist the assistant message and auto-title a fresh session."""
        msg = self.supabase.add_message(
            ctx.session_id,
            "assistant",
            display_text,
            metadata={
                "status": "completed",
                "tool_used": tool_name,
                "content": result,
            },
        )
        if session["title"] == "New chat":
            self.supabase.update_session(
                ctx.session_id, ctx.user_id, title=ctx.message[:60]
            )
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
        return params

    @staticmethod
    def _is_quiz_intent(plan: dict[str, Any], message: str) -> bool:
        """Whether this turn is a quiz request (so we collect options first)."""
        if (plan.get("tool") or {}).get("name") == "quiz_generator":
            return True
        text = message.lower()
        return any(w in text for w in ("quiz", "practice test", "test me"))

    @staticmethod
    def _quiz_ready(plan: dict[str, Any], ctx: AssistantContext) -> bool:
        """Whether every required quiz field is already known from context.

        When the planner has extracted a topic (or the user pointed at their
        uploaded material), a question count, and at least one question type,
        the form adds nothing — we generate directly. Difficulty is optional
        (defaults to medium), so it is not required.
        """
        if (plan.get("tool") or {}).get("name") != "quiz_generator":
            return False
        params = (plan.get("tool") or {}).get("params") or {}
        has_topic = bool(params.get("topic")) or (
            bool(params.get("use_media")) and bool(ctx.media_ids)
        )
        has_count = params.get("question_count") is not None
        has_types = bool(params.get("question_types"))
        ready = has_topic and has_count and has_types
        if ready:
            logger.info("Quiz fields complete → generating without the form")
        return ready

    def _quiz_setup_data(
        self, plan: dict[str, Any], ctx: AssistantContext
    ) -> dict[str, Any]:
        """Payload to open the quiz-setup popover, pre-filled with what we know.

        Every field the planner already detected (topic, count, types,
        difficulty) is sent so the form opens populated — the user only fills
        the genuinely missing pieces rather than re-entering everything.
        """
        tool_params = (plan.get("tool") or {}).get("params") or {}
        return {
            "status": "quiz_setup",
            "topic": tool_params.get("topic") or "",
            "question_count": tool_params.get("question_count"),
            "question_types": tool_params.get("question_types"),
            "difficulty": tool_params.get("difficulty"),
            "media_available": bool(ctx.media_ids),
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

    def _get_history(
        self, session_id: str, limit: int = 10
    ) -> list[dict[str, str]]:
        """Recent message history."""
        messages = self.supabase.get_messages(session_id)
        recent = messages[-limit:] if len(messages) > limit else messages
        return [
            {"role": m["role"], "content": m["content"]}
            for m in recent
        ]

    def _fast_path_plan(
        self,
        ctx: AssistantContext,
        message: str,
        history: list[dict[str, str]],
    ) -> dict[str, Any] | None:
        """Deterministic plan that makes the planner LLM call unnecessary.

        For a no-media turn that is not a quiz/flashcard request (which needs
        parameter extraction), the only sensible tool is ``web_search``. When
        clarification is also provably unnecessary and no unresolved reference
        forces one, the refined plan is exactly what the planner would resolve
        to — a run_tool(web_search) — so we skip a full LLM call and return it
        directly. Anything ambiguous (media attached, quiz/flashcard, a bare
        "explain this", a long open-ended message) falls through to the planner.
        """
        text = message.lower()
        needs_planner = (
            # A clarification reply may carry tool-specific params.
            ctx.clarification is not None
            # Media: media_llm vs a quiz/flashcard fork or a which-file ask.
            or bool(ctx.media_ids)
            # Quiz/flashcard need natural-language parameter extraction.
            or any(w in text for w in ("quiz", "practice test", "test me"))
            or "flashcard" in text
            or "flash card" in text
            # A demonstrative with nothing to resolve it must be clarified.
            or self._has_unresolved_reference(message, ctx, history)
            # Genuinely open-ended -> let the planner decide clarify vs tool.
            or not self._clarification_unnecessary(message, ctx, history)
        )
        if needs_planner:
            return None
        return self._fallback_tool_plan(ctx, message)

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
        tools_desc = "\n".join(
            f"- {t.name}: {t.description}"
            for t in self.registry.list_definitions()
        )
        media_hint = (
            f"User has selected media IDs: {ctx.media_ids}"
            if ctx.media_ids
            else "No media selected."
        )
        clar_hint = ""
        if clarification:
            clar_hint = (
                f"\nUser clarification action: "
                f"{clarification.action}. Prefer run_tool."
            )

        prompt = prompts.PLAN_TURN_PROMPT.format(
            message=enriched_message,
            tools=tools_desc,
            media_hint=media_hint,
            clar_hint=clar_hint,
        )
        return self.llm.generate_structured(
            prompt,
            prompts.PLAN_TURN_SCHEMA,
            history=history,
            system_prompt=prompts.PLAN_SYSTEM_PROMPT,
        )

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
        """Rule-based tool pick when skipping over-clarification."""
        text = message.lower()

        # Flashcards: a clear, self-contained intent.
        if "flashcard" in text or "flash card" in text:
            fc_params: dict[str, Any] = {"topic": message}
            if ctx.media_ids:
                fc_params["use_media"] = True
            return {
                "action": "run_tool",
                "tool": {"name": "flashcard_generator", "params": fc_params},
            }

        # Quiz wins over media: a quiz request is its own intent, and the quiz
        # tool grounds itself in the conversation history.
        if any(w in text for w in ("quiz", "practice test", "test me")):
            params: dict[str, Any] = {"topic": message}
            if ctx.media_ids:
                params["use_media"] = True
            return {
                "action": "run_tool",
                "tool": {"name": "quiz_generator", "params": params},
            }

        if ctx.media_ids:
            return {
                "action": "run_tool",
                "tool": {"name": "media_llm", "params": {"query": message}},
            }

        return {
            "action": "run_tool",
            "tool": {"name": "web_search", "params": {"query": message}},
        }

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
                        {"id": q.id, "text": q.text, "options": q.options}
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
    ) -> str:
        """Build enriched message from clarification response."""
        action = response.action
        if action == ClarificationAction.SKIP:
            return original
        if action == ClarificationAction.CUSTOM and response.custom_text:
            return f"{original}\n\nAdditional context: {response.custom_text}"
        if action == ClarificationAction.ANSWER and response.answers:
            parts = [
                f"{qid}: {ans}" for qid, ans in response.answers.items()
            ]
            return f"{original}\n\nClarifications:\n" + "\n".join(parts)
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
