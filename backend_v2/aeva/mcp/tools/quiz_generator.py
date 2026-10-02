"""Quiz generation tool."""

from typing import Any

from flask import current_app

from aeva.llm import prompts
from aeva.llm.llm_client import LLMClient
from aeva.mcp.base import (
    ACTION_OPEN_QUIZ,
    RESPONSE_QUIZ_CREATED,
    BaseTool,
    ToolContext,
    ToolDefinition,
)
from aeva.media.grounding import ground_generator
from aeva.media.retrieval import RetrievalService
from aeva.quiz import exam_patterns
from aeva.quiz.exam_research import ExamResearchService
from aeva.quiz.quiz_repository import QuizRepository
from aeva.supabase.supabase_service import SupabaseService
from aeva.tracing.services import tool_trace

# Types that must resolve to exactly one correct answer.
_SINGLE_ANSWER_TYPES = frozenset({"single_select", "true_false"})


@tool_trace.quiz_repairs
def _normalize_questions(
    questions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Repair per-type answer invariants the LLM may violate.

    Guarantees, regardless of what the model returned:

    * ``true_false`` questions expose exactly the ``["True", "False"]`` options.
    * ``correct_answers`` only contains values present in ``options``.
    * ``single_select`` / ``true_false`` end with EXACTLY ONE correct answer
      (extras are dropped, keeping the first valid one).
    * Every question keeps at least one correct answer (falls back to the
      first option when the model left none valid).

    Malformed questions are logged (not raised) so a single bad item never
    fails the whole generation.
    """
    normalized: list[dict[str, Any]] = []
    for question in questions:
        qtype = question.get("type", "single_select")
        options = [str(o) for o in question.get("options") or []]

        if qtype == "true_false":
            options = ["True", "False"]

        raw_correct = question.get("correct_answers") or []
        correct = [c for c in raw_correct if c in options]
        if not correct and options:
            current_app.logger.warning(
                "Quiz question had no valid correct answer; defaulting to the "
                "first option (type=%s)",
                qtype,
            )
            correct = [options[0]]
        if qtype in _SINGLE_ANSWER_TYPES and len(correct) > 1:
            current_app.logger.warning(
                "Quiz %s question had %d correct answers; keeping the first",
                qtype,
                len(correct),
            )
            correct = correct[:1]

        normalized.append({
            **question,
            "options": options,
            "correct_answers": correct,
        })
    return normalized


class QuizGeneratorTool(BaseTool):
    """Generate a dynamic quiz and persist it."""

    def __init__(
        self,
        llm: LLMClient | None = None,
        quiz_repo: QuizRepository | None = None,
        supabase: SupabaseService | None = None,
        retrieval: RetrievalService | None = None,
        exam_research: ExamResearchService | None = None,
    ) -> None:
        self._llm = llm
        self._quiz_repo = quiz_repo
        self._supabase = supabase
        self._retrieval = retrieval
        self._exam_research = exam_research

    @property
    def llm(self) -> LLMClient:
        """Lazy LLM client."""
        return self._llm or LLMClient(config_key="LLM_QUIZ_MODEL")

    @property
    def quiz_repo(self) -> QuizRepository:
        """Lazy quiz repository."""
        return self._quiz_repo or QuizRepository()

    @property
    def supabase(self) -> SupabaseService:
        """Lazy Supabase client (for media-based quizzes)."""
        return self._supabase or SupabaseService()

    @property
    def retrieval(self) -> RetrievalService:
        """Lazy retrieval service (grounds quizzes in indexed uploads)."""
        if self._retrieval is None:
            self._retrieval = RetrievalService(supabase=self.supabase)
        return self._retrieval

    @property
    def exam_research(self) -> ExamResearchService:
        """Lazy web research on an exam's previous-year question pattern."""
        if self._exam_research is None:
            self._exam_research = ExamResearchService()
        return self._exam_research

    @property
    def definition(self) -> ToolDefinition:
        """Tool metadata."""
        return ToolDefinition(
            name="quiz_generator",
            description=(
                "Generate a practice quiz with single-select, multi-select, "
                "and true/false questions on a study topic."
            ),
            parameters_schema=prompts.QUIZ_GENERATOR_PARAMS,
        )

    @property
    def response_type(self) -> str:
        """A generated quiz is its own response category."""
        return RESPONSE_QUIZ_CREATED

    @property
    def available_actions(self) -> list[str]:
        """The only meaningful action is opening the quiz just created."""
        return [ACTION_OPEN_QUIZ]

    @staticmethod
    def _pattern_default_type(exam_config: dict[str, Any]) -> str | None:
        """Preset-suggested question type for a chosen exam pattern, if any."""
        pattern = exam_config.get("pattern")
        if not pattern:
            return None
        preset = exam_patterns.EXAM_PATTERNS.get(pattern) or {}
        default_type = preset.get("default_type")
        return default_type if isinstance(default_type, str) else None

    @staticmethod
    def _wants_media(params: dict[str, Any], ctx: ToolContext) -> bool:
        """Decide whether to build the quiz from the uploaded material.

        Honors an explicit planner choice (``use_media``); otherwise infers it
        from the user's wording, which reliably covers a clarification answer
        like "From your uploaded material" without depending on the planner
        re-deriving the flag.
        """
        if not ctx.media_ids:
            return False
        if "use_media" in params:
            return bool(params["use_media"])
        text = ctx.enriched_message.lower()
        media_words = (
            "upload", "document", "the file", "pdf", "the book",
            "my book", "attached", "the material", "my notes", "image",
        )
        return any(word in text for word in media_words)

    def execute(self, ctx: ToolContext, params: dict[str, Any]) -> dict[str, Any]:
        """Generate and persist a quiz.

        Grounds the quiz in the conversation (history) so a follow-up like
        "make a quiz" uses the topic just discussed. When ``use_media`` is set
        and the session has media, the quiz is built from the uploaded files.
        """
        topic = params.get("topic") or ctx.enriched_message
        count = min(
            int(params.get("question_count", 5)),
            current_app.config.get("QUIZ_MAX_QUESTIONS", 10),
        )
        difficulty = params.get("difficulty", "medium")
        # "Exam level": pitched at a real exam instead of a difficulty band.
        target_exam = params.get("target_exam")
        exam_label = exam_patterns.target_exam_label(target_exam)
        if exam_label:
            difficulty = exam_patterns.EXAM_LEVEL_DIFFICULTY
        else:
            target_exam = None
        # Exam Mode config (normalized/validated; {} for an ordinary quiz). A
        # preset can suggest a default question type when the user picked none.
        exam_config = exam_patterns.normalize_exam_config(
            params.get("exam_config")
        )
        default_type = self._pattern_default_type(
            exam_config
        ) or self._pattern_default_type({"pattern": target_exam})
        types = params.get("question_types") or (
            [default_type] if default_type else [
                "single_select",
                "multi_select",
                "true_false",
            ]
        )

        # Material, in priority order: what an earlier agent produced this
        # turn, excerpts retrieved from the indexed uploads, then whole files
        # for anything that cannot be searched (images, unindexed docs).
        grounding = ground_generator(
            ctx,
            topic=str(params.get("topic") or ""),
            wants_media=self._wants_media(params, ctx),
            supabase=self.supabase,
            retrieval=self.retrieval,
        )
        attachments = grounding.attachments
        source_context = grounding.source_context
        from_media = grounding.from_media
        # Grounded quizzes drop chat history so an earlier topic (e.g. "what
        # is DBMS") doesn't bias questions about the material.
        history: list[dict[str, str]] | None = (
            None if grounding.grounded else ctx.history
        )
        tool_trace.quiz_params(locals())

        # Learn how the exam's previous-year questions are asked first, so
        # the questions match its style and level (best-effort web search).
        exam_pattern = ""
        if exam_label:
            ctx.note(f"Researching {exam_label} question patterns…")
            research = self.exam_research.research(
                exam_label, str(params.get("topic") or "")
            )
            exam_pattern = prompts.exam_pattern_segment(
                exam_label, research.brief
            )

        instructions = params.get("additional_instructions") or "(none)"
        rendered = prompts.PromptBuilder.build(
            prompts.QUIZ_GENERATION_TEMPLATE,
            TOPIC=str(topic),
            QUESTION_COUNT=str(count),
            DIFFICULTY=(
                f"{exam_label} exam level" if exam_label else str(difficulty)
            ),
            QUESTION_TYPES=", ".join(types),
            RECENT_CONTEXT=ctx.enriched_message,
            ADDITIONAL_INSTRUCTIONS=instructions,
            EXAM_PATTERN=exam_pattern,
            USER_PROFILE=prompts.user_profile_segment(ctx.personalization),
            SOURCE_CONTEXT=source_context,
        )
        ctx.note(f"Drafting {count} questions…")
        quiz_data = self.resolve_llm(ctx, "LLM_QUIZ_MODEL").generate_structured(
            rendered.user_message,
            prompts.QUIZ_GENERATION_SCHEMA,
            system_prompt=rendered.system_prompt,
            history=history,
            attachments=attachments,
        )
        # Repair per-type answer invariants (e.g. a single_select the model
        # marked with two correct options) before anything is persisted.
        quiz_data["questions"] = _normalize_questions(
            quiz_data.get("questions") or []
        )
        # Carry the requested difficulty + exam config onto the persisted quiz
        # row so the quizzes list/cards can surface them (the LLM output itself
        # omits both).
        quiz_data["difficulty"] = difficulty
        quiz_data["exam_config"] = exam_config
        ctx.note("Saving your quiz…")
        quiz = self.quiz_repo.create(
            user_id=ctx.user_id,
            # Empty for direct (non-chat) creation from the library pages.
            session_id=ctx.session_id or None,
            quiz_data=quiz_data,
            space_id=ctx.space_id,
        )
        return {
            "quiz_id": quiz["id"],
            "title": quiz["title"],
            "topic": quiz["topic"],
            "questions": quiz["questions"],
            "difficulty": difficulty,
            "target_exam": target_exam,
            "exam_config": exam_config,
            "source": (
                "Uploaded material"
                if from_media
                else "From this conversation"
                if grounding.from_prior
                else quiz["topic"]
            ),
            "source_media_ids": (
                grounding.source_media_ids if from_media else []
            ),
        }
