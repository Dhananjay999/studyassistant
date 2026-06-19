"""Assistant schemas."""

from dataclasses import dataclass, field
from typing import Any

from marshmallow import Schema, fields, post_load, validate

from aeva.orchestration.models import (
    ClarificationAction,
    UserClarificationResponse,
)


@dataclass
class AssistantRequestData:
    """Assistant request payload."""

    session_id: str
    message: str
    media_ids: list[str] | None = None
    run_id: str | None = None
    clarification: UserClarificationResponse | None = None


class ClarificationResponseSchema(Schema):
    """Nested clarification response."""

    action = fields.Str(
        required=True,
        validate=validate.OneOf([a.value for a in ClarificationAction]),
    )
    answers = fields.Dict(
        keys=fields.Str(),
        values=fields.Str(),
        load_default=dict,
    )
    custom_text = fields.Str(load_default=None)


class AssistantRequestSchema(Schema):
    """Assistant request."""

    session_id = fields.Str(required=True)
    message = fields.Str(required=True, validate=validate.Length(min=1))
    media_ids = fields.List(fields.Str(), load_default=None)
    run_id = fields.Str(load_default=None)
    clarification = fields.Nested(
        ClarificationResponseSchema, load_default=None
    )

    @post_load
    def make_data(self, data: dict, **_kwargs: object) -> AssistantRequestData:
        """Convert to dataclass."""
        clar = data.get("clarification")
        if clar and isinstance(clar, dict):
            data["clarification"] = UserClarificationResponse(
                action=ClarificationAction(clar["action"]),
                answers=clar.get("answers") or {},
                custom_text=clar.get("custom_text"),
            )
        return AssistantRequestData(**data)
