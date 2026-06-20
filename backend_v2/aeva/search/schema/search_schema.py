"""Search schemas."""

from marshmallow import Schema, fields


class SearchQuerySchema(Schema):
    """Global search query string."""

    q = fields.Str(load_default="")
