"""Flashcard generation tool."""

from typing import Any

from flask import current_app

from aeva.flashcard.flashcard_repository import FlashcardRepository
from aeva.llm import prompts
from aeva.llm.llm_client import LLMClient
from aeva.mcp.base import (
    ACTION_OPEN_FLASHCARDS,
    RESPONSE_FLASHCARD_CREATED,
    BaseTool,
    ToolContext,
    ToolDefinition,
)
from aeva.media.grounding import ground_generator
from aeva.media.retrieval import RetrievalService
from aeva.supabase.supabase_service import SupabaseService
from aeva.tracing.services import tool_trace


class FlashcardGeneratorTool(BaseTool):
    """Generate a flashcard set and persist it."""

    def __init__(
        self,
        llm: LLMClient | None = None,
        flashcard_repo: FlashcardRepository | None = None,
        supabase: SupabaseService | None = None,
        retrieval: RetrievalService | None = None,
    ) -> None:
        self._llm = llm
        self._flashcard_repo = flashcard_repo
        self._supabase = supabase
        self._retrieval = retrieval

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
    def retrieval(self) -> RetrievalService:
        """Lazy retrieval service (grounds cards in indexed uploads)."""
        if self._retrieval is None:
            self._retrieval = RetrievalService(supabase=self.supabase)
        return self._retrieval

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

    @property
    def response_type(self) -> str:
        """A generated flashcard set is its own response category."""
        return RESPONSE_FLASHCARD_CREATED

    @property
    def available_actions(self) -> list[str]:
        """The only meaningful action is opening the set just created."""
        return [ACTION_OPEN_FLASHCARDS]

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
        topic = params.get("topic") or "the provided study material"
        count = min(
            int(params.get("count", 8)),
            current_app.config.get("FLASHCARD_MAX_CARDS", 20),
        )

        grounding = ground_generator(
            ctx,
            topic=str(params.get("topic") or ""),
            wants_media=self._wants_media(params, ctx),
            supabase=self.supabase,
            retrieval=self.retrieval,
        )
        attachments = grounding.attachments
        source_context = grounding.source_context
        source_type = "media" if grounding.from_media else "response"
        history: list[dict[str, str]] | None = (
            None if grounding.grounded else ctx.history
        )
        tool_trace.flashcard_params(locals())

        instructions = params.get("additional_instructions") or "(none)"
        rendered = prompts.PromptBuilder.build(
            prompts.FLASHCARD_GENERATION_TEMPLATE,
            TOPIC=str(topic),
            CARD_COUNT=str(count),
            RECENT_CONTEXT=ctx.enriched_message,
            ADDITIONAL_INSTRUCTIONS=str(instructions),
            USER_PROFILE=prompts.user_profile_segment(ctx.personalization),
            SOURCE_CONTEXT=source_context,
        )
        ctx.note(f"Writing {count} cards…")
        data = self.resolve_llm(
            ctx, "LLM_FLASHCARD_MODEL"
        ).generate_structured(
            rendered.user_message,
            prompts.FLASHCARD_GENERATION_SCHEMA,
            system_prompt=rendered.system_prompt,
            history=history,
            attachments=attachments,
        )
        ctx.note("Saving your flashcards…")
        fset = self.flashcard_repo.create(
            user_id=ctx.user_id,
            # Empty for direct (non-chat) creation from the library pages.
            session_id=ctx.session_id or None,
            data=data,
            source_type=source_type,
            space_id=ctx.space_id,
        )
        return {
            "set_id": fset["set_id"],
            "title": fset["title"],
            "topic": fset["topic"],
            "cards": fset["cards"],
            "source": (
                "Uploaded material"
                if source_type == "media"
                else "From this conversation"
                if grounding.from_prior
                else fset["topic"]
            ),
            "source_media_ids": (
                grounding.source_media_ids if grounding.from_media else []
            ),
        }
