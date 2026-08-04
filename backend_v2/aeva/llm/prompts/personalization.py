"""Personalization: turn a user's learning profile into a prompt fragment.

Kept deliberately lightweight. The block reaches a template's system channel
through the ``{USER_PROFILE}`` placeholder (see ``blocks.user_profile_segment``)
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
    ("ai_personality", "Assistant Persona"),
    ("communication_style", "Communication Style"),
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

Persona:
Adopt the assistant persona's tone and teaching stance (e.g. Teacher =
structured and explanatory; Study Buddy = friendly and collaborative). It
shapes tone only, never accuracy.

Communication Style:
Shape answer length and structure to the preferred communication style
(e.g. Short & Direct = concise; Step-by-Step = numbered steps;
Example-Based = lead with examples).

Education:
Match vocabulary and depth to the student's level.

Style:
Follow the preferred explanation style.

Goals:
Use learning goals and favorite subjects only for examples and analogies.

Custom Instructions:
Treat the student's custom instructions as standing preferences and honor
them unless the current request explicitly overrides them.

Never mention the profile to the student.
"""


def build_space_block(space: dict[str, Any] | None) -> str:
    """System-prompt fragment for the active Study Space, or ''.

    Only real (non-default) spaces produce context — the invisible General
    space renders nothing, so users who never adopt Study Spaces get exactly
    the same prompts as before the feature existed.
    """
    if not space or space.get("is_default"):
        return ""
    name = str(space.get("name") or "").strip()
    if not name:
        return ""
    lines = [f"- Space: {name}"]
    subject = str(space.get("subject") or "").strip()
    if subject:
        lines.append(f"- Subject: {subject}")
    description = str(space.get("description") or "").strip()
    if description:
        lines.append(f"- About: {description}")

    # Memory digest (rolled up from quiz attempts — see QuizService): lets
    # Aeva acknowledge progress and lean into weak topics unprompted.
    memory = (space.get("settings") or {}).get("memory") or {}
    recent = memory.get("recent_quizzes") or []
    if recent:
        summary = ", ".join(
            f"{r.get('topic')} ({r.get('score')}%)" for r in recent[:3]
        )
        lines.append(f"- Recent quiz results: {summary}")
    weak = memory.get("weak_topics") or []
    if weak:
        lines.append(
            "- Topics the student is struggling with: " + ", ".join(weak)
        )

    return (
        "Active Study Space (the student's dedicated workspace for this "
        "subject):\n" + "\n".join(lines) + "\n"
        "Anchor answers in this subject's context when relevant; assume "
        "questions relate to it unless clearly stated otherwise. When weak "
        "topics are listed, offer extra clarity and encouragement there.\n\n"
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

    # Free-form instructions are rendered verbatim on their own line so the
    # student's exact wording reaches the model.
    instructions = profile.get("custom_instructions")
    if isinstance(instructions, str) and instructions.strip():
        lines.append(f'- Custom Instructions: "{instructions.strip()}"')

    if not lines:
        return ""

    return "User Learning Profile:\n" + "\n".join(lines) + "\n\n" + _INSTRUCTION
