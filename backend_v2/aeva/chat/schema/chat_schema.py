"""Chat schemas."""

from dataclasses import dataclass
from typing import Any

from marshmallow import Schema, fields, post_load, validate


@dataclass
class ChatRequestData:
    """Chat request payload."""

    message: str
    session_id: str
    mode: str = "media"
    media_ids: list[str] | None = None


class ChatRequestSchema(Schema):
    """Chat request."""

    message = fields.Str(required=True, validate=validate.Length(min=1))
    session_id = fields.Str(required=True)
    mode = fields.Str(
        load_default="media",
        validate=validate.OneOf(["media", "web_search"]),
    )
    media_ids = fields.List(fields.Str(), load_default=None)

    @post_load
    def make_data(self, data: dict, **_kwargs: object) -> ChatRequestData:
        """Convert to dataclass."""
        return ChatRequestData(**data)


class ChatResponseSchema(Schema):
    """Chat response."""

    answer = fields.Str(required=True)
    mode = fields.Str(required=True)
    sources = fields.List(fields.Dict(), load_default=list)
    message_id = fields.Str(allow_none=True)
