"""Media repository."""

import logging
import uuid
from typing import Any

from werkzeug.datastructures import FileStorage

from aeva.common.errors import ERROR_CODES, CustomError
from aeva.common.schema import UserData, success_response
from aeva.media.compression import ALLOWED_IMAGE_TYPES, ALLOWED_PDF_TYPE, compress_media
from aeva.supabase.supabase_service import SupabaseService

logger = logging.getLogger(__name__)

ALLOWED_TYPES = ALLOWED_IMAGE_TYPES | {ALLOWED_PDF_TYPE}


class MediaRepository:
    """Media upload and management."""

    @staticmethod
    def upload_media(
        current_user: UserData,
        files: list[FileStorage],
        session_id: str | None = None,
    ) -> dict[str, Any]:
        """Upload, compress, and store media files."""
        supabase = SupabaseService()
        uploaded = []

        for file in files:
            if not file or not file.filename:
                continue

            mime_type = file.content_type or "application/octet-stream"
            if mime_type not in ALLOWED_TYPES:
                raise CustomError(
                    ERROR_CODES["VALIDATION_ERROR"],
                    details=f"Unsupported file type: {mime_type}",
                )

            raw_bytes = file.read()
            try:
                compressed, final_mime = compress_media(raw_bytes, mime_type)
            except ValueError as exc:
                raise CustomError(
                    ERROR_CODES["VALIDATION_ERROR"],
                    details=str(exc),
                ) from exc

            ext = file.filename.rsplit(".", 1)[-1].lower()
            unique_name = f"{uuid.uuid4().hex}.{ext}"
            storage_path = f"{current_user.id}/{unique_name}"

            supabase.upload_file(storage_path, compressed, final_mime)
            record = supabase.create_media_record(
                user_id=current_user.id,
                file_name=file.filename,
                mime_type=final_mime,
                storage_path=storage_path,
                size_bytes=len(compressed),
                session_id=session_id,
            )
            record["signed_url"] = supabase.get_signed_url(storage_path)
            uploaded.append(record)
            logger.info("Uploaded media: %s", file.filename)

        if not uploaded:
            raise CustomError(
                ERROR_CODES["UPLOAD_ERROR"],
                details="No valid files uploaded",
            )

        return success_response("Media uploaded", uploaded)

    @staticmethod
    def list_media(
        current_user: UserData,
        session_id: str | None = None,
    ) -> dict[str, Any]:
        """List media for user."""
        supabase = SupabaseService()
        items = supabase.list_media(current_user.id, session_id)
        for item in items:
            item["signed_url"] = supabase.get_signed_url(
                item["storage_path"]
            )
        return success_response("Media retrieved", items)

    @staticmethod
    def delete_media(
        current_user: UserData,
        media_id: str,
    ) -> dict[str, Any]:
        """Delete a media file."""
        supabase = SupabaseService()
        record = supabase.get_media(media_id, current_user.id)
        if not record:
            raise CustomError(ERROR_CODES["NOT_FOUND"])

        supabase.delete_storage_file(record["storage_path"])
        supabase.delete_media_record(media_id, current_user.id)
        return success_response("Media deleted", {"id": media_id})
