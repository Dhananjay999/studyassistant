"""Media schemas."""

from dataclasses import dataclass, field

from marshmallow import Schema, fields, post_load, validate


@dataclass
class AttachMediaData:
    """Attach-media payload: link uploads to a chat session."""

    session_id: str
    media_ids: list[str] = field(default_factory=list)


class AttachMediaSchema(Schema):
    """POST /media/attach request."""

    session_id = fields.Str(required=True)
    media_ids = fields.List(fields.Str(), required=True)

    @post_load
    def make_data(self, data: dict, **_kwargs: object) -> AttachMediaData:
        """Convert to dataclass."""
        return AttachMediaData(**data)


@dataclass
class UploadUrlData:
    """Ask for a signed URL to upload one file straight to storage."""

    file_name: str
    mime_type: str
    size_bytes: int
    session_id: str | None = None
    space_id: str | None = None


class UploadUrlSchema(Schema):
    """POST /media/upload-url request."""

    file_name = fields.Str(
        required=True, validate=validate.Length(min=1, max=255)
    )
    mime_type = fields.Str(
        required=True, validate=validate.Length(min=1, max=100)
    )
    size_bytes = fields.Int(required=True, validate=validate.Range(min=0))
    session_id = fields.Str(load_default=None, allow_none=True)
    space_id = fields.Str(load_default=None, allow_none=True)

    @post_load
    def make_data(self, data: dict, **_kwargs: object) -> UploadUrlData:
        """Convert to dataclass."""
        return UploadUrlData(**data)


@dataclass
class CompleteUploadData:
    """Register a file the browser has put in storage."""

    storage_path: str
    file_name: str
    mime_type: str
    size_bytes: int = 0
    session_id: str | None = None
    space_id: str | None = None


class CompleteUploadSchema(Schema):
    """POST /media/complete request."""

    storage_path = fields.Str(
        required=True, validate=validate.Length(min=1, max=300)
    )
    file_name = fields.Str(
        required=True, validate=validate.Length(min=1, max=255)
    )
    mime_type = fields.Str(
        required=True, validate=validate.Length(min=1, max=100)
    )
    size_bytes = fields.Int(load_default=0, validate=validate.Range(min=0))
    session_id = fields.Str(load_default=None, allow_none=True)
    space_id = fields.Str(load_default=None, allow_none=True)

    @post_load
    def make_data(self, data: dict, **_kwargs: object) -> CompleteUploadData:
        """Convert to dataclass."""
        return CompleteUploadData(**data)


class MediaSchema(Schema):
    """Media response item."""

    id = fields.Str(required=True)
    user_id = fields.Str(required=True)
    session_id = fields.Str(allow_none=True)
    file_name = fields.Str(required=True)
    mime_type = fields.Str(required=True)
    storage_path = fields.Str(required=True)
    size_bytes = fields.Int(required=True)
    created_at = fields.Str(required=True)
    signed_url = fields.Str(allow_none=True)
    # RAG processing lifecycle (see migration 007).
    processing_status = fields.Str(allow_none=True)
    processing_error = fields.Str(allow_none=True)
    page_count = fields.Int(allow_none=True)
    chunk_count = fields.Int(allow_none=True)
    processed_at = fields.Str(allow_none=True)
