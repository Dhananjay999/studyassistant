"""AI Notes request schemas."""

from dataclasses import dataclass

from marshmallow import Schema, fields, post_load, validate

_SOURCE_TYPES = ["manual", "response", "media", "quiz"]


@dataclass(frozen=True)
class CreateNoteData:
    """Validated create-note payload."""

    title: str = "Untitled note"
    content_md: str = ""
    source_type: str = "manual"
    source_ref: str | None = None
    space_id: str | None = None
    # When saving from a chat, the session locates the Study Space so the
    # note lands next to the conversation it came from.
    session_id: str | None = None


class CreateNoteSchema(Schema):
    """Create a note."""

    title = fields.Str(
        load_default="Untitled note", validate=validate.Length(max=200)
    )
    content_md = fields.Str(load_default="")
    source_type = fields.Str(
        load_default="manual", validate=validate.OneOf(_SOURCE_TYPES)
    )
    source_ref = fields.Str(load_default=None, allow_none=True)
    space_id = fields.Str(load_default=None, allow_none=True)
    session_id = fields.Str(load_default=None, allow_none=True)

    @post_load
    def make_data(self, data: dict, **_kwargs: object) -> CreateNoteData:
        """Convert to dataclass."""
        return CreateNoteData(**data)


class UpdateNoteSchema(Schema):
    """Patch note fields (all optional)."""

    title = fields.Str(validate=validate.Length(min=1, max=200))
    content_md = fields.Str()
    space_id = fields.Str(allow_none=True)
