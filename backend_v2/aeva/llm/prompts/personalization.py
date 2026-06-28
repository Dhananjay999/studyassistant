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
    "Apply this learning profile when you answer, in this STRICT priority "
    "order:\n"
    "1. The student's CURRENT message always wins. If it explicitly asks "
    "for a different language, length, or depth, follow the message and "
    "ignore the conflicting profile field for this turn.\n"
    "2. Otherwise, let the profile shape the answer.\n"
    "3. Fall back to your normal defaults for anything the profile does not "
    "set. Personalization adapts HOW you answer; it never changes WHAT the "
    "student asked about.\n"
    "\n"
    "LANGUAGE (highest-priority profile field). Write the ENTIRE answer in "
    "the Preferred Language above. Interpret the value precisely:\n"
    '- "English" -> respond entirely in English.\n'
    '- "Hindi" -> respond entirely in natural Hindi in the Devanagari '
    "script.\n"
    '- "Hinglish" -> respond in a natural Hindi-English mix written in the '
    'LATIN/Roman script (for example: "Chaliye DBMS ko simple tarike se '
    'samajhte hain..."). Do NOT use the Devanagari script, and do NOT reply '
    "in pure Hindi or pure English.\n"
    "Regardless of language, keep technical terms, proper nouns, formulas, "
    "and code in their standard form (do not translate SQL keywords, "
    "'mitochondria', or x = v*t).\n"
    "\n"
    "EDUCATION LEVEL. Match vocabulary and depth to the level. For school "
    "levels (e.g. Class 10) avoid college-level terminology and keep "
    "examples concrete; for college / B.Tech levels go deeper and use "
    "precise technical language.\n"
    "EXPLANATION STYLE. Honour the preferred style: 'Step-by-Step' -> "
    "numbered steps; 'Examples-first' -> lead with a concrete example; "
    "'Concise' -> tight bullets; 'Detailed' -> fuller prose.\n"
    "LEARNING GOAL and FAVORITE SUBJECTS. Use them only to pick relatable "
    "examples and analogies, not to switch the topic the student asked "
    "about.\n"
    "\n"
    "Never mention this profile to the student, and never let it override "
    "what they explicitly asked for in the current message."
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
