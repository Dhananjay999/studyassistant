# ruff: noqa: E501 — prompt text reads as one line per rule, like the other
# prompt modules.
r"""Notes contract: prompt template, per-kind rules, and tool params.

``NOTES_GENERATION_TEMPLATE`` below IS the prompt the model receives when
Aeva writes a note the student keeps: a revision sheet, a formula sheet,
important questions with model answers, or plain study notes. Study
material, when the note is built from uploads, travels as retrieved excerpts
in ``{SOURCE_CONTEXT}`` and, for files that cannot be retrieved from, as
provider binary attachments (``uses_attachments``).

The output is plain markdown, not JSON: a formula sheet is mostly LaTeX, and
backslashes inside a JSON string are exactly what models get wrong
(``\frac`` becomes a form feed). The first line is the title as a level-1
heading; ``split_title`` separates it from the body.
"""

import re

from aeva.llm.prompts.blocks import SYSTEM_PROMPT_BLOCK
from aeva.llm.prompts.builder import PromptTemplate

NOTES_GENERATION_TEMPLATE = PromptTemplate(
    name="notes_generation",
    system="{SYSTEM_PROMPT}{USER_PROFILE}",
    user="""{CONVERSATION_CONTEXT}
Write a study note as Aeva. The student will save it, revise from it and print it.

Note type: {NOTE_KIND}
Request: {REQUEST}
{SOURCE_CONTEXT}
Use the attached study material if provided. When SOURCE CONTEXT is present (content Aeva produced earlier, or excerpts from the student's files), build the note from it: never add facts absent from it, keep its terminology, numbers and definitions, and cover it broadly. Otherwise write the note from the request; if the topic is vague, infer it from the conversation.

How to write this note type:
{KIND_RULES}

Format:
- Output markdown only. No greeting, no closing line, no questions to the student.
- The FIRST line is the title as a level-1 heading ("# ..."): short, specific, no quotes.
- Then "## " sections with bullet points, numbered lists and small tables where they help. No walls of text.
- Write formulas in LaTeX ($...$ inline, $$...$$ on their own line) and keep code, technical terms and proper nouns unchanged.
- Keep it compact enough to print: about one to two pages unless the request asks for more.
- Write in the language the student is using.
""",
    defaults={"SYSTEM_PROMPT": SYSTEM_PROMPT_BLOCK},
    optional=("USER_PROFILE", "SOURCE_CONTEXT"),
    markers=("CONVERSATION_CONTEXT",),
    uses_history=True,
    uses_attachments=True,
)

# ``{NOTE_KIND}`` label and ``{KIND_RULES}`` per kind of note. The keys are
# the kinds ``aeva.orchestration.notes_intent`` detects.
NOTE_KIND_LABELS: dict[str, str] = {
    "revision_sheet": "Revision sheet",
    "formula_sheet": "Formula sheet",
    "important_questions": "Important questions with model answers",
    "notes": "Study notes",
}
NOTE_KIND_RULES: dict[str, str] = {
    "revision_sheet": (
        "- A last-minute revision sheet: only what must be remembered.\n"
        "- Sections for key definitions, core ideas, formulas or dates, and "
        "common mistakes.\n"
        '- One line per point; end with a short "Remember" list of the '
        "three to five facts most likely to be asked."
    ),
    "formula_sheet": (
        "- Every formula that belongs to the topic, grouped by sub-topic.\n"
        "- For each: the formula, what each symbol means with its unit, and "
        "when it applies.\n"
        "- Use a table (Formula | Symbols and units | Use it when) where it "
        "fits; add a one-line worked example only when the request asks for "
        "examples."
    ),
    "important_questions": (
        "- A numbered list of the questions most likely to be asked, most "
        "important first (about 10 unless the request gives a number).\n"
        "- Under each question, a short model answer (two to five lines, or "
        "the key steps for a numerical) the student could write in an exam.\n"
        "- Mix short-answer, long-answer and numerical or application "
        'questions as the subject needs; group them under "## " sections '
        "by chapter or unit when there is more than one.\n"
        "- These are likely questions, not a leaked paper: never claim a "
        "question will certainly appear."
    ),
    "notes": (
        "- Clear study notes covering the whole topic in a logical order.\n"
        "- Each section: the idea in plain words, the key points, and one "
        "short example where it helps understanding.\n"
        '- End with a "Quick recap" section of five to eight bullet points.'
    ),
}
DEFAULT_NOTE_KIND = "notes"

# MCP tool input schema. The planner never fills it in: the tool runs only
# from the deterministic notes route (``aeva.orchestration.notes_intent``).
NOTES_GENERATOR_PARAMS: dict = {
    "type": "object",
    "properties": {
        "topic": {
            "type": "string",
            "description": "What the note is about (the student's request).",
        },
        "kind": {
            "type": "string",
            "enum": list(NOTE_KIND_LABELS),
            "description": "Which kind of note to write.",
        },
        "use_media": {
            "type": "boolean",
            "description": "Build the note from the selected files.",
        },
        "from_answer": {
            "type": "boolean",
            "description": (
                "The request is a card action: build the note only from "
                "the answer it carries."
            ),
        },
    },
    "required": ["topic"],
}

_TITLE_RE = re.compile(r"^\s*#\s+(.+?)\s*#*\s*$")
_FENCE_RE = re.compile(r"^\s*```(?:markdown|md)?\s*\n(.*)\n\s*```\s*$", re.DOTALL)
_TITLE_MAX = 200


def split_title(markdown: str, fallback: str) -> tuple[str, str]:
    """Split a generated note into ``(title, body)``.

    The title is the leading level-1 heading; when the model left it out the
    ``fallback`` is used and the whole text is the body. A reply wrapped in a
    markdown code fence is unwrapped first.
    """
    text = (markdown or "").strip()
    fenced = _FENCE_RE.match(text)
    if fenced:
        text = fenced.group(1).strip()
    first, _, rest = text.partition("\n")
    match = _TITLE_RE.match(first)
    if match:
        title = match.group(1).strip().strip("*_\"'").strip()
        if title:
            return title[:_TITLE_MAX], rest.strip()
    return (fallback.strip() or "Untitled note")[:_TITLE_MAX], text
