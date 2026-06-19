"""Shared schema utilities."""

from dataclasses import dataclass
from typing import Any

from marshmallow import Schema, fields


@dataclass
class UserData:
    """Authenticated user payload."""

    id: str
    email: str
    full_name: str | None = None
    avatar_url: str | None = None


class ResponseEnvelopeSchema(Schema):
    """Standard API response envelope."""

    msg = fields.Str(required=True)
    data = fields.Raw(required=True)


def success_response(msg: str, data: Any) -> dict[str, Any]:
    """Build standard success envelope."""
    return {"msg": msg, "data": data}
