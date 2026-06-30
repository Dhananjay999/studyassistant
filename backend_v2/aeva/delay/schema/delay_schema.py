"""Delay schemas."""

from marshmallow import Schema, fields, validate

# Cap the delay so a single request can never tie up a worker forever.
MAX_DELAY_SECONDS = 6000


class DelayQuerySchema(Schema):
    """Number of seconds to wait before responding."""

    seconds = fields.Float(
        load_default=1.0,
        validate=validate.Range(min=0, max=MAX_DELAY_SECONDS),
    )
