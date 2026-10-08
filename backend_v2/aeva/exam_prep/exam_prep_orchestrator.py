"""The exam-coach turn: deterministic routing on top of the chat machinery.

``ExamPrepOrchestrator`` is a separate flow that reuses everything below the
routing decision — ``AgentRunner``, the registered tools, prompt building,
tracing, SSE frames, persistence — by subclassing ``AssistantOrchestrator``
and overriding only ``_setup_and_plan``. It never calls the planner LLM,
never asks a clarifying question and never opens the quiz-setup popover.
"""

import logging
from dataclasses import dataclass
from typing import Any

from aeva.common.errors import ERROR_CODES, CustomError
from aeva.exam_prep.exam_prep_service import (
    SESSION_KIND,
    match_target_exam,
    topic_label,
    topic_turns,
)
from aeva.feature_flag import feature_flag_service
from aeva.llm import prompts
from aeva.orchestration.assistant_orchestrator import (
    AssistantOrchestrator,
    _is_small_talk,
    _needs_fresh_info,
)
from aeva.orchestration.models import AssistantContext
from aeva.tracing.services import exam_prep_trace, turn_trace

logger = logging.getLogger(__name__)

PLAN_SOURCE = "exam_prep"
_TOPIC_HISTORY_FETCH = 200
DEFAULT_QUIZ_QUESTIONS = 5
DEFAULT_FLASHCARDS = 8

_FLASHCARD_WORDS = ("flashcard", "flash card")
_QUIZ_WORDS = ("quiz", "practice test", "test me", "mcq", "mock test")
_MATERIAL_WORDS = (
    "my notes",
    "my material",
    "uploaded",
    "syllabus",
    "the pdf",
    "my book",
    "the file",
)


@dataclass
class ExamPrepContext(AssistantContext):
    """Chat context plus the exam rows the turn runs against."""

    plan: dict[str, Any] | None = None  # exam_plans row
    day: dict[str, Any] | None = None  # exam_plan_days row or None
    topic: dict[str, Any] | None = None  # exam_plan_topics row or None
    # Today's day row with its topics under "topics" (for "today" context).
    today: dict[str, Any] | None = None


class ExamPrepOrchestrator(AssistantOrchestrator):
    """Exam-coach turn: deterministic routing, exam block, same agents."""

    @staticmethod
    def _exam(ctx: AssistantContext) -> ExamPrepContext:
        """Narrow to the exam context (a plain chat context is a bug)."""
        if not isinstance(ctx, ExamPrepContext):
            raise CustomError(ERROR_CODES["VALIDATION_ERROR"])
        return ctx

    @turn_trace.setup
    def _setup_and_plan(
        self, ctx: AssistantContext
    ) -> tuple[dict[str, Any], list[dict[str, str]], str, dict[str, Any], str]:
        """Load the exam session and context, then route deterministically."""
        exam = self._exam(ctx)
        session = self.supabase.get_session(exam.session_id, exam.user_id)
        if not session or session.get("kind") != SESSION_KIND:
            raise CustomError(ERROR_CODES["NOT_FOUND"])
        turn_trace.session_loaded(exam)
        exam_prep_trace.mark_exam_turn(
            str((exam.plan or {}).get("id") or "") or None,
            str((exam.topic or {}).get("id") or "") or None,
            str((exam.day or {}).get("id") or "") or None,
        )

        profile = self.supabase.get_profile(exam.user_id)
        self._debug_enabled = bool((profile or {}).get("is_debug_user"))
        profile = self._persist_standing_language(exam, profile)
        personalization = prompts.build_identity_block(profile)
        personalization += prompts.build_personalization_block(profile)
        personalization += prompts.build_exam_prep_block(
            exam.plan, exam.day, exam.topic, exam.today
        )
        history = self._get_history(exam.session_id)
        if exam.topic:
            # Doubts asked on a topic page stay in that topic's thread: the
            # model sees only this topic's earlier turns (the lesson itself
            # rides in the exam block), not the whole plan conversation.
            history = self._topic_history(
                exam.session_id, str(exam.topic.get("id") or "")
            )
        enriched_message = exam.message
        turn_trace.context_loaded(
            exam, session, profile, history, personalization, enriched_message
        )
        metadata = {
            key: value
            for key, value in (
                ("exam_topic_id", (exam.topic or {}).get("id")),
                ("exam_day_id", (exam.day or {}).get("id")),
            )
            if value
        }
        turn_trace.user_message(
            self.supabase.add_message(
                exam.session_id, "user", exam.message, metadata=metadata or None
            )
        )
        plan = self._exam_plan(exam, enriched_message)
        plan["_source"] = PLAN_SOURCE
        logger.info("Exam coach turn routed → %s", self._primary_tool(plan))
        return session, history, enriched_message, plan, personalization

    def _topic_history(
        self, session_id: str, topic_id: str
    ) -> list[dict[str, str]]:
        """Recent history narrowed to one topic's turns (bounded read)."""
        limit = self._history_limit()
        rows = self.supabase.get_messages(
            session_id, limit=max(limit, _TOPIC_HISTORY_FETCH)
        )
        kept = topic_turns(rows, topic_id)
        if limit > 0:
            kept = kept[-limit:]
        history: list[dict[str, str]] = []
        for m in kept:
            item = {"role": m["role"], "content": m["content"]}
            tool = (m.get("metadata") or {}).get("tool_used")
            if m["role"] == "assistant" and tool:
                item["tool"] = tool
            history.append(item)
        return history

    def _should_open_quiz_setup(
        self,
        plan: dict[str, Any],  # noqa: ARG002 — base signature
        ctx: AssistantContext,  # noqa: ARG002
        message: str,  # noqa: ARG002
    ) -> bool:
        """Never: the exam coach runs quizzes on the current topic directly."""
        return False

    # ------------------------------------------------------------ routing

    @staticmethod
    def _exam_quiz_params(
        plan: dict[str, Any], topic: dict[str, Any] | None
    ) -> dict[str, Any]:
        """Exam-level quiz params: target exam (when known) + instructions."""
        params: dict[str, Any] = {
            "additional_instructions": prompts.format_quiz_instructions(
                str(plan.get("exam_name") or ""),
                str(plan.get("class_level") or ""),
                str((topic or {}).get("description") or ""),
            )
        }
        target = match_target_exam(str(plan.get("exam_name") or ""))
        if target:
            params["target_exam"] = target
        return params

    def _forced_exam_plan(
        self,
        ctx: ExamPrepContext,
        label: str | None,
        exam_params: dict[str, Any],
    ) -> dict[str, Any] | None:
        """Popover options force a generator on the current topic, or None."""
        if ctx.flashcard_options is not None:
            params = self._flashcard_params(ctx.flashcard_options)
            if label:
                params.setdefault("topic", label)
            return self._single_step("flashcard_generator", params)
        if ctx.quiz_options is not None:
            params = self._quiz_params_from_options(ctx.quiz_options)
            if label:
                params.setdefault("topic", label)
            for key, value in exam_params.items():
                params.setdefault(key, value)
            return self._single_step("quiz_generator", params)
        return None

    def _material_plan(
        self, ctx: ExamPrepContext, message: str
    ) -> dict[str, Any] | None:
        """Return a retrieval plan over the student's material, or None.

        Material selected on the topic page is the student's instruction to
        answer from it: any study question runs ``media_llm`` over those ids
        (relevant chunks only, never the whole document); small talk and
        fresh-information questions keep their usual routes. Without a
        selection, the plan's own material is used only when the message
        asks for it ("my notes", "the pdf", ...).
        """
        selected = [str(m) for m in ctx.media_ids or [] if m]
        if selected:
            if _is_small_talk(message) or (
                _needs_fresh_info(message)
                and feature_flag_service.is_enabled("web_search")
            ):
                return None
            return self._single_step(
                "media_llm", {"query": message, "media_ids": selected}
            )
        plan = ctx.plan or {}
        material = [str(m) for m in plan.get("material_media_ids") or [] if m]
        text = message.lower()
        if material and any(word in text for word in _MATERIAL_WORDS):
            ctx.media_ids = material
            return self._single_step(
                "media_llm", {"query": message, "media_ids": material}
            )
        return None

    def _exam_plan(self, ctx: ExamPrepContext, message: str) -> dict[str, Any]:
        """Deterministic routing table for an exam-coach message."""
        plan = ctx.plan or {}
        label = topic_label(ctx.topic) if ctx.topic else None
        exam_params = self._exam_quiz_params(plan, ctx.topic)

        forced = self._forced_exam_plan(ctx, label, exam_params)
        if forced is not None:
            return forced

        text = message.lower()
        if any(word in text for word in _FLASHCARD_WORDS):
            return self._single_step(
                "flashcard_generator",
                {"topic": label or message, "count": DEFAULT_FLASHCARDS},
            )
        if any(word in text for word in _QUIZ_WORDS):
            return self._single_step(
                "quiz_generator",
                {
                    "topic": label or message,
                    "question_count": DEFAULT_QUIZ_QUESTIONS,
                    **exam_params,
                },
            )
        material = self._material_plan(ctx, message)
        if material is not None:
            return material
        if _needs_fresh_info(message) and feature_flag_service.is_enabled(
            "web_search"
        ):
            return self._single_step("web_search", {"query": message})
        return self._single_step("general", {"query": message})
