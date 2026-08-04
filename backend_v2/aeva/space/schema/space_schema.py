"""Study Spaces request schemas."""

from dataclasses import dataclass

from marshmallow import Schema, fields, post_load, validate

# Palette / icon keys are app-level enums rendered by the client; the backend
# only bounds their length so the client list can evolve without migrations.
_KEY = validate.Length(min=1, max=40)


@dataclass(frozen=True)
class CreateSpaceData:
    """Validated create-space payload."""

    name: str
    description: str = ""
    subject: str = ""
    color: str = "brand"
    icon: str = "book"


class CreateSpaceSchema(Schema):
    """Create a study space."""

    name = fields.Str(required=True, validate=validate.Length(min=1, max=80))
    description = fields.Str(
        load_default="", validate=validate.Length(max=500)
    )
    subject = fields.Str(load_default="", validate=validate.Length(max=80))
    color = fields.Str(load_default="brand", validate=_KEY)
    icon = fields.Str(load_default="book", validate=_KEY)

    @post_load
    def make_data(self, data: dict, **_kwargs: object) -> CreateSpaceData:
        """Convert to dataclass."""
        return CreateSpaceData(**data)


class UpdateSpaceSchema(Schema):
    """Patch space fields (all optional)."""

    name = fields.Str(validate=validate.Length(min=1, max=80))
    description = fields.Str(validate=validate.Length(max=500))
    subject = fields.Str(validate=validate.Length(max=80))
    color = fields.Str(validate=_KEY)
    icon = fields.Str(validate=_KEY)


class DeleteSpaceQuerySchema(Schema):
    """Delete mode: move contents to General (default) or purge them."""

    mode = fields.Str(
        load_default="move", validate=validate.OneOf(["move", "purge"])
    )


@dataclass(frozen=True)
class ConvertSessionData:
    """Validated convert-chat-to-space payload."""

    session_id: str
    name: str = ""
    subject: str = ""
    color: str = "brand"
    icon: str = "book"


class ConvertSessionSchema(Schema):
    """Promote an existing chat into a new study space."""

    session_id = fields.Str(required=True)
    name = fields.Str(load_default="", validate=validate.Length(max=80))
    subject = fields.Str(load_default="", validate=validate.Length(max=80))
    color = fields.Str(load_default="brand", validate=_KEY)
    icon = fields.Str(load_default="book", validate=_KEY)

    @post_load
    def make_data(self, data: dict, **_kwargs: object) -> ConvertSessionData:
        """Convert to dataclass."""
        return ConvertSessionData(**data)
