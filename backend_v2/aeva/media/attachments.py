"""Download uploaded media as multimodal LLM attachments."""

from typing import Any

from aeva.media.compression import ALLOWED_PDF_TYPE
from aeva.supabase.supabase_service import SupabaseService


def download_attachments(
    supabase: SupabaseService,
    user_id: str,
    session_id: str,
    media_ids: list[str] | None,
) -> list[dict[str, Any]]:
    """Fetch PDF/image bytes for multimodal LLM input.

    ``media_ids=None`` means "every media item in the session"; otherwise only
    the given ids are used. Non-PDF/non-image records are skipped.
    """
    if media_ids is None:
        items = supabase.list_media(user_id, session_id=session_id)
        ids = [item["id"] for item in items]
    else:
        ids = media_ids

    attachments: list[dict[str, Any]] = []
    for media_id in ids:
        record = supabase.get_media(media_id, user_id)
        if not record:
            continue
        mime_type = record["mime_type"]
        if mime_type != ALLOWED_PDF_TYPE and not mime_type.startswith(
            "image/"
        ):
            continue
        file_bytes = supabase.download_file(record["storage_path"])
        attachments.append({"mime_type": mime_type, "data": file_bytes})
    return attachments
