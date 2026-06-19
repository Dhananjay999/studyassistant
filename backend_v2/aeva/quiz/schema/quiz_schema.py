"""Quiz schemas."""

from dataclasses import dataclass, field
from typing import Any

from marshmallow import Schema, fields, post_load, validate


@dataclass
class QuizSubmitData:
    """Quiz submission payload."""

    answers: dict[str, list[str]]


class QuizSubmitSchema(Schema):
    """Quiz submit request."""

    answers = fields.Dict(
        keys=fields.Str(),
        values=fields.List(fields.Str()),
        required=True,
    )

    @post_load
    def make_data(self, data: dict, **_kwargs: object) -> QuizSubmitData:
        """Convert to dataclass."""
        return QuizSubmitData(**data)
