"""Bookmark schemas."""

from dataclasses import dataclass, field
from typing import Any

from marshmallow import Schema, fields, post_load, validate

ITEM_TYPES = ["response", "quiz", "media", "note"]


@dataclass
class CreateBookmarkData:
    """Create bookmark payload."""

    item_type: str
    title: str = ""
    content: str = ""
    item_ref: str | None = None
    collection_id: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


class CreateBookmarkSchema(Schema):
    """Create bookmark request."""

    item_type = fields.Str(
        required=True,
        validate=validate.OneOf(ITEM_TYPES),
    )
    title = fields.Str(load_default="")
    content = fields.Str(load_default="")
    item_ref = fields.Str(load_default=None, allow_none=True)
    collection_id = fields.Str(load_default=None, allow_none=True)
    metadata = fields.Dict(load_default=dict)

    @post_load
    def make_data(self, data: dict, **_kwargs: object) -> CreateBookmarkData:
        """Convert to dataclass."""
        return CreateBookmarkData(**data)


class UpdateBookmarkSchema(Schema):
    """Update bookmark request (move folder / rename)."""

    collection_id = fields.Str(required=False, allow_none=True)
    title = fields.Str(required=False)


@dataclass
class CollectionData:
    """Create/rename collection payload."""

    name: str


class CreateCollectionSchema(Schema):
    """Create collection request."""

    name = fields.Str(
        required=True,
        validate=validate.Length(min=1, max=80),
    )

    @post_load
    def make_data(self, data: dict, **_kwargs: object) -> CollectionData:
        """Convert to dataclass."""
        return CollectionData(**data)


class UpdateCollectionSchema(Schema):
    """Rename collection request."""

    name = fields.Str(
        required=True,
        validate=validate.Length(min=1, max=80),
    )

    @post_load
    def make_data(self, data: dict, **_kwargs: object) -> CollectionData:
        """Convert to dataclass."""
        return CollectionData(**data)
