"""Media repository."""

import json
import logging
import re
import uuid
from collections.abc import Generator
from typing import Any

from flask import current_app
from werkzeug.datastructures import FileStorage

from aeva.common.errors import ERROR_CODES, CustomError
from aeva.common.schema import UserData, success_response
from aeva.media.compression import (
    ALLOWED_IMAGE_TYPES,
    ALLOWED_PDF_TYPE,
    compress_media,
)
from aeva.media.schema.media_schema import (
    AttachMediaData,
    CompleteUploadData,
    UploadUrlData,
)
from aeva.supabase.supabase_service import SupabaseService

logger = logging.getLogger(__name__)

# Storage-path columns whose files must be removed alongside the original.
_PARSED_PATH_KEYS = ("parsed_json_path", "parsed_md_path", "parsed_text_path")

ALLOWED_TYPES = ALLOWED_IMAGE_TYPES | {ALLOWED_PDF_TYPE}

# Extension used in the storage path when the file name has none we trust.
_EXT_FOR_MIME = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    ALLOWED_PDF_TYPE: "pdf",
}
_EXT_RE = re.compile(r"^[a-z0-9]{1,8}$")
# Shape of every path this server mints: <user id>/<32 hex>.<ext>.
_DIRECT_PATH_RE = re.compile(r"^[0-9a-f-]{36}/[0-9a-f]{32}\.[a-z0-9]{1,8}$")


def _max_upload_bytes() -> int:
    return int(current_app.config["MAX_UPLOAD_MB"]) * 1024 * 1024


def _check_upload(mime_type: str, size_bytes: int) -> None:
    """Refuse a file the server would not store, before any bytes move."""
    if mime_type not in ALLOWED_TYPES:
        raise CustomError(
            ERROR_CODES["VALIDATION_ERROR"],
            details=f"Unsupported file type: {mime_type}",
        )
    if size_bytes <= 0:
        raise CustomError(
            ERROR_CODES["VALIDATION_ERROR"], details="File is empty"
        )
    if size_bytes > _max_upload_bytes():
        limit = current_app.config["MAX_UPLOAD_MB"]
        raise CustomError(
            ERROR_CODES["VALIDATION_ERROR"],
            details=f"File exceeds max size of {limit}MB",
        )


def _storage_path(user_id: str, file_name: str, mime_type: str) -> str:
    ext = file_name.rsplit(".", 1)[-1].lower() if "." in file_name else ""
    if not _EXT_RE.match(ext):
        ext = _EXT_FOR_MIME.get(mime_type, "bin")
    return f"{user_id}/{uuid.uuid4().hex}.{ext}"


def _object_meta(info: dict[str, Any]) -> dict[str, Any]:
    meta = info.get("metadata")
    return meta if isinstance(meta, dict) else {}


def _object_size(info: dict[str, Any]) -> int:
    """Byte size as storage reports it (``size`` on the object-info call)."""
    meta = _object_meta(info)
    for value in (info.get("size"), meta.get("size")):
        try:
            if value is not None:
                return int(value)
        except (TypeError, ValueError):
            continue
    return 0


def _object_mime(info: dict[str, Any]) -> str:
    """Content type as storage reports it (``content_type`` on object info)."""
    meta = _object_meta(info)
    value = (
        info.get("content_type")
        or info.get("contentType")
        or meta.get("mimetype")
        or ""
    )
    return str(value).split(";", 1)[0].strip().lower()


class MediaRepository:
    """Media upload and management."""

    @staticmethod
    def upload_media(
        current_user: UserData,
        files: list[FileStorage],
        session_id: str | None = None,
        space_id: str | None = None,
    ) -> dict[str, Any]:
        """Upload, compress, and store media files."""
        supabase = SupabaseService()
        # Every upload is filed into a space: explicit > session's > General.
        resolved_space = supabase.resolve_space(
            current_user.id, space_id, session_id
        )
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
                space_id=resolved_space,
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
    def create_upload_url(
        current_user: UserData, data: UploadUrlData
    ) -> dict[str, Any]:
        """Step 1 of a direct upload: validate, then mint a signed PUT URL.

        The browser sends the file to storage itself (``POST /media/complete``
        registers it afterwards), so the size limit is ``MAX_UPLOAD_MB``
        rather than what this server's host lets through in one request.
        """
        mime_type = data.mime_type.split(";", 1)[0].strip().lower()
        _check_upload(mime_type, data.size_bytes)
        storage_path = _storage_path(current_user.id, data.file_name, mime_type)
        ticket = SupabaseService().create_signed_upload_url(storage_path)
        ticket["max_bytes"] = _max_upload_bytes()
        return success_response("Upload URL created", ticket)

    @staticmethod
    def complete_upload(
        current_user: UserData, data: CompleteUploadData
    ) -> dict[str, Any]:
        """Step 2 of a direct upload: check the stored object, record it.

        Only a path this server minted for this user is accepted, and the
        object's real size and type (as storage reports them) are what get
        checked and recorded, not what the client claims. An object over the
        limit is removed again.

        Images are not re-compressed here: the browser already scales them
        to the same 2048px bound the multipart route used.
        """
        storage_path = data.storage_path.strip()
        if not storage_path.startswith(f"{current_user.id}/") or not (
            _DIRECT_PATH_RE.match(storage_path)
        ):
            raise CustomError(
                ERROR_CODES["VALIDATION_ERROR"], details="Invalid storage path"
            )

        supabase = SupabaseService()
        info = supabase.storage_object_info(storage_path)
        if info is None:
            raise CustomError(
                ERROR_CODES["UPLOAD_ERROR"],
                details="The file never reached storage. Please retry.",
            )
        size_bytes = _object_size(info) or int(data.size_bytes or 0)
        mime_type = (
            _object_mime(info) or data.mime_type.split(";", 1)[0].lower()
        )
        try:
            _check_upload(mime_type, size_bytes)
        except CustomError:
            supabase.delete_storage_file(storage_path)
            raise

        resolved_space = supabase.resolve_space(
            current_user.id, data.space_id, data.session_id
        )
        record = supabase.create_media_record(
            user_id=current_user.id,
            file_name=data.file_name,
            mime_type=mime_type,
            storage_path=storage_path,
            size_bytes=size_bytes,
            session_id=data.session_id,
            space_id=resolved_space,
        )
        record["signed_url"] = supabase.get_signed_url(storage_path)
        logger.info("Registered direct upload: %s", data.file_name)
        return success_response("Media uploaded", record)

    @staticmethod
    def list_media(
        current_user: UserData,
        session_id: str | None = None,
        space_id: str | None = None,
    ) -> dict[str, Any]:
        """List media for user (newest first, capped).

        The cap (``MEDIA_LIST_LIMIT``) keeps the response bounded — an
        uncapped list of every upload + generated image once exceeded the
        serverless 4.5MB response limit (413). Signed URLs are minted in one
        batched storage call instead of one round-trip per file.
        """
        from flask import current_app

        supabase = SupabaseService()
        limit = int(current_app.config.get("MEDIA_LIST_LIMIT", 300))
        items = supabase.list_media(
            current_user.id, session_id, space_id, limit=limit
        )
        urls = supabase.get_signed_urls([i["storage_path"] for i in items])
        for item in items:
            item["signed_url"] = urls.get(item["storage_path"], "")
        return success_response("Media retrieved", items)

    @staticmethod
    def attach_media(
        current_user: UserData, data: AttachMediaData
    ) -> dict[str, Any]:
        """Link uploads that pre-date a chat to that session.

        A file uploaded on a fresh "New chat" screen has no session yet; the
        client calls this once the session exists so session-scoped lookups
        (and "This chat" badges) find it. Owner-checked on both sides.
        """
        supabase = SupabaseService()
        if not supabase.get_session(data.session_id, current_user.id):
            raise CustomError(ERROR_CODES["NOT_FOUND"])
        supabase.attach_media_to_session(
            data.media_ids, data.session_id, current_user.id
        )
        return success_response(
            "Media attached",
            {"session_id": data.session_id, "media_ids": data.media_ids},
        )

    @staticmethod
    def delete_media(
        current_user: UserData,
        media_id: str,
    ) -> dict[str, Any]:
        """Delete a media file and all of its derived artifacts."""
        supabase = SupabaseService()
        record = supabase.get_media(media_id, current_user.id)
        if not record:
            raise CustomError(ERROR_CODES["NOT_FOUND"])

        supabase.delete_storage_file(record["storage_path"])
        for key in _PARSED_PATH_KEYS:
            if record.get(key):
                supabase.delete_storage_file(record[key])
        # media_chunks / media_pages drop via ON DELETE CASCADE.
        supabase.delete_media_record(media_id, current_user.id)
        return success_response("Media deleted", {"id": media_id})

    @staticmethod
    def get_status(
        current_user: UserData,
        media_id: str,
    ) -> dict[str, Any]:
        """Return a media record with its processing status (for polling)."""
        supabase = SupabaseService()
        record = supabase.get_media(media_id, current_user.id)
        if not record:
            raise CustomError(ERROR_CODES["NOT_FOUND"])
        record["signed_url"] = supabase.get_signed_url(
            record["storage_path"]
        )
        return success_response("Media status", record)

    @staticmethod
    def process_stream(
        current_user: UserData,
        media_id: str,
    ) -> Generator[str, None, None]:
        """Stream processing progress as SSE frames.

        Delegates to the container's ``MediaProcessor`` (which owns the staged
        parse -> chunk -> embed -> index pipeline) and frames each progress
        event; the ``ready`` and ``error`` stages also carry ``done: true``.
        """
        container = current_app.extensions["container"]
        processor = container.media_processor()
        for event in processor.process(current_user.id, media_id):
            done = event["stage"] in ("ready", "error")
            yield f"data: {json.dumps({**event, 'done': done})}\n\n"
