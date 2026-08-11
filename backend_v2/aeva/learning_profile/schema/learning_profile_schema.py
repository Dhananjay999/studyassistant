"""Learning profile schemas.

Every field is optional: users may skip any onboarding step, so the profile is
patched incrementally. Free-text values are accepted (the UI offers an "Other"
choice and the option lists may grow over time), with length caps as the only
guard.
"""

from dataclasses import dataclass, field
from typing import Any

from marshmallow import Schema, ValidationError, fields, post_load, validate

# Generous caps: the UI offers curated choices but allows free-text "Other".
_TEXT = validate.Length(max=120)
_SUBJECTS = validate.Length(max=40)
# Custom instructions are free-form and can be a short paragraph.
_INSTRUCTIONS = validate.Length(max=1000)

# Whitelisted learning traits (privacy rule: learning-related keys only —
# never personal/sensitive inferences). Values are booleans or short strings.
LEARNING_TRAIT_KEYS = frozenset({
    "likes_funny_examples",
    "likes_visual_explanations",
    "preferred_depth",
    "wants_concept_check_questions",
    "curiosity_level",
})


_TRAIT_VALUE_MAX = 40


def _validate_traits(traits: dict[str, Any]) -> None:
    """Reject unknown trait keys and oversized values."""
    for key, value in traits.items():
        if key not in LEARNING_TRAIT_KEYS:
            raise ValidationError(f"Unknown learning trait: {key}")
        if not isinstance(value, bool | str) or (
            isinstance(value, str) and len(value) > _TRAIT_VALUE_MAX
        ):
            raise ValidationError(f"Invalid value for trait: {key}")


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
    exam_target: str | None = None
    learning_traits: dict[str, Any] = field(default_factory=dict)


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
    exam_target = fields.Str(
        allow_none=True, load_default=None, validate=_TEXT
    )
    learning_traits = fields.Dict(
        keys=fields.Str(),
        load_default=dict,
        validate=_validate_traits,
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
    exam_target = fields.Str(allow_none=True)
    learning_traits = fields.Dict(keys=fields.Str(), dump_default=dict)
    personalization_status = fields.Str(required=True)
    personalization_updated_at = fields.Str(allow_none=True)
