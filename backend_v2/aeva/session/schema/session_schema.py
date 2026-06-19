"""Session schemas."""

from dataclasses import dataclass, field

from marshmallow import Schema, fields, post_load, validate


@dataclass
class CreateSessionData:
    """Create session payload."""

    title: str = "New chat"
    mode: str = "media"
    media_ids: list[str] = field(default_factory=list)


class CreateSessionSchema(Schema):
    """Create session request."""

    title = fields.Str(load_default="New chat")
    mode = fields.Str(
        load_default="media",
        validate=validate.OneOf(["media", "web_search"]),
    )
    media_ids = fields.List(fields.Str(), load_default=list)

    @post_load
    def make_data(self, data: dict, **_kwargs: object) -> CreateSessionData:
        """Convert to dataclass."""
        return CreateSessionData(**data)


class UpdateSessionSchema(Schema):
    """Update session request."""

    title = fields.Str(required=False)


class SessionSchema(Schema):
    """Session response item."""

    id = fields.Str(required=True)
    user_id = fields.Str(required=True)
    title = fields.Str(required=True)
    mode = fields.Str(required=True)
    created_at = fields.Str(required=True)
    updated_at = fields.Str(required=True)


class MessageSchema(Schema):
    """Message response item."""

    id = fields.Str(required=True)
    session_id = fields.Str(required=True)
    role = fields.Str(required=True)
    content = fields.Str(required=True)
    metadata = fields.Dict(required=True)
    created_at = fields.Str(required=True)
