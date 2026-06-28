"""Quiz schemas."""

from dataclasses import dataclass

from marshmallow import Schema, fields, post_load


@dataclass
class QuizSubmitData:
    """Quiz submission payload."""

    answers: dict[str, list[str]]
    time_taken_seconds: int = 0


class QuizSubmitSchema(Schema):
    """Quiz submit request."""

    answers = fields.Dict(
        keys=fields.Str(),
        values=fields.List(fields.Str()),
        required=True,
    )
    time_taken_seconds = fields.Int(load_default=0)

    @post_load
    def make_data(self, data: dict, **_kwargs: object) -> QuizSubmitData:
        """Convert to dataclass."""
        return QuizSubmitData(**data)


@dataclass
class QuizAnalyzeData:
    """Quiz analysis request payload."""

    attempt_id: str


class QuizAnalyzeSchema(Schema):
    """Request an AI performance analysis for a finished attempt."""

    attempt_id = fields.Str(required=True)

    @post_load
    def make_data(self, data: dict, **_kwargs: object) -> QuizAnalyzeData:
        """Convert to dataclass."""
        return QuizAnalyzeData(**data)
