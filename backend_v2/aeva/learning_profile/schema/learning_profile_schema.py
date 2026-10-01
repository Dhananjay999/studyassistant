"""Learning profile schemas.

Every field is optional: users may skip any onboarding step. Free-text values
are accepted (the UI offers an "Other" choice and the option lists may grow
over time), with length caps and key whitelists as the only guard. The
request/response fields are the ``profiles.learning_profile`` document
fields (see ``profile_document``) plus the onboarding status on responses.
"""

from dataclasses import asdict, dataclass, field
from typing import Any

from marshmallow import Schema, ValidationError, fields, post_load, validate

from aeva.learning_profile.profile_document import CONTEXT_KEYS, TRAIT_KEYS

# Generous caps: the UI offers curated choices but allows free-text "Other".
_TEXT = validate.Length(max=120)
_FOCUS_ITEM = validate.Length(max=40)
_FOCUS_COUNT = validate.Length(max=20)
# Custom instructions are free-form and can be a short paragraph.
_INSTRUCTIONS = validate.Length(max=1000)

_TRAIT_VALUE_MAX = 40
_CONTEXT_TYPE_MAX = 40
_CONTEXT_VALUE_MAX = 120


def _validate_traits(traits: dict[str, Any]) -> None:
    """Reject unknown trait keys and oversized values."""
    for key, value in traits.items():
        if key not in TRAIT_KEYS:
            raise ValidationError(f"Unknown learning trait: {key}")
        if not isinstance(value, bool | str) or (
            isinstance(value, str) and len(value) > _TRAIT_VALUE_MAX
        ):
            raise ValidationError(f"Invalid value for trait: {key}")


def _validate_context(context: dict[str, Any]) -> None:
    """Reject unknown context keys and oversized or non-string values."""
    for key, value in context.items():
        if key not in CONTEXT_KEYS:
            raise ValidationError(f"Unknown learning context field: {key}")
        limit = _CONTEXT_TYPE_MAX if key == "type" else _CONTEXT_VALUE_MAX
        if not isinstance(value, str) or len(value) > limit:
            raise ValidationError(f"Invalid value for learning context: {key}")


@dataclass(frozen=True)
class LearningProfileData:
    """Validated learning-profile document from the client (full write)."""

    context: dict[str, Any] = field(default_factory=dict)
    goal: str | None = None
    focus_areas: list[str] = field(default_factory=list)
    explanation_style: str | None = None
    response_language: str | None = None
    ai_personality: str | None = None
    communication_style: str | None = None
    custom_instructions: str | None = None
    learning_traits: dict[str, Any] = field(default_factory=dict)

    def as_fields(self) -> dict[str, Any]:
        """Plain dict of the document fields."""
        return asdict(self)


class UpdateLearningProfileSchema(Schema):
    """Save-learning-profile request (all fields optional).

    The endpoint writes the whole document, so an omitted field is cleared.
    """

    # ``context`` on the wire; renamed here because ``Schema.context`` is
    # marshmallow's own attribute.
    learning_context = fields.Dict(
        keys=fields.Str(),
        load_default=dict,
        validate=_validate_context,
        data_key="context",
        attribute="context",
    )
    goal = fields.Str(allow_none=True, load_default=None, validate=_TEXT)
    focus_areas = fields.List(
        fields.Str(validate=_FOCUS_ITEM),
        load_default=list,
        validate=_FOCUS_COUNT,
    )
    explanation_style = fields.Str(
        allow_none=True, load_default=None, validate=_TEXT
    )
    response_language = fields.Str(
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

    learning_context = fields.Dict(
        keys=fields.Str(),
        dump_default=dict,
        data_key="context",
        attribute="context",
    )
    goal = fields.Str(allow_none=True)
    focus_areas = fields.List(fields.Str(), dump_default=list)
    explanation_style = fields.Str(allow_none=True)
    response_language = fields.Str(allow_none=True)
    ai_personality = fields.Str(allow_none=True)
    communication_style = fields.Str(allow_none=True)
    custom_instructions = fields.Str(allow_none=True)
    learning_traits = fields.Dict(keys=fields.Str(), dump_default=dict)
    personalization_status = fields.Str(required=True)
    personalization_updated_at = fields.Str(allow_none=True)
