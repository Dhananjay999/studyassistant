"""Flashcard generation tool."""

from typing import Any

from flask import current_app

from aeva.flashcard.flashcard_repository import FlashcardRepository
from aeva.llm import prompts
from aeva.llm.llm_client import LLMClient
from aeva.mcp.base import BaseTool, ToolContext, ToolDefinition
from aeva.media.attachments import download_attachments
from aeva.supabase.supabase_service import SupabaseService


class FlashcardGeneratorTool(BaseTool):
    """Generate a flashcard set and persist it."""

    def __init__(
        self,
        llm: LLMClient | None = None,
        flashcard_repo: FlashcardRepository | None = None,
        supabase: SupabaseService | None = None,
    ) -> None:
        self._llm = llm
        self._flashcard_repo = flashcard_repo
        self._supabase = supabase

    @property
    def llm(self) -> LLMClient:
        """Lazy LLM client."""
        return self._llm or LLMClient(config_key="LLM_FLASHCARD_MODEL")

    @property
    def flashcard_repo(self) -> FlashcardRepository:
        """Lazy flashcard repository."""
        return self._flashcard_repo or FlashcardRepository()

    @property
    def supabase(self) -> SupabaseService:
        """Lazy Supabase client (for media-based flashcards)."""
        return self._supabase or SupabaseService()

    @property
    def definition(self) -> ToolDefinition:
        """Tool metadata."""
        return ToolDefinition(
            name="flashcard_generator",
            description=(
                "Generate study flashcards (front question/term, back "
                "answer/explanation) on a topic or from uploaded material."
            ),
            parameters_schema=prompts.FLASHCARD_GENERATOR_PARAMS,
        )

    @staticmethod
    def _wants_media(params: dict[str, Any], ctx: ToolContext) -> bool:
        """Decide whether to build cards from uploaded material."""
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

    def execute(
        self, ctx: ToolContext, params: dict[str, Any]
    ) -> dict[str, Any]:
        """Generate and persist a flashcard set."""
        topic = params.get("topic") or ctx.enriched_message
        count = min(
            int(params.get("count", 8)),
            current_app.config.get("FLASHCARD_MAX_CARDS", 20),
        )

        attachments = None
        history: list[dict[str, str]] | None = ctx.history
        source_type = "response"
        if self._wants_media(params, ctx):
            attachments = download_attachments(
                self.supabase, ctx.user_id, ctx.session_id, ctx.media_ids
            )
            if attachments:
                source_type = "media"
                history = None

        prompt = prompts.FLASHCARD_GENERATION_PROMPT.format(
            topic=topic,
            count=count,
            context=ctx.enriched_message,
        )
        data = self.llm.generate_structured(
            prompt,
            prompts.FLASHCARD_GENERATION_SCHEMA,
            system_prompt=prompts.SYSTEM_PROMPT,
            history=history,
            attachments=attachments,
        )
        fset = self.flashcard_repo.create(
            user_id=ctx.user_id,
            session_id=ctx.session_id,
            data=data,
            source_type=source_type,
        )
        return {
            "set_id": fset["set_id"],
            "title": fset["title"],
            "topic": fset["topic"],
            "cards": fset["cards"],
            "source": (
                "Uploaded material"
                if source_type == "media"
                else fset["topic"]
            ),
        }
