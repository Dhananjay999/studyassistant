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
from aeva.media.attachments import download_attachments
from aeva.quiz.quiz_repository import QuizRepository
from aeva.supabase.supabase_service import SupabaseService


class QuizGeneratorTool(BaseTool):
    """Generate a dynamic quiz and persist it."""

    def __init__(
        self,
        llm: LLMClient | None = None,
        quiz_repo: QuizRepository | None = None,
        supabase: SupabaseService | None = None,
    ) -> None:
        self._llm = llm
        self._quiz_repo = quiz_repo
        self._supabase = supabase

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
        types = params.get("question_types") or [
            "single_select",
            "multi_select",
            "true_false",
        ]

        attachments = None
        history: list[dict[str, str]] | None = ctx.history
        from_media = False
        if self._wants_media(params, ctx):
            attachments = download_attachments(
                self.supabase, ctx.user_id, ctx.session_id, ctx.media_ids
            )
            if attachments:
                from_media = True
                # Quiz purely from the uploaded material; drop chat history so
                # an earlier topic (e.g. "what is DBMS") doesn't bias it.
                history = None

        prompt = prompts.QUIZ_GENERATION_PROMPT.format(
            topic=topic,
            count=count,
            difficulty=difficulty,
            types=", ".join(types),
            context=ctx.enriched_message,
        )
        quiz_data = self.llm.generate_structured(
            prompt,
            prompts.QUIZ_GENERATION_SCHEMA,
            system_prompt=prompts.personalize(
                prompts.SYSTEM_PROMPT, ctx.personalization
            ),
            history=history,
            attachments=attachments,
        )
        quiz = self.quiz_repo.create(
            user_id=ctx.user_id,
            session_id=ctx.session_id,
            quiz_data=quiz_data,
        )
        return {
            "quiz_id": quiz["id"],
            "title": quiz["title"],
            "topic": quiz["topic"],
            "questions": quiz["questions"],
            "difficulty": difficulty,
            "source": "Uploaded material" if from_media else quiz["topic"],
        }
