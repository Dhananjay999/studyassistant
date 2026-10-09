"""Deterministic routing for "make me a revision sheet" requests.

Students ask for revision notes, formula sheets and important questions and
used to get a chat bubble they could not keep. A message that plainly asks
for one of those is routed to the ``notes_generator`` tool, which writes the
note AND saves it to the Notes page. The decision is made here with regular
expressions (no LLM call), on the student's own words only: never on a
card's ``source_content``, which can contain any of these phrases.

The match is conservative. It backs off when the message
* asks for a quiz or flashcards (those generators own the turn),
* points at notes the student already has ("summarize my notes on..."),
* asks how the app works ("how do I make notes?"),
* asks to solve / answer / check questions rather than list them,
* is long enough to be pasted material.
"""

import re
from typing import Any

from aeva.feature_flag import feature_flag_service

TOOL = "notes_generator"
FEATURE_FLAG = "notes"

KIND_REVISION = "revision_sheet"
KIND_FORMULA = "formula_sheet"
KIND_QUESTIONS = "important_questions"
KIND_NOTES = "notes"
KINDS = (KIND_REVISION, KIND_FORMULA, KIND_QUESTIONS, KIND_NOTES)

# Longer messages are pasted material or a detailed brief for the tutor.
MAX_WORDS = 40
# "give me notes": a create verb plus "notes" is enough in a short message;
# a longer one must also say what the notes are about ("notes on ...").
_SHORT_REQUEST_WORDS = 12

# Another generator, or a different job, owns the message.
_OTHER_GENERATOR_RE = re.compile(
    r"\b(?:quiz|flash\s*cards?|practice test|test me|mcqs?)\b"
)
_APP_HOWTO_RE = re.compile(
    r"\b(?:how (?:do|can|to|should) |where (?:are|is|can) |can i |"
    r"in (?:this|the) app|notes? (?:page|feature|section|tab))"
)
# Notes the student already has are the SOURCE of a request, not its target.
_EXISTING_NOTES_RE = re.compile(
    r"\b(?:my|these|those|this|uploaded|attached|your|our|class|"
    r"handwritten|teacher'?s?)\s+(?:\w+\s+)?notes?\b|"
    r"\b(?:summari[sz]e|explain|read|check|correct|translate)\b.{0,40}"
    r"\bnotes?\b"
)

_ASK = (
    r"(?:list|give|show|write|need|want|tell|send|make|share|provide|"
    r"batao|bata)"
)
_FORMULA_RE = re.compile(
    r"\bformulae?s?\s*(?:sheet|list|chart|booklet)s?\b|"
    r"\b(?:list|sheet)\s+(?:of\s+)?(?:all\s+)?(?:the\s+)?"
    r"(?:important\s+)?formula(?:s|e)?\b|"
    # "all the formulas" only as a request ("give me all the formulas"),
    # not as a question about them ("do all formulas apply here?").
    rf"(?:^\s*|\b{_ASK}\b.{{0,24}}?)\ball\s+(?:the\s+)?"
    r"(?:important\s+)?formula(?:s|e)?\b"
)
# A sheet is always something to produce, whatever it is produced from
# ("turn these notes into a one-page revision sheet").
_SHEET_RE = re.compile(
    r"\brevision\s+(?:sheet|guide)s?\b|\bcheat\s*sheets?\b|"
    r"\b(?:one|1|single)[- ]page(?:r)?\s+"
    r"(?:[\w-]+\s+)?(?:notes?|summary|revision|sheet)\b"
)
_NOTES_NOUN_RE = re.compile(
    r"\b(?:revision|summary|short|quick|crisp|exam)\s+notes?\b"
)
# "I want to take notes": the student writes them, Aeva does not.
_TAKING_NOTES_RE = re.compile(
    r"\b(?:tak(?:e|ing)|jot(?:ting)?|not(?:e|ing)\s+down)\b.{0,12}\bnotes?\b"
)
_QUESTIONS_RE = re.compile(
    r"\b(?:important|imp|most\s+expected|expected|probable|predicted|"
    r"repeated|likely|frequently\s+asked)\s+(?:\w+\s+)?"
    r"(?:questions?|ques|qs|qns?)\b"
)
# "solve these important questions": answering, not listing.
_WORK_ON_QUESTIONS_RE = re.compile(
    r"\b(?:solve|answer|check|grade|evaluate|correct|explain|mark)\b"
)

_CREATE = (
    r"(?:make|create|generate|write|prepare|build|give|need|want|get|send|"
    r"provide|banao|bana|chahiye)"
)
_NOTES_ABOUT_RE = re.compile(r"\bnotes?\s+(?:on|for|of|from|about)\b")
_CREATE_NOTES_RE = re.compile(rf"\b{_CREATE}\b(?:\s+\S+){{0,6}}?\s+notes?\b")
_NOTES_CREATE_AFTER_RE = re.compile(
    r"\bnotes?\b(?:\s+\S+){0,3}?\s+(?:banao|bana\s*do|chahiye|de\s*do|dedo)\b"
)
_LEADING_NOTES_RE = re.compile(r"^\s*notes?\s+(?:on|for|of|from|about)\b")


def detect(message: str) -> str | None:  # noqa: PLR0911
    """Return the kind of note a message asks for, or ``None``."""
    text = (message or "").strip().lower()
    if not text or len(text.split()) > MAX_WORDS:
        return None
    if _OTHER_GENERATOR_RE.search(text) or _APP_HOWTO_RE.search(text):
        return None
    if _FORMULA_RE.search(text):
        return KIND_FORMULA
    if _QUESTIONS_RE.search(text):
        return None if _WORK_ON_QUESTIONS_RE.search(text) else KIND_QUESTIONS
    if _SHEET_RE.search(text):
        return KIND_REVISION
    if _EXISTING_NOTES_RE.search(text) or _TAKING_NOTES_RE.search(text):
        return None
    if _NOTES_NOUN_RE.search(text):
        return KIND_REVISION
    if _LEADING_NOTES_RE.search(text) or _NOTES_CREATE_AFTER_RE.search(text):
        return KIND_NOTES
    if _CREATE_NOTES_RE.search(text) and (
        _NOTES_ABOUT_RE.search(text)
        or len(text.split()) <= _SHORT_REQUEST_WORDS
    ):
        return KIND_NOTES
    return None


def forced_params(ctx: Any) -> dict[str, Any] | None:
    """``notes_generator`` params when this turn must write a note, or None.

    Reads only ``ctx.message``. A card action carries its card as
    ``source_content``: the note is then built from that answer alone, never
    from the selected files. Clarification replies and the quiz / flashcard
    forms never match. The ``notes`` feature flag is read only after the
    words matched, so an ordinary turn pays nothing.
    """
    if (
        ctx.clarification is not None
        or ctx.quiz_options is not None
        or ctx.flashcard_options is not None
    ):
        return None
    kind = detect(ctx.message)
    if kind is None or not feature_flag_service.is_enabled(FEATURE_FLAG):
        return None
    from_answer = bool(ctx.source_content)
    return {
        "kind": kind,
        "topic": ctx.message,
        "from_answer": from_answer,
        "use_media": bool(ctx.media_ids) and not from_answer,
    }
