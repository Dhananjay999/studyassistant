"""Auth schemas."""

from dataclasses import dataclass

from marshmallow import Schema, fields, post_load


@dataclass
class ProfileData:
    """User profile data."""

    id: str
    email: str
    full_name: str | None = None
    avatar_url: str | None = None
    created_at: str | None = None


class ProfileResponseSchema(Schema):
    """Profile response schema."""

    id = fields.Str(required=True)
    email = fields.Str(required=True)
    full_name = fields.Str(allow_none=True)
    avatar_url = fields.Str(allow_none=True)
    created_at = fields.Str(allow_none=True)
    # Developer Mode: admin-managed flag that unlocks debug diagnostics in the
    # client. The frontend renders debug UI only when this is true.
    is_debug_user = fields.Bool(dump_default=False)
    # Plan (migration 040, aeva/plan): the tier, its lifecycle, when Pro was
    # first activated and whether the Pro introduction popup was shown.
    plan = fields.Str(dump_default="free")
    plan_status = fields.Str(dump_default="none")
    pro_activated_at = fields.Str(allow_none=True)
    pro_prompt_shown = fields.Bool(dump_default=False)
    currency = fields.Str(allow_none=True)


class UpsertProfileSchema(Schema):
    """Upsert profile request."""

    full_name = fields.Str(allow_none=True)
    avatar_url = fields.Str(allow_none=True)

    @post_load
    def make_data(self, data: dict, **_kwargs: object) -> dict:
        """Return validated dict."""
        return data
