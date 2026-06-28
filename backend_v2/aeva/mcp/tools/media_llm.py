"""Media + LLM tool for PDFs and images."""

from collections.abc import Generator
from typing import Any

from aeva.llm import prompts
from aeva.llm.llm_client import LLMClient
from aeva.mcp.base import (
    RESPONSE_FILE_ANALYSIS,
    BaseTool,
    ToolContext,
    ToolDefinition,
)
from aeva.media.attachments import download_attachments
from aeva.supabase.supabase_service import SupabaseService

NO_MEDIA_MESSAGE = (
    "No study materials were found. Please upload a PDF or image, or ask a "
    "general question for web search."
)


class MediaLLMTool(BaseTool):
    """Answer questions using uploaded study materials."""

    def __init__(
        self,
        llm: LLMClient | None = None,
        supabase: SupabaseService | None = None,
    ) -> None:
        self._llm = llm
        self._supabase = supabase

    @property
    def llm(self) -> LLMClient:
        """Lazy LLM client."""
        return self._llm or LLMClient(config_key="LLM_MEDIA_MODEL")

    @property
    def supabase(self) -> SupabaseService:
        """Lazy Supabase client."""
        return self._supabase or SupabaseService()

    @property
    def definition(self) -> ToolDefinition:
        """Tool metadata."""
        return ToolDefinition(
            name="media_llm",
            description=(
                "Analyze uploaded PDFs, images, screenshots, diagrams, or "
                "handwritten notes and answer questions about them."
            ),
            parameters_schema=prompts.MEDIA_PARAMS,
        )

    @property
    def response_type(self) -> str:
        """Answers grounded in uploaded files are file analysis."""
        return RESPONSE_FILE_ANALYSIS

    def _build_attachments(
        self,
        ctx: ToolContext,
        media_ids: list[str] | None,
    ) -> list[dict[str, Any]]:
        """Download media bytes for multimodal LLM input."""
        return download_attachments(
            self.supabase, ctx.user_id, ctx.session_id, media_ids
        )

    def execute(self, ctx: ToolContext, params: dict[str, Any]) -> dict[str, Any]:
        """Run multimodal Q&A over uploaded media."""
        query = params.get("query") or ctx.enriched_message
        media_ids = params.get("media_ids") or ctx.media_ids
        attachments = self._build_attachments(ctx, media_ids)

        if not attachments:
            return {"answer": NO_MEDIA_MESSAGE, "media_count": 0}

        prompt = prompts.MEDIA_PROMPT.format(query=query)
        answer = self.llm.generate(
            prompt,
            system_prompt=prompts.personalize(None, ctx.personalization),
            attachments=attachments,
            history=ctx.history,
        )
        return {
            "answer": answer,
            "media_count": len(attachments),
        }

    def can_stream(self) -> bool:
        """Media answers stream token-by-token."""
        return True

    def execute_stream(
        self,
        ctx: ToolContext,
        params: dict[str, Any],
    ) -> Generator[str, None, dict[str, Any]]:
        """Stream the multimodal answer, returning answer + media count."""
        llm = self.llm
        query = params.get("query") or ctx.enriched_message
        media_ids = params.get("media_ids") or ctx.media_ids
        attachments = self._build_attachments(ctx, media_ids)

        if not attachments:
            yield NO_MEDIA_MESSAGE
            return {"answer": NO_MEDIA_MESSAGE, "media_count": 0}

        prompt = prompts.MEDIA_PROMPT.format(query=query)
        answer = ""
        for chunk in llm.generate_stream(
            prompt,
            system_prompt=prompts.personalize(None, ctx.personalization),
            attachments=attachments,
            history=ctx.history,
        ):
            answer += chunk
            yield chunk
        return {"answer": answer, "media_count": len(attachments)}
