"""Flashcard schemas."""

from dataclasses import dataclass

from marshmallow import Schema, fields, post_load, validate

RATINGS = ["easy", "medium", "hard", "needs_revision"]


@dataclass
class StudyData:
    """Record-study payload."""

    flashcard_id: str
    rating: str


class StudySchema(Schema):
    """Record a study rating for one card."""

    flashcard_id = fields.Str(required=True)
    rating = fields.Str(required=True, validate=validate.OneOf(RATINGS))

    @post_load
    def make_data(self, data: dict, **_kwargs: object) -> StudyData:
        """Convert to dataclass."""
        return StudyData(**data)
