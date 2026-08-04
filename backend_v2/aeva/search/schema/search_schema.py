"""Search schemas."""

from marshmallow import Schema, fields


class SearchQuerySchema(Schema):
    """Global search query string (optionally scoped to a Study Space)."""

    q = fields.Str(load_default="")
    space_id = fields.Str(load_default=None, allow_none=True)
