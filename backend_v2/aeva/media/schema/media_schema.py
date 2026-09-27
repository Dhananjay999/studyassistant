"""Media schemas."""

from dataclasses import dataclass, field

from marshmallow import Schema, fields, post_load


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
