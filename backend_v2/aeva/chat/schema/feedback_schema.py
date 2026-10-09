"""Answer feedback schema (thumbs up / down on an assistant message)."""

from dataclasses import dataclass

from marshmallow import Schema, fields, post_load, validate

RATINGS = ["up", "down"]
REASON_MAX = 200


@dataclass
class MessageFeedbackData:
    """Feedback payload. ``rating`` ``None`` clears an earlier rating."""

    rating: str | None = None
    reason: str | None = None


class MessageFeedbackSchema(Schema):
    """``POST /chat/messages/<id>/feedback`` body."""

    rating = fields.Str(
        load_default=None,
        allow_none=True,
        validate=validate.OneOf(RATINGS),
    )
    # Short optional reason tag (never free text from the answer itself).
    reason = fields.Str(
        load_default=None,
        allow_none=True,
        validate=validate.Length(max=REASON_MAX),
    )

    @post_load
    def make_data(self, data: dict, **_kwargs: object) -> MessageFeedbackData:
        """Convert to dataclass."""
        return MessageFeedbackData(**data)
