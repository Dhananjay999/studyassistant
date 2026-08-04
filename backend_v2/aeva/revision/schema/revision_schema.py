"""Revision schemas."""

from dataclasses import dataclass

from marshmallow import Schema, fields, post_load, validate

from aeva.revision.revision_engine import CONFIDENCE_LEVELS

CONFIDENCE_SOURCES = ["quiz", "flashcards", "manual"]


@dataclass
class ConfidenceData:
    """Post-session confidence payload."""

    topic: str
    confidence: str
    source: str = "manual"
    ref_id: str | None = None
    space_id: str | None = None


class ConfidenceSchema(Schema):
    """Record how confident the student feels about a topic."""

    topic = fields.Str(required=True, validate=validate.Length(min=1))
    confidence = fields.Str(
        required=True, validate=validate.OneOf(CONFIDENCE_LEVELS)
    )
    source = fields.Str(
        load_default="manual", validate=validate.OneOf(CONFIDENCE_SOURCES)
    )
    ref_id = fields.Str(load_default=None, allow_none=True)
    space_id = fields.Str(load_default=None, allow_none=True)

    @post_load
    def make_data(self, data: dict, **_kwargs: object) -> ConfidenceData:
        """Convert to dataclass."""
        return ConfidenceData(**data)


@dataclass
class RevisionQueryData:
    """Query args shared by the revision GET endpoints."""

    tz_offset_minutes: int = 0


class RevisionQuerySchema(Schema):
    """Client timezone offset so "today" matches the student's calendar."""

    tz_offset_minutes = fields.Int(
        load_default=0,
        validate=validate.Range(min=-840, max=840),
    )

    @post_load
    def make_data(self, data: dict, **_kwargs: object) -> RevisionQueryData:
        """Convert to dataclass."""
        return RevisionQueryData(**data)
