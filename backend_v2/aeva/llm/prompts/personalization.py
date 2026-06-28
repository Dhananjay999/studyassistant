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

_INSTRUCTION = (
    "Follow this learning profile when responding.\n"
    "LANGUAGE is a strict, high-priority instruction: write your ENTIRE "
    "response in the Preferred Language above, unless the user's current "
    "message explicitly asks for a different language (the current request "
    "always wins). Interpret the value precisely:\n"
    '- "English" -> respond entirely in English.\n'
    '- "Hindi" -> respond entirely in natural Hindi using the Devanagari '
    "script.\n"
    '- "Hinglish" -> respond in a natural conversational mix of Hindi and '
    'English written in the LATIN/Roman script (for example: "Chaliye DBMS '
    'ko simple way mein samajhte hain..."). Do NOT use the Devanagari script '
    "for Hinglish, and do NOT reply in pure Hindi or pure English.\n"
    "Also match the education level and explanation style, and keep technical "
    "terms, formulas, and code in their standard form regardless of language. "
    "Do not mention this profile to the user."
)


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
