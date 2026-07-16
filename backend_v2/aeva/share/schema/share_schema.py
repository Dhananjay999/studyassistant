"""Share schemas."""

from dataclasses import dataclass

from marshmallow import Schema, ValidationError, fields, post_load, validates

from aeva.share.resolvers import supported_content_types
from aeva.share.share_service import VISIBILITIES


@dataclass
class ShareCreateData:
    """Create-share payload."""

    content_type: str
    content_id: str
    visibility: str = "unlisted"


@dataclass
class ShareUpdateData:
    """Update-share payload (visibility / expiry)."""

    visibility: str | None = None
    expires_at: str | None = None


class ShareCreateSchema(Schema):
    """POST /shares/ body."""

    content_type = fields.Str(required=True)
    content_id = fields.Str(required=True)
    visibility = fields.Str(load_default="unlisted")

    @validates("content_type")
    def _known_type(self, value: str, data_key: str | None = None) -> None:
        # Validated dynamically so registering a resolver is all a new
        # shareable feature needs — no schema change.
        if value not in supported_content_types():
            raise ValidationError(
                f"Must be one of: {', '.join(supported_content_types())}."
            )

    @validates("visibility")
    def _known_visibility(self, value: str, data_key: str | None = None) -> None:
        if value not in VISIBILITIES:
            raise ValidationError(
                f"Must be one of: {', '.join(VISIBILITIES)}."
            )

    @post_load
    def make_data(self, data: dict, **_kwargs: object) -> ShareCreateData:
        """Convert to dataclass."""
        return ShareCreateData(**data)


class ShareUpdateSchema(Schema):
    """PATCH /shares/<share_id> body."""

    visibility = fields.Str(load_default=None)
    expires_at = fields.Str(load_default=None, allow_none=True)

    @validates("visibility")
    def _known_visibility(self, value: str | None, data_key: str | None = None) -> None:
        if value is not None and value not in VISIBILITIES:
            raise ValidationError(
                f"Must be one of: {', '.join(VISIBILITIES)}."
            )

    @post_load
    def make_data(self, data: dict, **_kwargs: object) -> ShareUpdateData:
        """Convert to dataclass."""
        return ShareUpdateData(**data)
