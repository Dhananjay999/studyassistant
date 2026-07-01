"""Personalization: turn a user's learning profile into a prompt fragment.

Kept deliberately lightweight. The block is appended to a tool's system prompt
only when the user has *completed* onboarding. Language is treated as a strict,
high-priority instruction (a Hinglish learner who gets pure Devanagari Hindi is
a real bug); the rest of the profile colours answers without overriding what the
user actually asked for. The current request always wins if it explicitly asks
for a different language.
"""

from typing import Any

# (profile key, human label) in the order they read best in the prompt. Language
# leads because it is the highest-priority directive.
_FIELDS: list[tuple[str, str]] = [
    ("preferred_language", "Preferred Language"),
    ("education_level", "Education Level"),
    ("explanation_style", "Preferred Explanation Style"),
    ("learning_goal", "Learning Goal"),
]

_INSTRUCTION = """
Apply the learning profile only when answering.

Priority:
1. Follow the student's current request.
2. Otherwise follow the profile.
3. Use normal behavior for missing fields.

The profile changes HOW you answer, never WHAT you answer.

Language:
- English → English only.
- Hindi → Hindi (Devanagari).
- Hinglish → Roman-script Hindi-English mix.
Keep formulas, code, technical terms, and proper nouns unchanged.

Education:
Match vocabulary and depth to the student's level.

Style:
Follow the preferred explanation style.

Goals:
Use learning goals and favorite subjects only for examples and analogies.

Never mention the profile to the student.
"""


def build_personalization_block(profile: dict[str, Any] | None) -> str:
    """Build a system-prompt fragment from a profile, or '' when not set.

    Returns an empty string unless onboarding is completed and at least one
    field is filled, so unpersonalized turns behave exactly as before.
    """
    if not profile or profile.get("personalization_status") != "completed":
        return ""

    lines: list[str] = []
    for key, label in _FIELDS:
        value = profile.get(key)
        if isinstance(value, str) and value.strip():
            lines.append(f"- {label}: {value.strip()}")

    subjects = profile.get("favorite_subjects") or []
    if isinstance(subjects, list) and subjects:
        joined = ", ".join(str(s) for s in subjects if str(s).strip())
        if joined:
            lines.append(f"- Favorite Subjects: {joined}")

    if not lines:
        return ""

    return "User Learning Profile:\n" + "\n".join(lines) + "\n\n" + _INSTRUCTION


def personalize(base: str | None, block: str | None) -> str | None:
    """Append a personalization block to a base system prompt.

    Returns ``base`` unchanged when there is no block, so callers that pass an
    empty profile keep their existing behavior.
    """
    block = (block or "").strip()
    if not block:
        return base
    if not base:
        return block
    return f"{base}\n\n{block}"
