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

        if ctx.run_id and ctx.clarification:
            run = self._get_run(ctx.run_id, ctx.user_id)
            if not run:
                raise CustomError(ERROR_CODES["CLARIFICATION_EXPIRED"])
            enriched_message = self._merge_clarification(
                run["original_message"],
                ctx.clarification,
            )
            self._complete_run(ctx.run_id)

        self.supabase.add_message(ctx.session_id, "user", ctx.message)

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
                f"Quiz ID: `{result.get('quiz_id')}`"
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
