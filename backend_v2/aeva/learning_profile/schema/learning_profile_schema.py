"""Learning profile schemas.

Every field is optional: users may skip any onboarding step, so the profile is
patched incrementally. Free-text values are accepted (the UI offers an "Other"
choice and the option lists may grow over time), with length caps as the only
guard.
"""

from dataclasses import dataclass, field

from marshmallow import Schema, fields, post_load, validate

# Generous caps: the UI offers curated choices but allows free-text "Other".
_TEXT = validate.Length(max=120)
_SUBJECTS = validate.Length(max=40)
# Custom instructions are free-form and can be a short paragraph.
_INSTRUCTIONS = validate.Length(max=1000)


@dataclass(frozen=True)
class LearningProfileData:
    """Validated learning-profile patch from the client."""

    education_level: str | None = None
    preferred_language: str | None = None
    explanation_style: str | None = None
    favorite_subjects: list[str] = field(default_factory=list)
    learning_goal: str | None = None
    ai_personality: str | None = None
    communication_style: str | None = None
    custom_instructions: str | None = None


class UpdateLearningProfileSchema(Schema):
    """Upsert learning-profile request (all fields optional)."""

    education_level = fields.Str(
        allow_none=True, load_default=None, validate=_TEXT
    )
    preferred_language = fields.Str(
        allow_none=True, load_default=None, validate=_TEXT
    )
    explanation_style = fields.Str(
        allow_none=True, load_default=None, validate=_TEXT
    )
    favorite_subjects = fields.List(
        fields.Str(validate=_SUBJECTS), load_default=list
    )
    learning_goal = fields.Str(
        allow_none=True, load_default=None, validate=_TEXT
    )
    ai_personality = fields.Str(
        allow_none=True, load_default=None, validate=_TEXT
    )
    communication_style = fields.Str(
        allow_none=True, load_default=None, validate=_TEXT
    )
    custom_instructions = fields.Str(
        allow_none=True, load_default=None, validate=_INSTRUCTIONS
    )

    @post_load
    def make_data(
        self, data: dict, **_kwargs: object
    ) -> LearningProfileData:
        """Convert to dataclass."""
        return LearningProfileData(**data)


class LearningProfileSchema(Schema):
    """Learning-profile response item."""

    education_level = fields.Str(allow_none=True)
    preferred_language = fields.Str(allow_none=True)
    explanation_style = fields.Str(allow_none=True)
    favorite_subjects = fields.List(fields.Str(), dump_default=list)
    learning_goal = fields.Str(allow_none=True)
    ai_personality = fields.Str(allow_none=True)
    communication_style = fields.Str(allow_none=True)
    custom_instructions = fields.Str(allow_none=True)
    personalization_status = fields.Str(required=True)
    personalization_updated_at = fields.Str(allow_none=True)
