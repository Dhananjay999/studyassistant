"""The learning-profile document stored in ``profiles.learning_profile``.

One JSONB document holds every learning-profile field (see migration 025):
the onboarding answers (``context``, ``goal``, ``focus_areas``,
``explanation_style``, ``response_language``) and the Settings-only extras
(``ai_personality``, ``communication_style``, ``custom_instructions``,
``learning_traits``). Onboarding state (``personalization_status``) stays a
column on the profile row.

Everything that reads or writes the profile goes through this module, so the
stored shape is defined in exactly one place. Pure: no Flask / DB imports.
"""

from collections.abc import Mapping
from typing import Any

COLUMN = "learning_profile"
VERSION = 2

# context.type ids (display labels live in the prompt builder / frontend).
# Unknown types are accepted so a new learner type needs no backend change.
CONTEXT_KEYS = (
    "type",
    "class",
    "board",
    "degree",
    "year",
    "exam",
    "skill",
    "other",
)

TEXT_FIELDS = (
    "goal",
    "explanation_style",
    "response_language",
    "ai_personality",
    "communication_style",
    "custom_instructions",
)

# Whitelisted learning traits (privacy rule: learning-related keys only —
# never personal/sensitive inferences). Values are booleans or short strings.
TRAIT_KEYS = frozenset({
    "likes_funny_examples",
    "likes_visual_explanations",
    "preferred_depth",
    "wants_concept_check_questions",
    "curiosity_level",
})


def _text(value: Any) -> str | None:
    return value.strip() or None if isinstance(value, str) else None


def read(row: Mapping[str, Any] | None) -> dict[str, Any]:
    """Return the normalized document of a profile row.

    Always returns every field (empty defaults), tolerating a missing column,
    junk values or unknown keys, so callers never need to type-check.
    """
    raw = (row or {}).get(COLUMN)
    doc: Mapping[str, Any] = raw if isinstance(raw, Mapping) else {}
    context = doc.get("context")
    focus = doc.get("focus_areas")
    traits = doc.get("learning_traits")
    return {
        "context": {
            key: value
            for key in CONTEXT_KEYS
            if (value := _text((context or {}).get(key)))
        }
        if isinstance(context, Mapping)
        else {},
        **{key: _text(doc.get(key)) for key in TEXT_FIELDS},
        "focus_areas": [
            text for item in focus if (text := _text(item))
        ]
        if isinstance(focus, list)
        else [],
        "learning_traits": {
            key: value
            for key, value in traits.items()
            if key in TRAIT_KEYS and isinstance(value, bool | str)
        }
        if isinstance(traits, Mapping)
        else {},
    }


def build(fields: Mapping[str, Any]) -> dict[str, Any]:
    """Document to store from (validated) fields; empty fields are omitted.

    Returns ``{}`` when nothing is set, matching the column default.
    """
    normalized = read({COLUMN: dict(fields)})
    doc = {
        key: value for key, value in normalized.items() if value
    }
    return {**doc, "version": VERSION} if doc else {}


def with_fields(
    row: Mapping[str, Any] | None, **changes: Any
) -> dict[str, Any]:
    """Return the row's document with some fields replaced."""
    return build({**read(row), **changes})
