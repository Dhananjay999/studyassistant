"""Image-generation tool: study visuals in the right format, on demand.

Generates one image with an image-capable model (``LLM_IMAGE_MODEL``),
stores it in the user's media library — filed into the session's Study Space
like any other upload — and returns it alongside a short caption. The
frontend renders the image inline in the chat and it appears in the
Files/media surfaces automatically because it IS a media row.

The format is chosen per request from the image skill registry
(``aeva.llm.prompts.image_skills``): the planner sets ``style``, else the
wording of the request decides (``pick_skill``). The skill's brief — layout,
labelling, palette, what to avoid — is rendered into ``IMAGE_TEMPLATE``
around the student's subject, so a flowchart request gets a flowchart brief
rather than a generic illustration prefix.
"""

import logging
import uuid
from typing import Any

from aeva.llm import prompts
from aeva.llm.llm_client import LLMClient
from aeva.mcp.base import (
    RESPONSE_IMAGE,
    BaseTool,
    ToolContext,
    ToolDefinition,
    source_context_block,
)
from aeva.supabase.supabase_service import SupabaseService
from aeva.tracing.services import tool_trace

logger = logging.getLogger(__name__)

_MIME_EXT = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
}

# Prior-agent text handed to the image model to ground labels and facts.
_GROUNDING_MAX_CHARS = 2000
_TITLE_MAX_WORDS = 8


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
                "Generate an image in the right format: flowcharts, mind "
                "maps, labelled diagrams, timelines, charts, infographics, "
                "maps, comics, black-and-white line drawings, colourful "
                "illustrations, or realistic pictures. Use when the student "
                "explicitly wants a visual made ('draw…', 'make a "
                "flowchart of…', 'show me a diagram of…'). NOT for text "
                "answers that merely mention a diagram."
            ),
            parameters_schema=prompts.IMAGE_GENERATION_PARAMS,
        )

    @property
    def response_type(self) -> str:
        """An answer whose payload is a generated image."""
        return RESPONSE_IMAGE

    def can_stream(self) -> bool:
        """Image bytes arrive whole — nothing to stream."""
        return False

    @staticmethod
    def render_prompt(
        request: str, skill: prompts.ImageSkill, grounding: str = ""
    ) -> str:
        """Render the full image prompt for a request + skill."""
        source = ""
        if grounding:
            source = (
                "\nGround the labels and facts in this explanation:\n"
                f"{grounding}"
            )
        rendered = prompts.PromptBuilder.build(
            prompts.IMAGE_TEMPLATE,
            SKILL_LABEL=skill.label,
            SKILL_INSTRUCTIONS=skill.instructions,
            SKILL_AVOID=skill.avoid,
            USER_REQUEST=request,
            SOURCE_CONTEXT=source,
        )
        return rendered.user_message

    def execute(
        self, ctx: ToolContext, params: dict[str, Any]
    ) -> dict[str, Any]:
        """Generate, store, and return one image."""
        request = (params.get("prompt") or ctx.enriched_message).strip()
        # The student's own words decide the format when the planner did
        # not: "black and white" in the message must win over a default.
        skill = prompts.pick_skill(
            f"{ctx.message}\n{request}", params.get("style")
        )
        tool_trace.image_skill(skill, params.get("style"))
        title = _clean_title(params.get("title"), request)
        grounding = source_context_block(
            ctx.prior_results, max_chars=_GROUNDING_MAX_CHARS
        )
        ctx.note(f"Drawing the {skill.label.lower()}…")
        llm = self.resolve_llm(ctx, "LLM_IMAGE_MODEL")
        image, mime, caption = llm.generate_image(
            self.render_prompt(request, skill, grounding),
            aspect=skill.aspect,
        )

        ctx.note("Saving to your library…")
        ext = _MIME_EXT.get(mime, "png")
        storage_path = f"{ctx.user_id}/generated/{uuid.uuid4().hex}.{ext}"
        self.supabase.upload_file(storage_path, image, mime)
        record = self.supabase.create_media_record(
            user_id=ctx.user_id,
            file_name=f"aeva-{skill.id}-{_slug(title)}.{ext}",
            mime_type=mime,
            storage_path=storage_path,
            size_bytes=len(image),
            session_id=ctx.session_id,
            space_id=ctx.space_id,
            # Generated images skip the parse pipeline — born ready, so they
            # never sit on a "processing" icon.
            processing_status="ready",
        )
        logger.info(
            "Generated image %s | style=%s | %d bytes | session %s",
            record["id"],
            skill.id,
            len(image),
            ctx.session_id,
        )

        # Never echo the raw generation prompt back to the student — it reads
        # as a wall of internal instructions in the chat.
        answer = caption or (
            f"Here's the {skill.label.lower()} you asked for! It's also "
            "saved in your Study Material, so you can revisit it anytime."
        )
        return {
            "answer": answer,
            "sources": [],
            "style": skill.id,
            "style_label": skill.label,
            "images": [
                {
                    "media_id": record["id"],
                    "file_name": record["file_name"],
                    "url": self.supabase.get_signed_url(storage_path),
                    "style": skill.id,
                    "style_label": skill.label,
                    "alt": title,
                }
            ],
        }


def _clean_title(title: object, request: str) -> str:
    """Short caption: the planner's title, else the head of the request."""
    text = str(title or "").strip() or request
    words = text.replace("\n", " ").split()
    return " ".join(words[:_TITLE_MAX_WORDS])


def _slug(text: str, max_len: int = 40) -> str:
    """Filesystem-friendly slice of text for the media file name."""
    cleaned = "".join(
        ch if ch.isalnum() or ch == " " else "" for ch in text.lower()
    )
    return "-".join(cleaned.split())[:max_len].rstrip("-") or "image"
