"""GenerationService: direct quiz/flashcard creation reuses the chat tools."""

from typing import Any

import pytest
from flask import Flask

from aeva.common.errors import CustomError
from aeva.generation.generation_service import GenerationService
from aeva.generation.schema.generation_schema import (
    FlashcardGenerateSchema,
    QuizGenerateSchema,
)
from aeva.mcp.base import ToolContext

USER = "user-1"
SPACE = "space-general"


class _Supabase:
    def __init__(self, media: set[str] | None = None) -> None:
        self.media = media or set()

    def resolve_space(self, user_id: str, space_id: str | None = None) -> str:
        return space_id or SPACE

    def get_media(self, media_id: str, user_id: str) -> dict[str, Any] | None:
        return {"id": media_id} if media_id in self.media else None

    def get_profile(self, user_id: str) -> dict[str, Any]:
        return {}

    def get_space(self, space_id: str, user_id: str) -> dict[str, Any]:
        return {"id": space_id, "is_default": True}


class _Notes:
    def _fetch(self, user_id: str, note_id: str) -> dict[str, Any]:
        return {"id": note_id, "title": "Cell biology", "content_md": "ATP"}


class _Tool:
    def __init__(self) -> None:
        self.calls: list[tuple[ToolContext, dict[str, Any]]] = []

    def execute(self, ctx: ToolContext, params: dict[str, Any]) -> dict:
        self.calls.append((ctx, params))
        return {"ok": True}


@pytest.fixture
def app_ctx():
    app = Flask(__name__)
    with app.app_context():
        yield


def _service(
    media: set[str] | None = None,
) -> tuple[GenerationService, _Tool, _Tool]:
    quiz, cards = _Tool(), _Tool()
    service = GenerationService(
        supabase=_Supabase(media),  # type: ignore[arg-type]
        quiz_tool=quiz,  # type: ignore[arg-type]
        flashcard_tool=cards,  # type: ignore[arg-type]
        notes=_Notes(),  # type: ignore[arg-type]
    )
    return service, quiz, cards


def test_topic_quiz_forwards_setup_options(app_ctx) -> None:
    service, quiz, _ = _service()
    data = QuizGenerateSchema().load({
        "source": "topic",
        "topic": "Algebra",
        "question_count": 7,
        "difficulty": "hard",
        "question_types": ["true_false"],
    })

    result = service.create_quiz(USER, data)

    ctx, params = quiz.calls[0]
    assert result["data"] == {"ok": True}
    assert params == {
        "topic": "Algebra",
        "question_count": 7,
        "difficulty": "hard",
        "question_types": ["true_false"],
    }
    assert ctx.session_id == ""
    assert ctx.space_id == SPACE
    assert ctx.media_ids is None
    assert ctx.history == []
    assert "Algebra" in ctx.enriched_message


def test_files_source_keeps_only_owned_media(app_ctx) -> None:
    service, _, cards = _service(media={"m1", "m2"})
    data = FlashcardGenerateSchema().load({
        "source": "files",
        "media_ids": ["m1", "foreign", "m2", "m1"],
        "count": 12,
        "additional_instructions": "  Definitions only  ",
    })

    service.create_flashcards(USER, data)

    ctx, params = cards.calls[0]
    assert ctx.media_ids == ["m1", "m2"]
    assert params == {
        "use_media": True,
        "count": 12,
        "additional_instructions": "Definitions only",
    }


def test_files_source_with_no_owned_media_is_not_found(app_ctx) -> None:
    service, _, cards = _service()
    data = FlashcardGenerateSchema().load({
        "source": "files",
        "media_ids": ["foreign"],
    })

    with pytest.raises(CustomError):
        service.create_flashcards(USER, data)
    assert cards.calls == []


def test_note_source_embeds_note_and_uses_title_as_topic(app_ctx) -> None:
    service, quiz, _ = _service()
    data = QuizGenerateSchema().load({"source": "note", "note_id": "n1"})

    service.create_quiz(USER, data)

    ctx, params = quiz.calls[0]
    assert params == {"topic": "Cell biology"}
    assert "ATP" in ctx.enriched_message
    assert ctx.media_ids is None
