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

from aeva.learning_profile import profile_document

# (document key, human label), rendered before / after the learning context
# in the order they read best. Language leads because it is the
# highest-priority directive.
_LEAD_FIELDS: list[tuple[str, str]] = [
    ("response_language", "Response Language"),
    ("ai_personality", "Assistant Persona"),
    ("communication_style", "Communication Style"),
]
_TAIL_FIELDS: list[tuple[str, str]] = [
    ("explanation_style", "Preferred Explanation Style"),
    ("goal", "Learning Goal"),
]

# Learning context -> prompt lines. ``type`` is a context id; the remaining
# keys hold display labels. Unknown types render as-is so a new learner type
# needs no change here.
_CONTEXT_TYPE_LABELS: dict[str, str] = {
    "school": "School",
    "college": "College / University",
    "competitive_exam": "Competitive Exam Preparation",
    "skill_learning": "Learning a Skill",
    "working_professional": "Working Professional",
}
_CONTEXT_FIELDS: list[tuple[str, str]] = [
    ("class", "Class"),
    ("board", "Board"),
    ("degree", "Program"),
    ("year", "Year"),
    ("exam", "Exam"),
    ("skill", "Learning"),
]

# learning_traits key -> short prompt line. Whitelist mirrors
# ``profile_document.TRAIT_KEYS``; unknown keys are ignored.
_TRAIT_LINES: dict[str, str] = {
    "likes_funny_examples": "Enjoys funny examples and analogies",
    "likes_visual_explanations": "Prefers visual explanations and diagrams",
    "wants_concept_check_questions": (
        "Wants a concept-check question after explanations"
    ),
}
_TRAIT_VALUE_LINES: dict[str, str] = {
    "preferred_depth": "Preferred Depth",
    "curiosity_level": "Curiosity Level",
}

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
- Any other language → reply in that language.
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
Match vocabulary, depth, and syllabus to the student's level and learning
context (class and board, program and year, exam, or skill being learned).

Style:
Follow the preferred explanation style.

Goals:
Use the learning goal and focus areas for examples and analogies, and lean
toward the focus areas when a question is ambiguous.

Custom Instructions:
Treat the student's custom instructions as standing preferences and honor
them unless the current request explicitly overrides them.

Never mention the profile to the student.
"""


def build_identity_block(profile: dict[str, Any] | None) -> str:
    """System-prompt fragment naming the student, or '' when unknown.

    Built from the account's ``full_name`` (Google sign-in), so it works even
    for users who skipped onboarding. Fixes the "what is my name?" failure in a
    fresh session, where the introduction lives outside the history window.
    """
    name = str((profile or {}).get("full_name") or "").strip()
    if not name:
        return ""
    return (
        f"Student's name: {name}. Use it naturally and sparingly (greetings, "
        "encouragement); if they ask their name, answer from this. If they "
        "introduce themselves with a different name in the conversation, "
        "prefer that one.\n\n"
    )


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


def _context_lines(context: dict[str, str]) -> list[str]:
    """Prompt lines for the learning context ([] when absent)."""
    lines: list[str] = []
    kind = context.get("type", "")
    if context.get("other"):
        lines.append(f"- Learning Context: {context['other']}")
    elif kind and kind != "other":
        label = _CONTEXT_TYPE_LABELS.get(kind, kind)
        lines.append(f"- Learning Context: {label}")
    lines.extend(
        f"- {label}: {context[key]}"
        for key, label in _CONTEXT_FIELDS
        if context.get(key)
    )
    return lines


def _trait_lines(traits: dict[str, Any]) -> list[str]:
    """Prompt lines for the switched-on / valued learning traits."""
    lines = [
        f"- {line}"
        for key, line in _TRAIT_LINES.items()
        if traits.get(key) is True
    ]
    for key, label in _TRAIT_VALUE_LINES.items():
        value = traits.get(key)
        if isinstance(value, str) and value.strip():
            lines.append(f"- {label}: {value.strip()}")
    return lines


def _field_lines(
    doc: dict[str, Any], fields: list[tuple[str, str]]
) -> list[str]:
    """``- Label: value`` for each filled field."""
    return [f"- {label}: {doc[key]}" for key, label in fields if doc[key]]


def _document_lines(doc: dict[str, Any]) -> list[str]:
    """Every filled document field as a prompt line, in prompt order."""
    lines = _field_lines(doc, _LEAD_FIELDS)
    lines += _context_lines(doc["context"])
    lines += _field_lines(doc, _TAIL_FIELDS)
    if doc["focus_areas"]:
        lines.append(f"- Focus Areas: {', '.join(doc['focus_areas'])}")
    lines += _trait_lines(doc["learning_traits"])
    # Free-form instructions are rendered verbatim on their own line so the
    # student's exact wording reaches the model.
    if doc["custom_instructions"]:
        lines.append(f'- Custom Instructions: "{doc["custom_instructions"]}"')
    return lines


def build_personalization_block(profile: dict[str, Any] | None) -> str:
    """Build a system-prompt fragment from a profile row, or '' when not set.

    Returns an empty string unless onboarding is completed and at least one
    field is filled — EXCEPT ``response_language``, which applies as soon as
    it is set (a saved "talk in Hinglish" must survive skipped onboarding and
    new sessions; a Hinglish learner silently reset to English is a real bug).
    """
    if not profile:
        return ""
    doc = profile_document.read(profile)
    if profile.get("personalization_status") != "completed":
        language = doc["response_language"]
        if not language:
            return ""
        return (
            f"User Learning Profile:\n- Response Language: {language}\n\n"
            + _INSTRUCTION
        )

    lines = _document_lines(doc)
    if not lines:
        return ""
    return "User Learning Profile:\n" + "\n".join(lines) + "\n\n" + _INSTRUCTION
