"""Request schemas for creating quizzes / flashcards outside of Chat."""

from dataclasses import dataclass, field
from typing import Any

from marshmallow import (
    Schema,
    ValidationError,
    fields,
    post_load,
    validate,
    validates_schema,
)

from aeva.assistant.schema.assistant_schema import QuizOptionsSchema

SOURCE_TOPIC = "topic"
SOURCE_FILES = "files"
SOURCE_NOTE = "note"
SOURCES = [SOURCE_TOPIC, SOURCE_FILES, SOURCE_NOTE]


@dataclass
class GenerationSource:
    """What the content is generated from (a topic, files, or a note).

    ``topic`` is required for a topic source and an optional focus for the
    others ("only chapter 3").
    """

    source: str
    topic: str | None = None
    media_ids: list[str] = field(default_factory=list)
    note_id: str | None = None
    space_id: str | None = None


@dataclass
class QuizGenerateData(GenerationSource):
    """Create-quiz payload (source + the Chat quiz-setup options)."""

    question_count: int | None = None
    difficulty: str | None = None
    target_exam: str | None = None
    question_types: list[str] | None = None
    additional_instructions: str | None = None
    exam_config: dict[str, Any] | None = None


@dataclass
class FlashcardGenerateData(GenerationSource):
    """Create-flashcards payload."""

    count: int | None = None
    additional_instructions: str | None = None


class _SourceFields(Schema):
    """Fields + validation shared by both create endpoints."""

    source = fields.Str(required=True, validate=validate.OneOf(SOURCES))
    topic = fields.Str(load_default=None, allow_none=True)
    media_ids = fields.List(fields.Str(), load_default=list)
    note_id = fields.Str(load_default=None, allow_none=True)
    space_id = fields.Str(load_default=None, allow_none=True)

    @validates_schema
    def validate_source(self, data: dict, **_kwargs: object) -> None:
        """Each source needs its own input."""
        source = data.get("source")
        if source == SOURCE_TOPIC and not (data.get("topic") or "").strip():
            raise ValidationError("Enter a topic.", field_name="topic")
        if source == SOURCE_FILES and not data.get("media_ids"):
            raise ValidationError(
                "Choose at least one file.", field_name="media_ids"
            )
        if source == SOURCE_NOTE and not data.get("note_id"):
            raise ValidationError("Choose a note.", field_name="note_id")


class QuizGenerateSchema(QuizOptionsSchema, _SourceFields):
    """Create a quiz from the Quizzes page.

    Reuses the Chat quiz-setup fields (incl. the 1-10 difficulty slider
    normalization); ``use_media`` is derived from ``source`` instead.
    """

    class Meta:
        """Drop the Chat-only ``use_media`` flag."""

        exclude = ("use_media",)

    @post_load
    def make_data(self, data: dict, **_kwargs: object) -> QuizGenerateData:
        """Convert to dataclass."""
        return QuizGenerateData(**data)


class FlashcardGenerateSchema(_SourceFields):
    """Create a flashcard set from the Flashcards page."""

    count = fields.Int(
        load_default=None, validate=validate.Range(min=1, max=50)
    )
    additional_instructions = fields.Str(
        load_default=None,
        allow_none=True,
        validate=validate.Length(max=1000),
    )

    @post_load
    def make_data(
        self, data: dict, **_kwargs: object
    ) -> FlashcardGenerateData:
        """Convert to dataclass."""
        return FlashcardGenerateData(**data)
