"""Full-turn contracts of the assistant orchestrator (fakes; no LLM or DB).

Guards four product fixes:
- a "do another" / quiz / flashcard request with several files selected is
  routed by intent before any "which file?" question, and a resolved file
  choice keeps the original intent (R5);
- a selected file id that no longer exists is dropped before planning and
  the turn answers instead of refusing (R21);
- the Developer-Mode "powered by" badge is never part of the persisted
  answer and never reaches non-debug users (R8);
- every terminal stream frame carries the persisted message ids (R2).
"""

import copy
import json
from typing import Any
from unittest.mock import MagicMock

import pytest
from flask import Flask

from aeva.feature_flag import feature_flag_service
from aeva.mcp.base import BaseTool, ToolContext, ToolDefinition
from aeva.mcp.registry import ToolRegistry
from aeva.orchestration.assistant_orchestrator import (
    _STALE_MEDIA_NOTE,
    _STALE_MEDIA_NOTE_SOME,
    AssistantOrchestrator,
    _is_image_file,
)
from aeva.orchestration.models import AssistantContext, RunStatus

SESSION = "11111111-1111-1111-1111-111111111111"
USER = "22222222-2222-2222-2222-222222222222"
RUN_ID = "33333333-3333-3333-3333-333333333333"

PDFS = [
    {"id": "m1", "file_name": "physics.pdf", "mime_type": "application/pdf"},
    {"id": "m2", "file_name": "chemistry.pdf", "mime_type": "application/pdf"},
]


def _msg_id(index: int) -> str:
    return f"00000000-0000-0000-0000-{index:012d}"


# ------------------------------------------------------------------ fakes


class _Supabase:
    """The slice of SupabaseService the orchestrator touches."""

    def __init__(
        self,
        *,
        debug: bool = False,
        messages: list[dict] | None = None,
        media: list[dict] | None = None,
    ) -> None:
        self.session = {
            "id": SESSION,
            "title": "Biology",
            "space_id": "sp1",
            "study_spaces": {"id": "sp1", "name": "Cells", "is_default": True},
        }
        self.profile = {"full_name": "Asha", "is_debug_user": debug}
        self.messages = messages or []
        self.media = media or []
        self.added: list[dict] = []
        self.list_media_calls = 0
        self.client = MagicMock()
        table = self.client.table.return_value
        table.insert.return_value.execute.return_value.data = [{"id": RUN_ID}]

    def get_session(self, session_id: str, user_id: str) -> dict | None:
        return self.session if session_id == SESSION else None

    def get_profile(self, user_id: str) -> dict:
        return self.profile

    def get_messages(self, session_id: str, limit: int | None = None) -> list:
        return list(self.messages)

    def list_media(self, user_id: str) -> list[dict]:
        self.list_media_calls += 1
        return list(self.media)

    def add_message(
        self,
        session_id: str,
        role: str,
        content: str,
        metadata: dict | None = None,
        user_id: str | None = None,
    ) -> dict:
        row = {
            "id": _msg_id(len(self.added) + 1),
            "session_id": session_id,
            "role": role,
            "content": content,
            "metadata": copy.deepcopy(metadata or {}),
        }
        self.added.append(row)
        return row

    def update_session(self, *_a: Any, **_k: Any) -> None:
        pass

    def touch_space(self, *_a: Any) -> None:
        pass

    def update_learning_profile(self, *_a: Any, **_k: Any) -> None:
        pass

    def by_role(self, role: str) -> list[dict]:
        return [m for m in self.added if m["role"] == role]


class _Planner:
    model = "planner-model"

    def __init__(self, plan: dict) -> None:
        self.plan = plan
        self.calls: list[dict] = []

    def generate_structured(
        self, user_message: str, response_schema: dict, **kwargs: Any
    ) -> dict:
        self.calls.append({"user_message": user_message, **kwargs})
        return copy.deepcopy(self.plan)


class _AnswerTool(BaseTool):
    def __init__(self, name: str, chunks: tuple[str, ...]) -> None:
        self._name = name
        self._chunks = chunks
        self.calls: list[tuple[ToolContext, dict]] = []

    @property
    def definition(self) -> ToolDefinition:
        return ToolDefinition(
            self._name,
            f"{self._name} tool",
            {"type": "object", "properties": {"query": {"type": "string"}}},
        )

    def can_stream(self) -> bool:
        return True

    def execute(self, ctx: ToolContext, params: dict[str, Any]) -> dict:
        self.calls.append((ctx, params))
        return {"answer": "".join(self._chunks), "sources": []}

    def execute_stream(self, ctx: ToolContext, params: dict[str, Any]):
        self.calls.append((ctx, params))
        yield from self._chunks
        return {"answer": "".join(self._chunks), "sources": []}


class _QuizTool(BaseTool):
    def __init__(self) -> None:
        self.calls: list[dict] = []

    @property
    def definition(self) -> ToolDefinition:
        return ToolDefinition("quiz_generator", "quiz", {"type": "object"})

    def execute(self, ctx: ToolContext, params: dict[str, Any]) -> dict:
        self.calls.append(params)
        return {"quiz_id": "q1", "title": "Cells", "questions": [1, 2]}


def _orch(
    supabase: _Supabase, plan: dict
) -> tuple[AssistantOrchestrator, dict]:
    tools: dict[str, BaseTool] = {
        "general": _AnswerTool("general", ("Osmosis ", "moves water.")),
        "media_llm": _AnswerTool("media_llm", ("From your file: ", "yes.")),
        "quiz_generator": _QuizTool(),
    }
    orch = AssistantOrchestrator(
        llm=_Planner(plan),
        registry=ToolRegistry(list(tools.values())),
        supabase=supabase,
    )
    return orch, tools


def _ctx(message: str, **kwargs: Any) -> AssistantContext:
    return AssistantContext(
        user_id=USER, session_id=SESSION, message=message, **kwargs
    )


def _plan(tool: str, **params: Any) -> dict:
    return {
        "action": "run_tool",
        "steps": [{"tool": tool, "params": {"query": "q", **params}}],
    }


def _frames(raw: list[str]) -> list[dict]:
    return [json.loads(f[len("data: ") :]) for f in raw]


def _stream(orch: AssistantOrchestrator, ctx: AssistantContext) -> list[dict]:
    return _frames(list(orch.run_stream(ctx)))


def _text(frames: list[dict]) -> str:
    return "".join(
        f["content"]
        for f in frames
        if isinstance(f.get("content"), str) and not f.get("done")
    )


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("AI_TRACE_ENABLED", "false")
    monkeypatch.setattr(
        feature_flag_service,
        "get_flags",
        lambda: {"web_search": True, "image_generation": True},
    )
    monkeypatch.setattr(
        feature_flag_service, "is_enabled", lambda *_a, **_k: True
    )


@pytest.fixture
def app():
    app = Flask(__name__)
    app.config.update(
        LLM_WEB_SEARCH_MODEL="answer-model",
        LLM_FAST_MODEL="fast-model",
        LLM_MEDIA_MODEL="media-model",
        LLM_QUIZ_MODEL="quiz-model",
        LLM_FLASHCARD_MODEL="cards-model",
        LLM_IMAGE_MODEL="image-model",
        GENERAL_LLM_MODELS="answer-model,strong-model",
        SHOW_MODEL_BADGE=True,  # the old global override: must be ignored
    )
    with app.app_context():
        yield app


# ------------------------------------------------------------ R5: order


QUIZ_HISTORY = [
    {"role": "user", "content": "quiz me on these"},
    {
        "role": "assistant",
        "content": "I've created a quiz",
        "metadata": {"tool_used": "quiz_generator"},
    },
]


class TestIntentBeforeFileChoice:
    def test_do_another_with_files_repeats_the_quiz_over_them(self, app):
        supabase = _Supabase(messages=QUIZ_HISTORY, media=PDFS)
        orch, _tools = _orch(supabase, _plan("general"))
        _s, _h, _m, plan, _p = orch._setup_and_plan(
            _ctx("do another", media_ids=["m1", "m2"])
        )
        assert plan["_source"] == "continuation"
        assert plan["steps"][0]["tool"] == "quiz_generator"
        assert plan["steps"][0]["params"]["use_media"] is True
        assert orch.llm.calls == []

    def test_quiz_keyword_with_files_skips_the_file_question(self, app):
        supabase = _Supabase(media=PDFS)
        planned = _plan("quiz_generator", topic="osmosis", question_count=5)
        orch, _tools = _orch(supabase, planned)
        _s, _h, _m, plan, _p = orch._setup_and_plan(
            _ctx("create quiz", media_ids=["m1", "m2"])
        )
        # No clarify plan: the planner ran and its quiz plan stands.
        assert plan["action"] == "run_tool"
        assert plan["steps"][0]["tool"] == "quiz_generator"
        assert len(orch.llm.calls) == 1

    def test_flashcard_keyword_with_files_skips_the_file_question(self, app):
        supabase = _Supabase(media=PDFS)
        orch, _tools = _orch(supabase, _plan("flashcard_generator"))
        _s, _h, _m, plan, _p = orch._setup_and_plan(
            _ctx("make flashcards from these pdfs", media_ids=["m1", "m2"])
        )
        assert plan["action"] == "run_tool"
        assert plan["steps"][0]["tool"] == "flashcard_generator"

    def test_vague_request_with_files_still_asks_once(self, app):
        supabase = _Supabase(media=PDFS)
        orch, _tools = _orch(supabase, _plan("general"))
        _s, _h, _m, plan, _p = orch._setup_and_plan(
            _ctx("summarise it", media_ids=["m1", "m2"])
        )
        assert plan["action"] == "clarify"
        assert plan["_source"] == "media_choice"
        assert orch.llm.calls == []

    def test_follow_up_reuses_the_files_the_last_answer_used(self, app):
        history = [
            {"role": "user", "content": "compare both pdfs"},
            {
                "role": "assistant",
                "content": "Physics says X, chemistry says Y.",
                "metadata": {
                    "tool_used": "media_llm",
                    "content": {"answer": "...", "media_count": 2},
                },
            },
        ]
        supabase = _Supabase(messages=history, media=PDFS)
        orch, _tools = _orch(supabase, _plan("media_llm"))
        _s, _h, _m, plan, _p = orch._setup_and_plan(
            _ctx("now give me 5 key points", media_ids=["m1", "m2"])
        )
        assert plan["action"] == "run_tool"
        assert plan["steps"][0]["tool"] == "media_llm"
        # The planner saw both files (no narrowing, no question).
        assert "physics.pdf, chemistry.pdf" in orch.llm.calls[0]["user_message"]

    def test_follow_up_asks_when_the_selection_grew(self, app):
        history = [
            {
                "role": "assistant",
                "content": "Physics says X.",
                "metadata": {
                    "tool_used": "media_llm",
                    "content": {"media_count": 1},
                },
            },
        ]
        supabase = _Supabase(messages=history, media=PDFS)
        orch, _tools = _orch(supabase, _plan("media_llm"))
        _s, _h, _m, plan, _p = orch._setup_and_plan(
            _ctx("now give me 5 key points", media_ids=["m1", "m2"])
        )
        assert plan["action"] == "clarify"

    def test_media_rows_are_fetched_once_per_turn(self, app):
        supabase = _Supabase(media=PDFS)
        orch, _tools = _orch(supabase, _plan("general"))
        orch._setup_and_plan(_ctx("summarise it", media_ids=["m1", "m2"]))
        assert supabase.list_media_calls == 1


class TestResolvedChoiceKeepsIntent:
    @staticmethod
    def _forced(query: str | None) -> dict:
        orch = AssistantOrchestrator(
            llm=MagicMock(), registry=MagicMock(), supabase=MagicMock()
        )
        plan = orch._forced_plan(
            _ctx("x", media_ids=["m1", "m2"]), ["m1"], query
        )
        assert plan is not None
        return plan["steps"][0]

    def test_quiz_ask_becomes_a_quiz_over_the_files(self):
        step = self._forced("make a quiz from this")
        assert step["tool"] == "quiz_generator"
        assert step["params"] == {
            "topic": "make a quiz from this",
            "use_media": True,
        }

    def test_flashcard_ask_becomes_flashcards(self):
        step = self._forced("flashcards please")
        assert step["tool"] == "flashcard_generator"
        assert step["params"]["use_media"] is True

    def test_other_asks_still_run_media_llm_on_the_choice(self):
        step = self._forced("what is osmosis?")
        assert step["tool"] == "media_llm"
        assert step["params"] == {
            "media_ids": ["m1"],
            "query": "what is osmosis?",
        }
        assert self._forced(None)["params"] == {"media_ids": ["m1"]}


class TestImageDetection:
    def test_mime_type_is_authoritative(self):
        assert _is_image_file({"name": "blob", "mime_type": "image/jpeg"})
        assert not _is_image_file(
            {"name": "scan.png", "mime_type": "application/pdf"}
        )

    def test_suffix_is_the_fallback_without_a_mime_type(self):
        assert _is_image_file({"name": "IMG_2.JPG", "mime_type": ""})
        assert not _is_image_file({"name": "notes.pdf", "mime_type": None})


# ----------------------------------------------------------- R21: stale


class TestStaleMediaIds:
    GHOST = "61907523-56ea-4c84-9e87-2cc8cac8fc6f"

    def test_unresolved_id_is_dropped_and_the_turn_answers(self, app):
        supabase = _Supabase(media=[])
        # The planner, told files are selected, picks media_llm from habit.
        orch, tools = _orch(supabase, _plan("media_llm"))
        ctx = _ctx(
            "list the chapter 4 questions and answer them",
            media_ids=[self.GHOST],
        )
        frames = _stream(orch, ctx)

        assert ctx.media_ids is None
        assert "No media selected." in orch.llm.calls[0]["user_message"]
        done = frames[-1]
        assert done["tool_used"] == "general"
        assert tools["media_llm"].calls == []
        assert "No study materials are available" not in json.dumps(frames)
        # One line tells the student: the first text chunk of the stream,
        # the stored answer, and the done frame's answer all start with it.
        first_text = next(f for f in frames if f.get("content"))
        assert first_text["content"] == f"{_STALE_MEDIA_NOTE}\n\n"
        assert _text(frames).startswith(_STALE_MEDIA_NOTE)
        stored = supabase.by_role("assistant")[0]["content"]
        assert stored.startswith(_STALE_MEDIA_NOTE)
        assert done["content"]["answer"].startswith(_STALE_MEDIA_NOTE)

    def test_partial_resolution_keeps_the_real_file(self, app):
        supabase = _Supabase(media=PDFS[:1])
        orch, tools = _orch(supabase, _plan("media_llm"))
        ctx = _ctx("explain this", media_ids=["m1", self.GHOST])
        frames = _stream(orch, ctx)

        assert ctx.media_ids == ["m1"]
        assert frames[-1]["tool_used"] == "media_llm"
        assert tools["media_llm"].calls[0][0].media_ids == ["m1"]
        assert _text(frames).startswith(_STALE_MEDIA_NOTE_SOME)

    def test_resolved_ids_are_untouched_and_silent(self, app):
        supabase = _Supabase(media=PDFS[:1])
        orch, _tools = _orch(supabase, _plan("media_llm"))
        ctx = _ctx("explain this", media_ids=["m1"])
        frames = _stream(orch, ctx)
        assert ctx.media_ids == ["m1"]
        assert "no longer available" not in _text(frames)
        assert orch._media_note is None


# ------------------------------------------------------------ R8: badge


class TestModelBadgeNeverPersists:
    def test_debug_user_gets_a_frame_but_a_clean_stored_answer(self, app):
        supabase = _Supabase(debug=True)
        orch, _tools = _orch(supabase, _plan("general"))
        frames = _stream(orch, _ctx("explain osmosis"))

        badge = [f for f in frames if f.get("type") == "model_badge"]
        assert len(badge) == 1
        assert badge[0]["model"] == "answer-model"
        assert "powered by: answer-model" in badge[0]["badge"]
        assert badge[0]["content"] == ""
        assert "powered by:" not in _text(frames)
        stored = supabase.by_role("assistant")[0]
        assert "powered by:" not in stored["content"]
        assert "powered by:" not in json.dumps(stored["metadata"])
        assert frames[-1]["content"]["model"] == "answer-model"

    def test_env_override_is_ignored_for_normal_users(self, app):
        supabase = _Supabase(debug=False)
        orch, _tools = _orch(supabase, _plan("general"))
        frames = _stream(orch, _ctx("explain osmosis"))

        assert not [f for f in frames if f.get("type") == "model_badge"]
        assert "powered by:" not in json.dumps(frames)
        stored = supabase.by_role("assistant")[0]
        assert "powered by:" not in stored["content"]
        assert "model" not in frames[-1]["content"]

    def test_non_streaming_result_is_clean_too(self, app):
        supabase = _Supabase(debug=True)
        orch, _tools = _orch(supabase, _plan("general"))
        result = orch.run(_ctx("explain osmosis"))
        assert result.status == RunStatus.COMPLETED
        assert "powered by:" not in result.display_text
        assert "powered by:" not in supabase.by_role("assistant")[0]["content"]


# ------------------------------------------------------------- R2: ids


class TestPersistedIdsInFrames:
    def test_done_frame_names_both_persisted_messages(self, app):
        supabase = _Supabase()
        orch, _tools = _orch(supabase, _plan("general"))
        frames = _stream(orch, _ctx("explain osmosis"))
        done = frames[-1]
        assert done["done"] is True
        user, assistant = supabase.added
        assert user["role"] == "user"
        assert done["user_message_id"] == user["id"] == _msg_id(1)
        assert done["assistant_message_id"] == assistant["id"] == _msg_id(2)

    def test_clarification_frame_names_the_user_message(self, app):
        clarify = {
            "action": "clarify",
            "clarification": {
                "reason": "Which topic?",
                "questions": [
                    {"id": "topic", "text": "Which topic?", "options": ["A"]}
                ],
            },
        }
        supabase = _Supabase()
        orch, _tools = _orch(supabase, clarify)
        frames = _stream(orch, _ctx("make notes for this"))
        data = frames[-1]["data"]
        assert frames[-1]["type"] == "clarification"
        assert data["user_message_id"] == supabase.by_role("user")[0]["id"]
        assert data["message_id"] is None  # unchanged: no id for the ask

    def test_non_streaming_result_carries_the_user_message_id(self, app):
        supabase = _Supabase()
        orch, _tools = _orch(supabase, _plan("general"))
        result = orch.run(_ctx("explain osmosis"))
        assert result.message_id == _msg_id(2)
        assert result.user_message_id == _msg_id(1)
