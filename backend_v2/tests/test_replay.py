"""Duplicate sends replay the previous answer; media-choice keeps a notes ask."""

import json
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock

import pytest
from flask import Flask

from aeva.feature_flag import feature_flag_service
from aeva.mcp.registry import ToolRegistry
from aeva.orchestration import assistant_orchestrator as ao
from aeva.orchestration.assistant_orchestrator import AssistantOrchestrator
from aeva.orchestration.models import AssistantContext

USER = "u1"
SESSION = "11111111-1111-1111-1111-111111111111"


def _iso(seconds_ago: float) -> str:
    return (datetime.now(tz=UTC) - timedelta(seconds=seconds_ago)).isoformat()


def _rows(answer_age_s: float, status: str = "completed") -> list[dict]:
    return [
        {"id": "m-user", "role": "user", "content": "Make a quiz on osmosis!", "metadata": {}},
        {
            "id": "m-asst",
            "role": "assistant",
            "content": "Here is your quiz.",
            "created_at": _iso(answer_age_s),
            "metadata": {
                "status": status,
                "tool_used": "quiz_generator",
                "tools_used": ["quiz_generator"],
                "content": {"answer": "Here is your quiz.", "quiz_id": "q1"},
            },
        },
    ]


def _orch(rows: list[dict]) -> tuple[AssistantOrchestrator, MagicMock]:
    supabase = MagicMock()
    supabase.get_messages.return_value = rows
    orch = AssistantOrchestrator(
        llm=MagicMock(), registry=ToolRegistry([]), supabase=supabase
    )
    return orch, supabase


def _history(rows: list[dict]) -> list[dict]:
    return [{"role": r["role"], "content": r["content"]} for r in rows]


class TestDuplicateSendReplay:
    def test_same_message_a_moment_after_its_answer_is_replayed(self):
        rows = _rows(answer_age_s=30)
        orch, supabase = _orch(rows)
        ctx = AssistantContext(user_id=USER, session_id=SESSION, message="make a quiz on osmosis")
        replay = orch._duplicate_send_replay(ctx, _history(rows))
        assert replay == {"message": rows[1]}
        supabase.get_messages.assert_called_once_with(SESSION, limit=2)

    def test_a_different_message_costs_no_lookup(self):
        rows = _rows(answer_age_s=30)
        orch, supabase = _orch(rows)
        ctx = AssistantContext(user_id=USER, session_id=SESSION, message="explain osmosis")
        assert orch._duplicate_send_replay(ctx, _history(rows)) is None
        supabase.get_messages.assert_not_called()

    def test_an_old_answer_is_not_replayed(self):
        rows = _rows(answer_age_s=ao._REPLAY_WINDOW_S + 5)
        orch, _ = _orch(rows)
        ctx = AssistantContext(user_id=USER, session_id=SESSION, message="Make a quiz on osmosis")
        assert orch._duplicate_send_replay(ctx, _history(rows)) is None

    def test_an_unfinished_answer_is_not_replayed(self):
        rows = _rows(answer_age_s=10, status="clarification_required")
        orch, _ = _orch(rows)
        ctx = AssistantContext(user_id=USER, session_id=SESSION, message="Make a quiz on osmosis")
        assert orch._duplicate_send_replay(ctx, _history(rows)) is None

    def test_card_actions_and_clarifications_never_replay(self):
        rows = _rows(answer_age_s=10)
        orch, _ = _orch(rows)
        ctx = AssistantContext(
            user_id=USER, session_id=SESSION, message="Make a quiz on osmosis",
            source_content="the card",
        )
        assert orch._duplicate_send_replay(ctx, _history(rows)) is None

    def test_replay_streams_the_note_and_the_previous_content(self):
        rows = _rows(answer_age_s=10)
        orch, supabase = _orch(rows)
        supabase.add_message.return_value = {"id": "m-new"}
        ctx = AssistantContext(user_id=USER, session_id=SESSION, message="Make a quiz on osmosis")
        session = {"id": SESSION, "title": "Osmosis", "space_id": None}
        app = Flask(__name__)
        with app.app_context():
            frames = [
                json.loads(f[len("data: "):])
                for f in orch._replay_stream(ctx, session, {"message": rows[1]})
            ]
        assert len(frames) == 2
        assert frames[0]["content"].startswith(ao._REPLAY_NOTE)
        assert "Here is your quiz." in frames[0]["content"]
        done = frames[1]
        assert done["done"] is True
        assert done["content"]["quiz_id"] == "q1"
        assert done["content"]["replayed_from"] == "m-asst"
        assert done["tool_used"] == "quiz_generator"
        persisted = supabase.add_message.call_args
        assert persisted.args[1] == "assistant"
        assert persisted.kwargs["metadata"]["content"]["replayed_from"] == "m-asst"


class TestMediaChoiceKeepsNotesIntent:
    @pytest.fixture(autouse=True)
    def _flags(self, monkeypatch):
        monkeypatch.setattr(feature_flag_service, "is_enabled", lambda *_a, **_k: True)

    def test_skipped_which_file_question_still_writes_the_note(self):
        orch, _ = _orch([])
        ctx = AssistantContext(
            user_id=USER, session_id=SESSION, message="All files",
            media_ids=["m1", "m2", "m3"],
        )
        plan = orch._forced_plan(
            ctx, media_choice_ids=["m1", "m2"],
            media_choice_query="make revision notes from this chapter",
        )
        assert plan["steps"][0]["tool"] == "notes_generator"
        assert plan["steps"][0]["params"]["use_media"] is True
        assert ctx.media_ids == ["m1", "m2"]

    def test_a_plain_question_still_runs_media_llm(self):
        orch, _ = _orch([])
        ctx = AssistantContext(
            user_id=USER, session_id=SESSION, message="All files",
            media_ids=["m1", "m2"],
        )
        plan = orch._forced_plan(
            ctx, media_choice_ids=["m1"], media_choice_query="what is osmosis"
        )
        assert plan["steps"][0]["tool"] == "media_llm"
        assert plan["steps"][0]["params"] == {"media_ids": ["m1"], "query": "what is osmosis"}
