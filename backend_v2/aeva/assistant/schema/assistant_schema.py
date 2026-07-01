"""Assistant schemas."""

from dataclasses import dataclass

from marshmallow import Schema, fields, post_load, validate

from aeva.orchestration.models import (
    ClarificationAction,
    FlashcardOptions,
    QuizOptions,
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
    quiz_options: QuizOptions | None = None
    flashcard_options: FlashcardOptions | None = None
    source_content: str | None = None


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


class QuizOptionsSchema(Schema):
    """Nested quiz settings from the setup popover."""

    topic = fields.Str(load_default=None)
    question_count = fields.Int(load_default=None)
    difficulty = fields.Str(
        load_default=None,
        validate=validate.OneOf(["easy", "medium", "hard"]),
    )
    question_types = fields.List(fields.Str(), load_default=None)
    use_media = fields.Bool(load_default=None)
    additional_instructions = fields.Str(load_default=None)


class FlashcardOptionsSchema(Schema):
    """Nested flashcard settings (forces flashcard generation)."""

    count = fields.Int(load_default=None)


class AssistantRequestSchema(Schema):
    """Assistant request."""

    session_id = fields.Str(required=True)
    message = fields.Str(required=True, validate=validate.Length(min=1))
    media_ids = fields.List(fields.Str(), load_default=None)
    run_id = fields.Str(load_default=None)
    clarification = fields.Nested(
        ClarificationResponseSchema, load_default=None
    )
    quiz_options = fields.Nested(QuizOptionsSchema, load_default=None)
    flashcard_options = fields.Nested(
        FlashcardOptionsSchema, load_default=None
    )
    source_content = fields.Str(load_default=None)

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
        opts = data.get("quiz_options")
        if opts and isinstance(opts, dict):
            data["quiz_options"] = QuizOptions(
                topic=opts.get("topic"),
                question_count=opts.get("question_count"),
                difficulty=opts.get("difficulty"),
                question_types=opts.get("question_types"),
                use_media=opts.get("use_media"),
                additional_instructions=opts.get("additional_instructions"),
            )
        fc = data.get("flashcard_options")
        if fc and isinstance(fc, dict):
            data["flashcard_options"] = FlashcardOptions(
                count=fc.get("count"),
            )
        return AssistantRequestData(**data)
