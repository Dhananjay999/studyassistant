"""Media + LLM tool for PDFs and images."""

from typing import Any

from aeva.llm.llm_client import LLMClient
from aeva.llm import prompts
from aeva.media.compression import ALLOWED_PDF_TYPE
from aeva.mcp.base import BaseTool, ToolContext, ToolDefinition
from aeva.supabase.supabase_service import SupabaseService


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
            parameters_schema={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Question about the uploaded material",
                    },
                    "media_ids": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Specific media IDs to use",
                    },
                },
                "required": ["query"],
            },
        )

    def _build_attachments(
        self,
        ctx: ToolContext,
        media_ids: list[str] | None,
    ) -> list[dict[str, Any]]:
        """Download media bytes for multimodal LLM input."""
        attachments: list[dict[str, Any]] = []

        if media_ids is None:
            items = self.supabase.list_media(
                ctx.user_id, session_id=ctx.session_id
            )
            ids = [item["id"] for item in items]
        else:
            ids = media_ids

        for media_id in ids:
            record = self.supabase.get_media(media_id, ctx.user_id)
            if not record:
                continue
            mime_type = record["mime_type"]
            if mime_type != ALLOWED_PDF_TYPE and not mime_type.startswith(
                "image/"
            ):
                continue
            file_bytes = self.supabase.download_file(record["storage_path"])
            attachments.append({"mime_type": mime_type, "data": file_bytes})

        return attachments

    def execute(self, ctx: ToolContext, params: dict[str, Any]) -> dict[str, Any]:
        """Run multimodal Q&A over uploaded media."""
        query = params.get("query") or ctx.enriched_message
        media_ids = params.get("media_ids") or ctx.media_ids
        attachments = self._build_attachments(ctx, media_ids)

        if not attachments:
            return {
                "answer": (
                    "No study materials were found. Please upload a PDF or "
                    "image, or ask a general question for web search."
                ),
                "media_count": 0,
            }

        prompt = prompts.MEDIA_PROMPT.format(query=query)
        answer = self.llm.generate(
            prompt,
            attachments=attachments,
            history=ctx.history,
        )
        return {
            "answer": answer,
            "media_count": len(attachments),
        }
