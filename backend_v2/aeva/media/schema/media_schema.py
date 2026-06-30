"""Media schemas."""

from marshmallow import Schema, fields


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
