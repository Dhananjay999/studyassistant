"""Image-generation tool: educational illustrations and diagrams on demand.

Generates one image with an image-capable model (``LLM_IMAGE_MODEL``, Gemini
today), stores it in the user's media library — filed into the session's
Study Space like any other upload — and returns it alongside a short caption.
The frontend renders the image inline in the chat and it appears in the
Files/media surfaces automatically because it IS a media row.
"""

import logging
import uuid
from typing import Any

from aeva.llm.llm_client import LLMClient
from aeva.mcp.base import (
    RESPONSE_NORMAL,
    BaseTool,
    ToolContext,
    ToolDefinition,
)
from aeva.supabase.supabase_service import SupabaseService

logger = logging.getLogger(__name__)

# Nudges the model toward clean, education-first visuals without overriding
# the student's own style requests (their prompt comes after this).
_STYLE_PREFIX = (
    "Create a single clear, well-labeled educational illustration suitable "
    "for a student's study notes. Prefer clean diagrams with readable labels "
    "over photorealism unless asked otherwise.\n\nRequest: "
)

_MIME_EXT = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
}

IMAGE_GENERATION_PARAMS: dict[str, Any] = {
    "type": "object",
    "properties": {
        "prompt": {
            "type": "string",
            "description": (
                "Complete visual description of the image to generate, "
                "including the subject, any labels to include, and style "
                "cues. Resolve references from the conversation so the "
                "prompt stands alone."
            ),
        },
    },
    "required": ["prompt"],
}


class ImageGeneratorTool(BaseTool):
    """Generate an educational image and file it into the media library."""

    def __init__(
        self,
        llm: LLMClient | None = None,
        supabase: SupabaseService | None = None,
    ) -> None:
        self._llm = llm
        self._supabase = supabase

    @property
    def supabase(self) -> SupabaseService:
        """Lazy Supabase client."""
        return self._supabase or SupabaseService()

    @property
    def definition(self) -> ToolDefinition:
        """Tool metadata."""
        return ToolDefinition(
            name="image_generator",
            description=(
                "Generate an image: diagrams, illustrations, visualizations, "
                "or pictures the student asks to be drawn/created. Use when "
                "the user explicitly wants a visual (\"draw…\", \"generate "
                "an image…\", \"show me a diagram of…\", \"illustrate…\"). "
                "NOT for text answers that merely mention a diagram."
            ),
            parameters_schema=IMAGE_GENERATION_PARAMS,
        )

    @property
    def response_type(self) -> str:
        """A normal answer carrying an image attachment."""
        return RESPONSE_NORMAL

    def can_stream(self) -> bool:
        """Image bytes arrive whole — nothing to stream."""
        return False

    def execute(
        self, ctx: ToolContext, params: dict[str, Any]
    ) -> dict[str, Any]:
        """Generate, store, and return one image."""
        prompt = (params.get("prompt") or ctx.enriched_message).strip()
        llm = self.resolve_llm(ctx, "LLM_IMAGE_MODEL")
        image, mime, caption = llm.generate_image(_STYLE_PREFIX + prompt)

        ext = _MIME_EXT.get(mime, "png")
        storage_path = f"{ctx.user_id}/generated/{uuid.uuid4().hex}.{ext}"
        self.supabase.upload_file(storage_path, image, mime)
        record = self.supabase.create_media_record(
            user_id=ctx.user_id,
            file_name=f"aeva-{_slug(prompt)}.{ext}",
            mime_type=mime,
            storage_path=storage_path,
            size_bytes=len(image),
            session_id=ctx.session_id,
            space_id=ctx.space_id,
        )
        logger.info(
            "Generated image %s (%d bytes) for session %s",
            record["id"],
            len(image),
            ctx.session_id,
        )

        # Never echo the raw generation prompt back to the student — it reads
        # as a wall of internal instructions in the chat.
        answer = caption or (
            "Here's the image you asked for! It's also saved in your media "
            "library, so you can revisit it anytime."
        )
        return {
            "answer": answer,
            "sources": [],
            "images": [
                {
                    "media_id": record["id"],
                    "file_name": record["file_name"],
                    "url": self.supabase.get_signed_url(storage_path),
                }
            ],
        }


def _slug(prompt: str, max_len: int = 40) -> str:
    """Filesystem-friendly slice of the prompt for the media file name."""
    cleaned = "".join(
        ch if ch.isalnum() or ch == " " else "" for ch in prompt.lower()
    )
    return "-".join(cleaned.split())[:max_len].rstrip("-") or "image"
