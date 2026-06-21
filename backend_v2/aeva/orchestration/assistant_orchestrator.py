"""Assistant orchestrator — clarification then tool execution."""

import json
import logging
from collections.abc import Generator
from typing import Any

from aeva.common.errors import ERROR_CODES, CustomError
from aeva.llm.llm_client import LLMClient
from aeva.llm import prompts
from aeva.mcp.base import ToolContext
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
        session, history, enriched_message, plan = self._setup_and_plan(ctx)

        # Quiz requested but not yet configured -> ask the client to open the
        # setup popover instead of generating with defaults.
        if ctx.quiz_options is None and self._is_quiz_intent(
            plan, enriched_message
        ):
            return self._quiz_setup_result(plan, ctx)

        if plan.get("action") == "clarify":
            return self._handle_clarification(ctx, plan, enriched_message)

        tool_name, tool_params = self._resolve_tool(plan)
        tool_ctx = self._build_tool_ctx(ctx, enriched_message, history)

        result = self.registry.execute(tool_name, tool_ctx, tool_params)
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
        session, history, enriched_message, plan = self._setup_and_plan(ctx)

        # Quiz requested but not yet configured -> open the setup popover.
        if ctx.quiz_options is None and self._is_quiz_intent(
            plan, enriched_message
        ):
            yield self._quiz_setup_frame(plan, ctx)
            return

        if plan.get("action") == "clarify":
            clar = self._handle_clarification(ctx, plan, enriched_message)
            yield self._clarification_frame(clar)
            return

        tool_name, tool_params = self._resolve_tool(plan)
        tool_ctx = self._build_tool_ctx(ctx, enriched_message, history)
        tool = self.registry.get(tool_name)

        full_text = ""
        result: dict[str, Any] = {}
        if tool.can_stream():
            gen = tool.execute_stream(tool_ctx, tool_params)
            try:
                while True:
                    chunk = next(gen)
                    full_text += chunk
                    yield LLMClient.format_sse_chunk(chunk)
            except StopIteration as stop:
                result = stop.value or {}
            display_text = full_text or self._format_display(
                tool_name, result
            )
        else:
            result = self.registry.execute(tool_name, tool_ctx, tool_params)
            display_text = self._format_display(tool_name, result)
            yield LLMClient.format_sse_chunk(display_text)

        self._persist_answer(ctx, session, tool_name, result, display_text)
        yield LLMClient.format_sse_chunk(
            "",
            done=True,
            extra={"tool_used": tool_name, "content": result},
        )

    def _setup_and_plan(
        self, ctx: AssistantContext
    ) -> tuple[dict[str, Any], list[dict[str, str]], str, dict[str, Any]]:
        """Shared prep for both run paths: load, record, and plan the turn."""
        session = self.supabase.get_session(ctx.session_id, ctx.user_id)
        if not session:
            raise CustomError(ERROR_CODES["NOT_FOUND"])

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

        # A resolved "which file?" answer runs media_llm on the chosen file(s).
        if media_choice_ids is not None:
            plan = {
                "action": "run_tool",
                "tool": {
                    "name": "media_llm",
                    "params": {"media_ids": media_choice_ids},
                },
            }
            return session, history, enriched_message, plan

        # Create Flashcards action forces flashcard generation (no planning).
        if ctx.flashcard_options is not None:
            plan = {
                "action": "run_tool",
                "tool": {
                    "name": "flashcard_generator",
                    "params": self._flashcard_params(ctx.flashcard_options),
                },
            }
            return session, history, enriched_message, plan

        # Explicit quiz settings from the setup popover skip LLM planning.
        if ctx.quiz_options is not None:
            plan = {
                "action": "run_tool",
                "tool": {
                    "name": "quiz_generator",
                    "params": self._quiz_params_from_options(ctx.quiz_options),
                },
            }
            return session, history, enriched_message, plan

        # Several files selected + a vague request -> ask which file to use.
        if not ctx.clarification and ctx.media_ids and len(ctx.media_ids) > 1:
            decision = self._disambiguate_media(ctx, enriched_message)
            if decision is not None:
                return session, history, enriched_message, decision

        plan = self._plan_turn(
            ctx, history, enriched_message, ctx.clarification
        )

        if (
            plan.get("action") == "clarify"
            and self._clarification_unnecessary(
                enriched_message, ctx, history
            )
        ):
            logger.info(
                "Skipping unnecessary clarification for: %s",
                enriched_message[:80],
            )
            plan = self._fallback_tool_plan(ctx, enriched_message)

        return session, history, enriched_message, plan

    @staticmethod
    def _resolve_tool(plan: dict[str, Any]) -> tuple[str, dict[str, Any]]:
        """Pull the tool name and params from a run_tool plan."""
        tool_info = plan.get("tool") or {}
        return tool_info.get("name", "web_search"), tool_info.get("params") or {}

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
    ) -> ToolContext:
        """Build the runtime context passed to a tool."""
        return ToolContext(
            user_id=ctx.user_id,
            session_id=ctx.session_id,
            message=ctx.message,
            enriched_message=enriched_message,
            media_ids=ctx.media_ids,
            history=history,
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
        return params

    @staticmethod
    def _is_quiz_intent(plan: dict[str, Any], message: str) -> bool:
        """Whether this turn is a quiz request (so we collect options first)."""
        if (plan.get("tool") or {}).get("name") == "quiz_generator":
            return True
        text = message.lower()
        return any(w in text for w in ("quiz", "practice test", "test me"))

    def _quiz_setup_data(
        self, plan: dict[str, Any], ctx: AssistantContext
    ) -> dict[str, Any]:
        """Payload telling the client to open the quiz-setup popover."""
        tool_params = (plan.get("tool") or {}).get("params") or {}
        return {
            "status": "quiz_setup",
            "topic": tool_params.get("topic") or "",
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

    def _plan_turn(
        self,
        ctx: AssistantContext,
        history: list[dict[str, str]],
        enriched_message: str,
        clarification: object | None,
    ) -> dict[str, Any]:
        """Ask LLM to clarify or pick a tool."""
        tools_desc = json.dumps(
            [
                {
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.parameters_schema,
                }
                for t in self.registry.list_definitions()
            ],
            indent=2,
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
            system_prompt=prompts.SYSTEM_PROMPT,
        )

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

        # Flashcard requests are a clear intent — never clarify them.
        if "flashcard" in text or "flash card" in text:
            return True

        # Quiz + media is a real fork (quiz the document or the discussion?) —
        # let the planner ask which.
        if is_quiz and ctx.media_ids:
            return False

        # Quiz without media: only worth clarifying when there is no subject to
        # infer — nothing specific in the message and no prior conversation.
        if is_quiz:
            return len(words) > 3 or bool(history)

        greetings = {
            "hi", "hello", "hey", "hiya", "howdy", "yo",
            "thanks", "thank you", "thx", "ok", "okay", "bye",
            "goodbye", "good morning", "good afternoon", "good evening",
        }
        if text in greetings:
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
