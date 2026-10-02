"""Create quizzes and flashcards directly, without going through Chat.

Chat and the Quizzes / Flashcards pages are two entry points into the same
creation system: this service builds the ``ToolContext`` a chat turn would
have built and runs the very same generator tools, so the prompts, grounding
(retrieval over uploads), normalisation and persistence are shared. The only
differences are that there is no chat session or conversation history, and
the material is chosen explicitly (a topic, files, or a note) instead of being
inferred from the conversation.
"""

from dataclasses import asdict
from typing import Any

from flask import current_app

from aeva.common.errors import ERROR_CODES, CustomError
from aeva.common.schema import success_response
from aeva.generation.schema.generation_schema import (
    SOURCE_FILES,
    SOURCE_NOTE,
    FlashcardGenerateData,
    GenerationSource,
    QuizGenerateData,
)
from aeva.llm import prompts
from aeva.mcp.base import ToolContext
from aeva.mcp.tools.flashcard_generator import FlashcardGeneratorTool
from aeva.mcp.tools.quiz_generator import QuizGeneratorTool
from aeva.note.note_repository import NoteRepository
from aeva.supabase.supabase_service import SupabaseService

_DEFAULT_NOTE_MAX_CHARS = 12000

# Quiz-setup options forwarded to the quiz tool as-is when set.
_QUIZ_OPTION_KEYS = (
    "question_count",
    "difficulty",
    "target_exam",
    "question_types",
    "additional_instructions",
    "exam_config",
)


class GenerationService:
    """Run the quiz / flashcard generator tools for a direct request."""

    def __init__(
        self,
        supabase: SupabaseService | None = None,
        quiz_tool: QuizGeneratorTool | None = None,
        flashcard_tool: FlashcardGeneratorTool | None = None,
        notes: NoteRepository | None = None,
    ) -> None:
        self._supabase = supabase
        self._quiz_tool = quiz_tool
        self._flashcard_tool = flashcard_tool
        self._notes = notes

    @property
    def supabase(self) -> SupabaseService:
        """Lazy Supabase client."""
        if self._supabase is None:
            self._supabase = SupabaseService()
        return self._supabase

    @property
    def quiz_tool(self) -> QuizGeneratorTool:
        """Lazy quiz generator (the same tool Chat runs)."""
        return self._quiz_tool or QuizGeneratorTool(supabase=self.supabase)

    @property
    def flashcard_tool(self) -> FlashcardGeneratorTool:
        """Lazy flashcard generator (the same tool Chat runs)."""
        return self._flashcard_tool or FlashcardGeneratorTool(
            supabase=self.supabase
        )

    @property
    def notes(self) -> NoteRepository:
        """Lazy notes repository (for note-sourced generation)."""
        return self._notes or NoteRepository(supabase=self.supabase)

    def create_quiz(
        self, user_id: str, data: QuizGenerateData
    ) -> dict[str, Any]:
        """Generate a quiz from the requested source and save it."""
        ctx, params = self._prepare(user_id, data, "a quiz")
        options = asdict(data)
        params.update({
            key: options[key]
            for key in _QUIZ_OPTION_KEYS
            if options.get(key) not in (None, "", [], {})
        })
        result = self.quiz_tool.execute(ctx, params)
        return success_response("Quiz created", result)

    def create_flashcards(
        self, user_id: str, data: FlashcardGenerateData
    ) -> dict[str, Any]:
        """Generate a flashcard set from the requested source and save it."""
        ctx, params = self._prepare(user_id, data, "flashcards")
        if data.count:
            params["count"] = data.count
        instructions = (data.additional_instructions or "").strip()
        if instructions:
            params["additional_instructions"] = instructions
        result = self.flashcard_tool.execute(ctx, params)
        return success_response("Flashcards created", result)

    def _prepare(
        self, user_id: str, data: GenerationSource, noun: str
    ) -> tuple[ToolContext, dict[str, Any]]:
        """Build the tool context + base params for one direct request.

        The context carries what a chat turn's would: the learning-profile
        personalization, the Study Space block and the space the result is
        filed into. ``enriched_message`` stands in for the student's chat
        message; for a note it embeds the note text, mirroring how Chat
        grounds an action in ``source_content``.
        """
        space_id = self.supabase.resolve_space(user_id, data.space_id)
        focus = (data.topic or "").strip()
        params: dict[str, Any] = {}
        media_ids: list[str] | None = None

        if data.source == SOURCE_FILES:
            media_ids = self._owned_media_ids(user_id, data.media_ids)
            params["use_media"] = True
            message = f"Create {noun} from my uploaded material"
            if focus:
                message += f", focusing on {focus}"
        elif data.source == SOURCE_NOTE:
            note = self.notes._fetch(  # noqa: SLF001
                user_id, str(data.note_id)
            )
            title = str(note.get("title") or "my note").strip()
            focus = focus or title
            message = self._note_message(noun, title, note)
        else:
            message = f"Create {noun} on {focus}"
        if focus:
            params["topic"] = focus

        ctx = ToolContext(
            user_id=user_id,
            # No chat session: the tools persist ``session_id`` as NULL.
            session_id="",
            message=message,
            enriched_message=message,
            media_ids=media_ids,
            space_id=space_id,
            personalization=self._personalization(user_id, space_id),
        )
        return ctx, params

    def _owned_media_ids(
        self, user_id: str, media_ids: list[str]
    ) -> list[str]:
        """Keep only the requested files the user owns (404 when none)."""
        owned = [
            media_id
            for media_id in dict.fromkeys(media_ids)
            if self.supabase.get_media(media_id, user_id)
        ]
        if not owned:
            raise CustomError(ERROR_CODES["NOT_FOUND"])
        return owned

    @staticmethod
    def _note_message(noun: str, title: str, note: dict[str, Any]) -> str:
        """Build the stand-in request for a note source, note embedded."""
        limit = int(
            current_app.config.get(
                "PRIOR_CONTEXT_MAX_CHARS", _DEFAULT_NOTE_MAX_CHARS
            )
        )
        body = str(note.get("content_md") or "").strip()
        if len(body) > limit:
            body = body[:limit].rstrip() + " […truncated]"
        return (
            f'Create {noun} from my note "{title}".\n\nUse ONLY the '
            f'following content as the source:\n"""\n{body}\n"""'
        )

    def _personalization(self, user_id: str, space_id: str) -> str:
        """Profile + Study Space prompt blocks, as a chat turn builds them."""
        profile = self.supabase.get_profile(user_id)
        block = prompts.build_identity_block(profile)
        block += prompts.build_personalization_block(profile)
        block += prompts.build_space_block(
            self.supabase.get_space(space_id, user_id)
        )
        return block
