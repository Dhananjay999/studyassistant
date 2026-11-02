"""Notes generation tool: write a revision sheet and save it to Notes.

Runs only from the deterministic notes route
(``aeva.orchestration.notes_intent``): the student asked for revision notes,
a formula sheet or important questions, in words or through the "Save as
revision sheet" / "Important questions" actions on an answer. The planner
never selects it.

The note is built from, in priority order: the answer the action was tapped
on (it travels in the message), the selected files (the same grounding the
quiz and flashcard generators use), or the topic and the conversation. It is
saved to ``notes`` so it can be reopened, edited, printed and exported, and
its full text is also the chat answer, so nothing is hidden behind a tap.
"""

import re
from collections.abc import Generator
from typing import Any

from aeva.common.errors import ERROR_CODES, CustomError
from aeva.llm import prompts
from aeva.llm.llm_client import LLMClient
from aeva.mcp.base import (
    ACTION_FLASHCARDS,
    ACTION_QUIZ,
    BaseTool,
    ToolContext,
    ToolDefinition,
)
from aeva.media.grounding import ground_generator
from aeva.media.retrieval import RetrievalService
from aeva.note.note_repository import NoteRepository
from aeva.supabase.supabase_service import SupabaseService

NAME = "notes_generator"
# Response category the client branches on to draw the note card.
RESPONSE_NOTE_CREATED = "NOTE_CREATED"

# Where the note's content came from (also the analytics ``source`` prop).
SOURCE_FILES = "files"
SOURCE_ANSWER = "answer"
SOURCE_TOPIC = "topic"
# ``notes.source_type`` per source (the column's CHECK allows these).
_SOURCE_TYPE = {
    SOURCE_FILES: "media",
    SOURCE_ANSWER: "response",
    SOURCE_TOPIC: "response",
}

_PREVIEW_CHARS = 240
# The first line of a note is held back until it is complete, so the chat
# shows the same "## Title" heading the saved note gets (not the model's
# raw "# Title" line). A first line longer than this is flushed as is.
_HEAD_MAX_CHARS = 200
_MARKUP_RE = re.compile(r"[#*_`>|]+|\$\$?")
_SPACE_RE = re.compile(r"\s+")
_PROGRESS = {
    "revision_sheet": "Writing your revision sheet…",
    "formula_sheet": "Collecting the formulas…",
    "important_questions": "Picking the important questions…",
    "notes": "Writing your notes…",
}


def preview_of(markdown: str) -> str:
    """Plain one-paragraph preview of a note body for the chat card."""
    plain = _SPACE_RE.sub(" ", _MARKUP_RE.sub(" ", markdown)).strip()
    if len(plain) <= _PREVIEW_CHARS:
        return plain
    return plain[:_PREVIEW_CHARS].rstrip() + "…"


class NotesGeneratorTool(BaseTool):
    """Write a study note (revision sheet, formulas, questions) and save it."""

    def __init__(
        self,
        llm: LLMClient | None = None,
        note_repo: NoteRepository | None = None,
        supabase: SupabaseService | None = None,
        retrieval: RetrievalService | None = None,
    ) -> None:
        self._llm = llm
        self._note_repo = note_repo
        self._supabase = supabase
        self._retrieval = retrieval

    @property
    def llm(self) -> LLMClient:
        """Lazy LLM client (the model that reads files and writes answers)."""
        return self._llm or LLMClient(config_key="LLM_MEDIA_MODEL")

    @property
    def supabase(self) -> SupabaseService:
        """Lazy Supabase client (for notes built from uploads)."""
        return self._supabase or SupabaseService()

    @property
    def note_repo(self) -> NoteRepository:
        """Lazy note repository."""
        return self._note_repo or NoteRepository(self._supabase)

    @property
    def retrieval(self) -> RetrievalService:
        """Lazy retrieval service (grounds the note in indexed uploads)."""
        if self._retrieval is None:
            self._retrieval = RetrievalService(supabase=self.supabase)
        return self._retrieval

    @property
    def definition(self) -> ToolDefinition:
        """Tool metadata."""
        return ToolDefinition(
            name=NAME,
            description=(
                "Write a study note the student keeps (revision sheet, "
                "formula sheet, important questions with model answers) "
                "from a topic, an answer or uploaded material, and save it "
                "to Notes."
            ),
            parameters_schema=prompts.NOTES_GENERATOR_PARAMS,
        )

    @property
    def response_type(self) -> str:
        """A saved note is its own response category."""
        return RESPONSE_NOTE_CREATED

    @property
    def available_actions(self) -> list[str]:
        """A fresh note is good material for a quiz or flashcards."""
        return [ACTION_QUIZ, ACTION_FLASHCARDS]

    @staticmethod
    def _head_text(head: str, label: str) -> str:
        """The streamed opening: ``## Title`` plus whatever followed it."""
        title, remainder = prompts.split_title(head, fallback=label)
        remainder = remainder.lstrip("\n")
        return f"## {title}\n\n{remainder}" if remainder else f"## {title}\n\n"

    def can_stream(self) -> bool:
        """The note streams into the chat as it is written.

        A revision sheet takes 30-65 s to write; until 2026-11 nothing was
        on screen for all of it (p50 33 s, p95 65 s), students pressed Stop
        and sent again, and three identical notes got saved.
        """
        return True

    def execute(
        self, ctx: ToolContext, params: dict[str, Any]
    ) -> dict[str, Any]:
        """Generate the note, persist it and return the chat card payload."""
        stream = self.execute_stream(ctx, params)
        try:
            while True:
                next(stream)
        except StopIteration as stop:
            return stop.value or {}

    def execute_stream(
        self, ctx: ToolContext, params: dict[str, Any]
    ) -> Generator[str, None, dict[str, Any]]:
        """Stream the note's markdown, then save it and return the card."""
        kind = str(params.get("kind") or "")
        if kind not in prompts.NOTE_KIND_LABELS:
            kind = prompts.DEFAULT_NOTE_KIND
        label = prompts.NOTE_KIND_LABELS[kind]
        topic = str(params.get("topic") or ctx.message or "")
        from_answer = bool(params.get("from_answer"))

        llm = self.resolve_llm(ctx, "LLM_MEDIA_MODEL")
        grounding = ground_generator(
            ctx,
            topic=topic,
            # A card action is built from that card only, never the files.
            wants_media=bool(params.get("use_media")) and not from_answer,
            supabase=self.supabase,
            retrieval=self.retrieval,
            llm=llm,
        )
        if grounding.from_media:
            source = SOURCE_FILES
        elif from_answer or grounding.from_prior:
            source = SOURCE_ANSWER
        else:
            source = SOURCE_TOPIC
        # With material in hand the conversation would only add noise.
        history: list[dict[str, str]] | None = (
            None if (grounding.grounded or from_answer) else ctx.history
        )

        rendered = prompts.PromptBuilder.build(
            prompts.NOTES_GENERATION_TEMPLATE,
            NOTE_KIND=label,
            REQUEST=ctx.enriched_message,
            KIND_RULES=prompts.NOTE_KIND_RULES[kind],
            USER_PROFILE=prompts.user_profile_segment(ctx.personalization),
            SOURCE_CONTEXT=grounding.source_context,
        )
        ctx.note(_PROGRESS[kind])
        raw = ""
        head = ""
        head_done = False
        for chunk in llm.generate_stream(
            rendered.user_message,
            system_prompt=rendered.system_prompt,
            history=history,
            attachments=grounding.attachments,
        ):
            raw += chunk
            if head_done:
                yield chunk
                continue
            head += chunk
            if "\n" not in head and len(head) < _HEAD_MAX_CHARS:
                continue
            head_done = True
            yield self._head_text(head, label)
        if not head_done and head:
            yield self._head_text(head, label)
        title, body = prompts.split_title(raw, fallback=label)
        if not body.strip():
            # Nothing to save: the runner reports the step as failed and
            # the student is told to ask again, instead of an empty note.
            raise CustomError(
                ERROR_CODES["TOOL_EXECUTION_ERROR"],
                details="notes_generator produced an empty note",
            )

        ctx.note("Saving it to your notes…")
        note = self.note_repo.create_generated(
            ctx.user_id,
            title=title,
            content_md=body,
            source_type=_SOURCE_TYPE[source],
            space_id=ctx.space_id,
        )
        return {
            # The whole note is the chat answer; the card links to the copy
            # saved in Notes.
            "answer": f"## {note['title']}\n\n{body}",
            "note_id": note["id"],
            "title": note["title"],
            "preview": preview_of(body),
            "kind": kind,
            "source": source,
            "length": len(body),
            "space_id": note.get("space_id"),
            "source_media_ids": (
                grounding.source_media_ids if grounding.from_media else []
            ),
        }
