"""Execution tracing of the orchestrator: turn lifecycle, routing, flush.

Drives ``AssistantOrchestrator`` with a fake planner LLM, fake tools and a
fake Supabase inside a bare Flask app context, captures what ``finish_turn``
would write, and asserts on the recorded span rows. Spans added by other
layers (agent runner, tools, LLM client) may or may not be present, so the
assertions select spans by name instead of comparing whole trees.
"""

import copy
import importlib
import importlib.util
import json
import sys
import threading
import time
from typing import Any
from unittest.mock import MagicMock

import pytest
from flask import Flask

from aeva import tracing
from aeva.assistant import assistant_repository
from aeva.assistant.assistant_repository import AssistantRepository
from aeva.assistant.schema.assistant_schema import AssistantRequestData
from aeva.common.errors import CustomError
from aeva.common.schema import UserData
from aeva.feature_flag import feature_flag_service
from aeva.mcp.base import BaseTool, ToolContext, ToolDefinition
from aeva.mcp.registry import ToolRegistry
from aeva.orchestration.assistant_orchestrator import AssistantOrchestrator
from aeva.orchestration.models import (
    AssistantContext,
    ClarificationAction,
    FlashcardOptions,
    QuizOptions,
    RunStatus,
    UserClarificationResponse,
)
from aeva.tracing import recorder, store
from aeva.tracing.services import turn_trace

SESSION = "11111111-1111-1111-1111-111111111111"
RUN_ID = "22222222-2222-2222-2222-222222222222"
USER = "22222222-2222-2222-2222-222222222222"
# UUID-shaped ids the fake database does not know.
MISSING_SESSION = "99999999-9999-9999-9999-999999999999"
MISSING_RUN = "88888888-8888-8888-8888-888888888888"


def _msg_id(index: int) -> str:
    """UUID-shaped message id (the trace's id columns only accept UUIDs)."""
    return f"00000000-0000-0000-0000-{index:012d}"


ANSWER = ("Osmosis moves ", "water across ", "a membrane.")


# --------------------------------------------------------------- fixtures


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    """Unbound trace, storage 'available', default config, all flags on."""
    recorder._BINDING.set(None)
    monkeypatch.setattr(store, "_unavailable_until", 0.0)
    monkeypatch.setattr(store, "_known_prompt_versions", set())
    for key in (
        "AI_TRACE_ENABLED",
        "AI_TRACE_SCOPE",
        "AI_TRACE_SAMPLE_RATE",
        "AI_TRACE_MAX_FIELD_CHARS",
        "AI_TRACE_MAX_SPANS",
    ):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setattr(
        feature_flag_service,
        "get_flags",
        lambda: {"web_search": True, "image_generation": True},
    )
    yield
    recorder._BINDING.set(None)


@pytest.fixture
def saved(monkeypatch):
    """Capture what finish_turn would write instead of hitting Supabase."""
    box: dict = {"writes": 0}

    def fake_persist(trace_row, span_rows, prompt_rows):
        box["trace"] = trace_row
        box["spans"] = span_rows
        box["prompts"] = prompt_rows
        box["writes"] += 1
        return True

    monkeypatch.setattr(store, "persist", fake_persist)
    return box


def _make_app() -> Flask:
    app = Flask(__name__)
    app.config.update(
        LLM_WEB_SEARCH_MODEL="answer-model",
        LLM_FAST_MODEL="fast-model",
        LLM_MEDIA_MODEL="media-model",
        LLM_QUIZ_MODEL="quiz-model",
        LLM_FLASHCARD_MODEL="cards-model",
        LLM_IMAGE_MODEL="image-model",
        GENERAL_LLM_MODELS="answer-model,strong-model",
    )
    return app


@pytest.fixture
def app():
    app = _make_app()
    with app.app_context():
        yield app


# ------------------------------------------------------------------ fakes


class _Supabase:
    """The slice of SupabaseService the orchestrator touches."""

    def __init__(
        self,
        *,
        debug: bool = False,
        title: str = "Biology",
        messages: list[dict] | None = None,
        media: list[dict] | None = None,
        run: dict | None = None,
        fail_role: str | None = None,
    ) -> None:
        self.fail_role = fail_role
        self.session = {
            "id": SESSION,
            "title": title,
            "space_id": "sp1",
            "study_spaces": {"id": "sp1", "name": "Cells", "is_default": True},
        }
        self.profile = {"full_name": "Asha", "is_debug_user": debug}
        self.messages = messages or []
        self.media = media or []
        self.added: list[dict] = []
        self.calls: list[tuple] = []
        # orchestration_runs goes through the raw client.
        self.client = MagicMock()
        table = self.client.table.return_value
        table.insert.return_value.execute.return_value.data = [{"id": RUN_ID}]
        lookup = table.select.return_value.eq.return_value.eq.return_value
        lookup.maybe_single.return_value.execute.return_value.data = run

    def get_session(self, session_id: str, user_id: str) -> dict | None:
        self.calls.append(("get_session", session_id, user_id))
        return self.session if session_id == SESSION else None

    def get_profile(self, user_id: str) -> dict:
        self.calls.append(("get_profile", user_id))
        return self.profile

    def get_messages(self, session_id: str, limit: int | None = None) -> list:
        self.calls.append(("get_messages", session_id, limit))
        return list(self.messages)

    def list_media(self, user_id: str) -> list[dict]:
        self.calls.append(("list_media", user_id))
        return list(self.media)

    def add_message(
        self,
        session_id: str,
        role: str,
        content: str,
        metadata: dict | None = None,
    ) -> dict:
        if role == self.fail_role:
            raise RuntimeError(f"insert of the {role} message failed")
        row = {
            "id": _msg_id(len(self.added) + 1),
            "session_id": session_id,
            "role": role,
            "content": content,
            "metadata": copy.deepcopy(metadata or {}),
        }
        self.calls.append(("add_message", session_id, role, content))
        self.added.append(row)
        return row

    def update_session(self, session_id: str, user_id: str, **fields: Any):
        self.calls.append(("update_session", session_id, user_id, fields))

    def touch_space(self, space_id: str) -> None:
        self.calls.append(("touch_space", space_id))

    def update_learning_profile(self, user_id: str, fields: dict) -> None:
        self.calls.append(("update_learning_profile", user_id, fields))

    def by_role(self, role: str) -> list[dict]:
        return [m for m in self.added if m["role"] == role]


class _Planner:
    """Stands in for the orchestrator's LLMClient.

    Opens the same ``llm`` span the instrumented client opens, so the route
    span's children look like production.
    """

    model = "planner-model"

    def __init__(
        self, plan: dict | None = None, error: Exception | None = None
    ) -> None:
        self.plan = plan
        self.error = error
        self.calls: list[dict] = []

    def generate_structured(
        self,
        user_message: str,
        response_schema: dict,
        *,
        system_prompt: str | None = None,
        history: list[dict] | None = None,
        log_label: str = "structured",
    ) -> dict:
        self.calls.append({"user_message": user_message, "history": history})
        with tracing.llm_call(
            method="generate_structured",
            label=log_label,
            provider="fake",
            model=self.model,
            user_message=user_message,
            system_prompt=system_prompt,
            history=history,
            response_schema=response_schema,
        ) as span:
            if self.error is not None:
                raise self.error
            plan = copy.deepcopy(self.plan or {})
            span.set(output={"json": plan})
            return plan


class _AnswerTool(BaseTool):
    """Streaming answer tool that makes no LLM call."""

    def __init__(self, name: str, chunks: tuple[str, ...] = ANSWER) -> None:
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


def _tools() -> list[BaseTool]:
    return [
        _AnswerTool("general"),
        _AnswerTool("web_search"),
        _AnswerTool("media_llm"),
        _QuizTool(),
    ]


def _orch(
    supabase: Any, llm: Any, tools: list[BaseTool] | None = None
) -> AssistantOrchestrator:
    return AssistantOrchestrator(
        llm=llm, registry=ToolRegistry(tools or _tools()), supabase=supabase
    )


def _ctx(message: str, **kwargs: Any) -> AssistantContext:
    return AssistantContext(
        user_id=USER, session_id=SESSION, message=message, **kwargs
    )


def _plan(tool: str, **step: Any) -> dict:
    return {
        "action": "run_tool",
        "steps": [{"tool": tool, "params": {"query": "q"}, **step}],
    }


CLARIFY = {
    "action": "clarify",
    "clarification": {
        "reason": "Which topic?",
        "questions": [
            {"id": "topic", "text": "Which topic?", "options": ["A", "B"]}
        ],
    },
}


def _frames(raw: list[str]) -> list[dict]:
    return [json.loads(frame[len("data: ") :]) for frame in raw]


def _stream(orch: AssistantOrchestrator, ctx: AssistantContext) -> list[dict]:
    return _frames(list(orch.run_stream(ctx)))


def _stable(frames: list[dict]) -> list[dict]:
    """Frames without the wall-clock ``ms`` values (they differ per run)."""
    out = copy.deepcopy(frames)
    for frame in out:
        frame.pop("ms", None)
        content = frame.get("content")
        if isinstance(content, dict):
            for agent in content.get("agents") or []:
                agent.pop("ms", None)
    return out


def _named(spans: list[dict], name: str) -> list[dict]:
    return [s for s in spans if s["name"] == name]


def _one(spans: list[dict], name: str) -> dict:
    found = _named(spans, name)
    assert len(found) == 1, (name, [s["name"] for s in spans])
    return found[0]


def _children(spans: list[dict], parent: dict) -> list[dict]:
    return [s for s in spans if s["parent_id"] == parent["id"]]


def _checked(route: dict) -> list[tuple[str, bool]]:
    return [(c["branch"], c["matched"]) for c in route["meta"]["checked"]]


# ---------------------------------------------------------- turn lifecycle


class TestPlannerRoute:
    MESSAGE = "suggest the best iPhone 17 model for a student"

    def _run(self, saved):
        supabase = _Supabase()
        llm = _Planner(_plan("general", model="strong-model", purpose="a"))
        frames = _stream(_orch(supabase, llm), _ctx(self.MESSAGE))
        trace_id = tracing.finish_turn()
        assert trace_id == saved["trace"]["id"]
        return supabase, llm, frames

    def test_trace_row(self, app, saved):
        supabase, _llm, frames = self._run(saved)
        trace = saved["trace"]
        assert trace["status"] == "completed"
        assert trace["endpoint"] == "stream"
        assert trace["user_id"] == USER
        assert trace["session_id"] == SESSION
        assert trace["plan_source"] == "planner"
        assert trace["plan_action"] == "run_tool"
        assert trace["user_message_id"] == supabase.by_role("user")[0]["id"]
        assert (
            trace["assistant_message_id"]
            == (supabase.by_role("assistant")[0]["id"])
        )
        assert trace["meta"]["is_debug_user"] is False
        assert "plan_turn" in trace["prompt_names"]
        assert frames[-1]["done"] is True
        assert frames[-1]["tool_used"] == "web_search"

    def test_root_span(self, app, saved):
        _supabase, _llm, frames = self._run(saved)
        root = saved["spans"][0]
        assert (root["kind"], root["name"]) == ("turn", "chat_turn")
        assert root["parent_id"] is None
        assert root["status"] == "ok"
        assert root["input"] == {
            "message": self.MESSAGE,
            "media_ids": None,
            "run_id": None,
            "clarification": None,
            "quiz_options": None,
            "flashcard_options": None,
            "source_content_chars": 0,
        }
        assert root["output"] == {
            "display_text": "".join(ANSWER),
            "tool_used": "web_search",
            "tools_used": frames[-1]["tools_used"],
        }
        assert root["meta"]["outcome"] == "completed"

    def test_top_level_steps_in_order(self, app, saved):
        self._run(saved)
        spans = saved["spans"]
        root = spans[0]
        mine = [
            (s["kind"], s["name"])
            for s in _children(spans, root)
            if s["kind"] != "tool" and s["name"] != "handoff"
        ]
        assert mine == [
            ("context", "load_context"),
            ("persist", "user_message"),
            ("router", "route"),
            ("decision", "outcome"),
            ("decision", "normalize_steps"),
            ("decision", "finish_turn"),
            ("persist", "assistant_message"),
        ]

    def test_load_context(self, app, saved):
        self._run(saved)
        context = _one(saved["spans"], "load_context")
        assert context["input"] == {"session_id": SESSION}
        out = context["output"]
        assert out["session"] == {
            "id": SESSION,
            "title": "Biology",
            "space_id": "sp1",
            "space_name": "Cells",
        }
        assert out["is_debug_user"] is False
        assert out["history_messages"] == 0
        assert "Asha" in out["personalization"]
        # The same text, broken down by the user detail behind each part.
        parts = {p["part"]: p for p in out["personalization_parts"]}
        assert list(parts) == ["identity", "learning_profile", "study_space"]
        assert parts["identity"]["included"] is True
        assert parts["identity"]["lines"] == [
            {"source": "profile.full_name", "line": "Student's name: Asha"}
        ]
        assert parts["learning_profile"]["included"] is False
        assert parts["study_space"]["included"] is False
        assert "default General space" in parts["study_space"]["reason"]
        assert sum(p["chars"] for p in parts.values()) == len(
            out["personalization"]
        )
        assert out["enriched_message"] == self.MESSAGE
        assert out["source_content"] is False
        assert out["clarification_resume"] is None

    def test_route_shows_raw_plan_rewrite_and_final_plan(self, app, saved):
        _supabase, llm, _frames_ = self._run(saved)
        spans = saved["spans"]
        route = _one(spans, "route")
        assert route["kind"] == "router"
        assert route["status"] == "ok"
        assert route["input"] == {
            "message": self.MESSAGE,
            "media_ids": None,
            "has_clarification": False,
        }
        assert _checked(route) == [
            ("forced", False),
            ("media_choice", False),
            ("continuation", False),
            ("fast_path", False),
            ("planner", True),
        ]
        inside = [(s["kind"], s["name"]) for s in _children(spans, route)]
        assert inside == [
            ("prompt", "plan_turn"),
            ("llm", "plan_turn"),
            ("decision", "planner_output"),
            ("decision", "web_upgrade"),
        ]
        assert len(llm.calls) == 1

        # The planner's own answer, before any rule touched it.
        raw = _one(spans, "planner_output")["output"]
        assert raw == _plan("general", model="strong-model", purpose="a")

        upgrade = _one(spans, "web_upgrade")
        assert upgrade["input"]["tool"] == "general"
        assert upgrade["output"]["tool"] == "web_search"
        assert upgrade["output"]["params"] == {
            "query": "q",
            "search_intent": "recommend",
        }
        reason = upgrade["meta"]["reason"]
        assert "product/choice" in reason
        assert "recommend" in reason

        out = route["output"]
        assert out["source"] == "planner"
        assert out["action"] == "run_tool"
        assert [s["tool"] for s in out["steps"]] == ["web_search"]
        assert out["steps"][0]["model"] == "strong-model"
        assert out["plan"]["_upgraded"] is True
        assert out["plan"]["steps"][0]["tool"] == "web_search"

    def test_outcome_roster_and_finish(self, app, saved):
        self._run(saved)
        spans = saved["spans"]
        outcome = _one(spans, "outcome")["output"]
        assert outcome["outcome"] == "run_tools"
        assert "web_search" in outcome["reason"]

        roster = _one(spans, "normalize_steps")
        assert roster["input"][0]["tool"] == "web_search"
        assert roster["output"] == {
            "steps": [
                {
                    "id": "answer",
                    "tool": "web_search",
                    "kind": "answer",
                    "params": {"query": "q", "search_intent": "recommend"},
                    "model": "answer-model",
                    "config_key": None,
                    "purpose": "a",
                    "input": "message",
                }
            ],
            "dropped": [],
        }
        # "strong-model" is a general candidate, not a web_search one.
        assert roster["meta"]["clamped"] == [
            {
                "tool": "web_search",
                "requested": "strong-model",
                "used": "answer-model",
            }
        ]
        assert roster["meta"]["degraded"] == []
        assert roster["meta"]["ignored"] == []
        assert "overridden" not in roster["meta"]

        finish = _one(spans, "finish_turn")
        assert finish["output"]["available_actions"] == []
        assert finish["output"]["suggested_followups"] == []
        assert finish["output"]["dropped"] == []
        assert finish["output"]["badge"] is False
        assert finish["output"]["model"] == "answer-model"
        assert isinstance(finish["meta"]["planning_ms"], int)
        assert isinstance(finish["meta"]["tool_ms"], int)

    def test_persist_events(self, app, saved):
        supabase, _llm, _frames_ = self._run(saved)
        spans = saved["spans"]
        user = _one(spans, "user_message")
        assert user["kind"] == "persist"
        assert user["output"] == {"message_id": _msg_id(1)}
        assistant = _one(spans, "assistant_message")
        assert assistant["output"] == {
            "message_id": _msg_id(2),
            "title_updated": False,
        }
        assert [m["role"] for m in supabase.added] == ["user", "assistant"]


class TestFastPath:
    def test_no_planner_call_and_reason(self, app, saved):
        supabase = _Supabase()
        llm = _Planner(_plan("general"))
        general = _AnswerTool("general", ("Hello!",))
        frames = _stream(_orch(supabase, llm, [general]), _ctx("hi"))
        tracing.finish_turn()

        assert llm.calls == []
        spans = saved["spans"]
        route = _one(spans, "route")
        assert [(s["kind"], s["name"]) for s in _children(spans, route)] == [
            ("decision", "fast_path")
        ]
        assert not [s for s in spans if s["name"] == "plan_turn"]
        assert _checked(route) == [
            ("forced", False),
            ("media_choice", False),
            ("continuation", False),
            ("fast_path", True),
        ]
        decision = _one(spans, "fast_path")
        assert "small talk" in decision["meta"]["reason"]
        assert "LLM_FAST_MODEL" in decision["meta"]["reason"]
        # The decision keeps the plan as the branch returned it; the source
        # stamp is on the route's final plan.
        assert decision["output"]["steps"][0]["tool"] == "general"
        assert decision["output"]["model_config_key"] == "LLM_FAST_MODEL"
        assert route["output"]["source"] == "fast_path"
        assert route["output"]["plan"]["_source"] == "fast_path"

        assert saved["trace"]["plan_source"] == "fast_path"
        assert saved["trace"]["llm_calls"] == 0
        roster = _one(spans, "normalize_steps")
        assert roster["meta"]["overridden"] == {
            "tool": "general",
            "planned_model": "answer-model",
            "model": "fast-model",
            "config_key": "LLM_FAST_MODEL",
        }
        assert roster["output"]["steps"][0]["config_key"] == "LLM_FAST_MODEL"
        assert general.calls[0][0].model == "fast-model"
        assert frames[-1]["tool_used"] == "general"


class TestOutcomes:
    def test_clarification(self, app, saved):
        supabase = _Supabase()
        orch = _orch(supabase, _Planner(CLARIFY))
        frames = _stream(orch, _ctx("explain this to me in simple words"))
        tracing.finish_turn()

        assert [f["type"] for f in frames] == ["clarification"]
        assert frames[0]["data"]["run_id"] == RUN_ID

        trace = saved["trace"]
        assert trace["status"] == "clarification"
        assert trace["run_id"] == RUN_ID
        assert trace["plan_action"] == "clarify"
        # The clarification message is linked by the trace id stamped on it
        # (the method does not keep the inserted row, so not by message id).
        assert trace["assistant_message_id"] is None
        message = supabase.by_role("assistant")[0]
        assert message["metadata"]["trace_id"] == trace["id"]
        assert set(message["metadata"]) == {
            "status",
            "run_id",
            "clarification",
            "trace_id",
        }

        spans = saved["spans"]
        # Contract order: route, outcome, then the saved message.
        assert [(s["kind"], s["name"]) for s in _children(spans, spans[0])] == [
            ("context", "load_context"),
            ("persist", "user_message"),
            ("router", "route"),
            ("decision", "outcome"),
            ("persist", "assistant_message"),
        ]
        assert _one(spans, "outcome")["status"] == "ok"
        outcome = _one(spans, "outcome")["output"]
        assert outcome["outcome"] == "clarification"
        assert outcome["run_id"] == RUN_ID
        assert outcome["clarification_reason"] == "Which topic?"
        assert outcome["questions"] == [
            {
                "id": "topic",
                "text": "Which topic?",
                "options": ["A", "B"],
                "input_type": "chips",
            }
        ]
        assert "clarify" in outcome["reason"]
        # The planner's clarify stood: no rule overrode it, nothing ran.
        assert not _named(spans, "clarify_skipped")
        assert not _named(spans, "normalize_steps")
        assert _one(spans, "assistant_message")["output"] == {
            "message_id": None,
            "status": "clarification_required",
            "linked_by": "metadata.trace_id",
        }
        root = spans[0]
        assert root["status"] == "ok"
        assert root["meta"]["outcome"] == "clarification"
        assert root["output"]["display_text"].startswith("**Which topic?**")

    def test_clarification_is_stored_as_before_when_not_tracing(
        self, app, saved, monkeypatch
    ):
        monkeypatch.setenv("AI_TRACE_ENABLED", "false")
        supabase = _Supabase()
        frames = _stream(
            _orch(supabase, _Planner(CLARIFY)),
            _ctx("explain this to me in simple words"),
        )
        assert [f["type"] for f in frames] == ["clarification"]
        assert set(supabase.by_role("assistant")[0]["metadata"]) == {
            "status",
            "run_id",
            "clarification",
        }
        assert saved["writes"] == 0

    def test_failing_clarification_write_is_an_error_turn(self, app, saved):
        supabase = _Supabase(fail_role="assistant")
        orch = _orch(supabase, _Planner(CLARIFY))
        with pytest.raises(RuntimeError, match="assistant message failed"):
            list(orch.run_stream(_ctx("explain this to me in simple words")))
        tracing.finish_turn()

        assert saved["trace"]["status"] == "error"
        assert saved["trace"]["assistant_message_id"] is None
        spans = saved["spans"]
        outcome = _one(spans, "outcome")
        assert outcome["status"] == "error"
        assert "assistant message failed" in outcome["error"]
        assert not _named(spans, "assistant_message")

    def test_quiz_setup_for_an_unconfigured_quiz(self, app, saved):
        supabase = _Supabase()
        plan = {
            "action": "run_tool",
            "steps": [{"tool": "quiz_generator", "params": {"topic": "cells"}}],
        }
        quiz = _QuizTool()
        orch = _orch(supabase, _Planner(plan), [_AnswerTool("general"), quiz])
        frames = _stream(orch, _ctx("quiz me on cells"))
        tracing.finish_turn()

        assert [f["type"] for f in frames] == ["quiz_setup"]
        assert quiz.calls == []
        assert saved["trace"]["status"] == "quiz_setup"
        assert saved["trace"]["assistant_message_id"] is None
        spans = saved["spans"]
        outcome = _one(spans, "outcome")["output"]
        assert outcome["outcome"] == "quiz_setup"
        assert "question_count and difficulty" in outcome["reason"]
        assert outcome["data"] == frames[0]["data"]
        assert not _named(spans, "assistant_message")
        assert [m["role"] for m in supabase.added] == ["user"]
        assert spans[0]["meta"]["outcome"] == "quiz_setup"

    def test_quiz_setup_because_the_message_says_quiz(self, app, saved):
        orch = _orch(_Supabase(), _Planner(_plan("general")))
        frames = _stream(orch, _ctx("what is a quiz good for?"))
        tracing.finish_turn()

        assert [f["type"] for f in frames] == ["quiz_setup"]
        reason = _one(saved["spans"], "outcome")["output"]["reason"]
        assert 'contains "quiz"' in reason
        assert "general" in reason

    def test_exception_during_planning(self, app, saved):
        supabase = _Supabase()
        orch = _orch(supabase, _Planner(error=RuntimeError("planner down")))
        with pytest.raises(RuntimeError, match="planner down"):
            list(orch.run_stream(_ctx("what is osmosis?")))
        # Nothing is written by the orchestrator itself.
        assert saved["writes"] == 0
        assert tracing.is_active()
        tracing.finish_turn()

        trace = saved["trace"]
        assert trace["status"] == "error"
        assert trace["error"] == "RuntimeError: planner down"
        assert trace["session_id"] == SESSION
        assert trace["user_message_id"] == _msg_id(1)
        assert trace["plan_source"] is None
        spans = saved["spans"]
        assert spans[0]["status"] == "error"
        route = _one(spans, "route")
        assert route["status"] == "error"
        assert "planner down" in route["error"]
        assert _checked(route)[-1] == ("planner", True)
        llm_span = next(s for s in spans if s["kind"] == "llm")
        assert llm_span["status"] == "error"
        assert llm_span["parent_id"] == route["id"]
        assert not _named(spans, "outcome")
        assert [m["role"] for m in supabase.added] == ["user"]

    def test_session_not_found_never_sets_the_session_column(self, app, saved):
        # A UUID-shaped id of a session that does not exist: storing it
        # would break the trace insert (the column has a foreign key).
        orch = _orch(_Supabase(), _Planner(_plan("general")))
        ctx = AssistantContext(
            user_id=USER, session_id=MISSING_SESSION, message="hi"
        )
        with pytest.raises(CustomError) as raised:
            list(orch.run_stream(ctx))
        assert raised.value.code == "NOT_FOUND"
        tracing.finish_turn()

        assert saved["trace"]["status"] == "error"
        assert saved["trace"]["session_id"] is None
        context = _one(saved["spans"], "load_context")
        assert context["status"] == "error"
        assert context["input"] == {"session_id": MISSING_SESSION}
        assert not _named(saved["spans"], "route")
        assert not _named(saved["spans"], "user_message")

    def test_expired_run_never_sets_the_run_column(self, app, saved):
        # The reply names a run that is gone: its UUID-shaped id must not
        # reach the trace's run column.
        orch = _orch(_Supabase(run=None), _Planner(_plan("general")))
        ctx = _ctx(
            "skip",
            run_id=MISSING_RUN,
            clarification=UserClarificationResponse(
                action=ClarificationAction.SKIP
            ),
        )
        with pytest.raises(CustomError) as raised:
            list(orch.run_stream(ctx))
        assert raised.value.code == "CLARIFICATION_EXPIRED"
        tracing.finish_turn()

        trace = saved["trace"]
        assert trace["status"] == "error"
        assert trace["run_id"] is None
        # The session itself was loaded before the run was looked up.
        assert trace["session_id"] == SESSION
        assert _one(saved["spans"], "load_context")["status"] == "error"
        assert saved["spans"][0]["input"]["run_id"] == MISSING_RUN

    def test_debug_user_turn_that_fails_early_is_kept_under_debug_scope(
        self, app, saved, monkeypatch
    ):
        monkeypatch.setenv("AI_TRACE_SCOPE", "debug_users")
        ctx = _ctx(
            "skip",
            run_id=MISSING_RUN,
            clarification=UserClarificationResponse(
                action=ClarificationAction.SKIP
            ),
        )
        for debug, writes in ((False, 0), (True, 1)):
            orch = _orch(_Supabase(debug=debug, run=None), _Planner())
            with pytest.raises(CustomError):
                list(orch.run_stream(ctx))
            tracing.finish_turn()
            assert saved["writes"] == writes
        assert saved["trace"]["status"] == "error"
        assert saved["trace"]["meta"]["is_debug_user"] is True

    def test_failing_answer_write_is_an_error_turn(self, app, saved):
        supabase = _Supabase(fail_role="assistant")
        orch = _orch(supabase, _Planner(_plan("general")))
        with pytest.raises(RuntimeError, match="assistant message failed"):
            list(orch.run_stream(_ctx("what is osmosis?")))
        tracing.finish_turn()

        trace = saved["trace"]
        assert trace["status"] == "error"
        assert trace["error"] == (
            "RuntimeError: insert of the assistant message failed"
        )
        assert trace["assistant_message_id"] is None
        assert trace["user_message_id"] == _msg_id(1)
        spans = saved["spans"]
        assert spans[0]["status"] == "error"
        assert spans[0]["output"] is None
        assert _one(spans, "finish_turn")
        assert not _named(spans, "assistant_message")

    def test_failing_user_write_is_an_error_turn(self, app, saved):
        supabase = _Supabase(fail_role="user")
        orch = _orch(supabase, _Planner(_plan("general")))
        with pytest.raises(RuntimeError, match="user message failed"):
            list(orch.run_stream(_ctx("what is osmosis?")))
        tracing.finish_turn()

        trace = saved["trace"]
        assert trace["status"] == "error"
        assert trace["session_id"] == SESSION
        assert trace["user_message_id"] is None
        spans = saved["spans"]
        assert _one(spans, "load_context")["status"] == "ok"
        assert not _named(spans, "user_message")
        assert not _named(spans, "route")

    def test_client_abort_mid_stream(self, app, saved):
        supabase = _Supabase()
        orch = _orch(supabase, _Planner(_plan("general")))
        stream = orch.run_stream(_ctx("what is osmosis?"))
        for raw in stream:
            frame = json.loads(raw[len("data: ") :])
            if frame.get("content") and not frame.get("type"):
                break  # first piece of the answer reached the client
        stream.close()
        tracing.finish_turn()

        assert saved["trace"]["status"] == "aborted"
        assert saved["trace"]["assistant_message_id"] is None
        spans = saved["spans"]
        assert spans[0]["status"] == "aborted"
        assert spans[0]["meta"]["outcome"] == "aborted"
        assert _one(spans, "outcome")["output"]["outcome"] == "run_tools"
        assert not _named(spans, "finish_turn")
        assert not _named(spans, "assistant_message")
        assert [m["role"] for m in supabase.added] == ["user"]

    def test_closing_after_the_done_frame_stays_completed(self, app, saved):
        orch = _orch(_Supabase(), _Planner(_plan("general")))
        stream = orch.run_stream(_ctx("what is osmosis?"))
        for raw in stream:
            if json.loads(raw[len("data: ") :]).get("done"):
                break
        stream.close()
        tracing.finish_turn()

        assert saved["trace"]["status"] == "completed"
        assert saved["spans"][0]["status"] == "ok"


RULE_DECISIONS = (
    "forced_plan",
    "media_choice",
    "continuation",
    "fast_path",
    "clarify_blocked",
    "clarify_skipped",
    "web_upgrade",
    "media_guard",
)


def _rules_fired(spans: list[dict]) -> list[str]:
    return [s["name"] for s in spans if s["name"] in RULE_DECISIONS]


class TestRulesThatDidNotFire:
    """A rule decision is recorded only when the rule changed something."""

    def test_plain_question_records_no_rule(self, app, saved):
        orch = _orch(_Supabase(), _Planner(_plan("general")))
        frames = _stream(orch, _ctx("what is osmosis?"))
        tracing.finish_turn()

        assert frames[-1]["tool_used"] == "general"
        spans = saved["spans"]
        assert _rules_fired(spans) == []
        route = _one(spans, "route")
        assert [(s["kind"], s["name"]) for s in _children(spans, route)] == [
            ("prompt", "plan_turn"),
            ("llm", "plan_turn"),
            ("decision", "planner_output"),
        ]
        assert route["output"]["source"] == "planner"
        assert "_upgraded" not in route["output"]["plan"]

    def test_web_search_plan_is_not_an_upgrade(self, app, saved):
        # The planner itself chose web_search: nothing was promoted.
        orch = _orch(_Supabase(), _Planner(_plan("web_search")))
        _stream(orch, _ctx("suggest the best iPhone 17 model for a student"))
        tracing.finish_turn()
        assert _rules_fired(saved["spans"]) == []

    def test_upgrade_needs_the_flag(self, app, saved, monkeypatch):
        monkeypatch.setattr(
            feature_flag_service, "is_enabled", lambda _key: False
        )
        orch = _orch(_Supabase(), _Planner(_plan("general")))
        frames = _stream(
            orch, _ctx("suggest the best iPhone 17 model for a student")
        )
        tracing.finish_turn()
        assert frames[-1]["tool_used"] == "general"
        assert _rules_fired(saved["spans"]) == []

    def test_media_guard_absent_when_the_plan_already_uses_the_file(
        self, app, saved
    ):
        ctx = _ctx("explain chapter 2", media_ids=["m1"])
        plan, spans, trace = _route_only(
            _orch(_Supabase(media=FILES[:1]), _Planner(_plan("media_llm"))),
            ctx,
            saved,
        )
        assert plan["steps"][0]["tool"] == "media_llm"
        assert _rules_fired(spans) == []
        assert trace["plan_source"] == "planner"

    def test_media_guard_absent_for_a_fresh_web_search(self, app, saved):
        ctx = _ctx("latest news on chapter 2", media_ids=["m1"])
        plan, spans, trace = _route_only(
            _orch(_Supabase(media=FILES[:1]), _Planner(_plan("web_search"))),
            ctx,
            saved,
        )
        assert plan["steps"][0]["tool"] == "web_search"
        assert _rules_fired(spans) == []
        assert trace["plan_source"] == "planner"

    def test_media_guard_absent_without_files(self, app, saved):
        plan, spans, _trace = _route_only(
            _orch(_Supabase(), _Planner(_plan("general"))),
            _ctx("explain chapter 2"),
            saved,
        )
        assert plan["steps"][0]["tool"] == "general"
        assert _rules_fired(spans) == []

    def test_a_clarification_that_stands_records_no_clarify_rule(
        self, app, saved
    ):
        plan, spans, _trace = _route_only(
            _orch(_Supabase(), _Planner(CLARIFY)),
            _ctx("explain this to me in simple words"),
            saved,
        )
        assert plan["action"] == "clarify"
        assert _rules_fired(spans) == []

    def test_skipped_clarification_then_upgrade_are_in_order(self, app, saved):
        plan, spans, _trace = _route_only(
            _orch(_Supabase(), _Planner(CLARIFY)),
            _ctx("which is the best laptop?"),
            saved,
        )
        assert plan["steps"][0]["tool"] == "web_search"
        assert _rules_fired(spans) == ["clarify_skipped", "web_upgrade"]
        # The skip shows the fallback as it was BEFORE the upgrade.
        skipped = _one(spans, "clarify_skipped")
        assert skipped["output"]["steps"][0]["tool"] == "general"
        assert "_upgraded" not in skipped["output"]
        assert "general because" in skipped["meta"]["reason"]
        upgrade = _one(spans, "web_upgrade")
        assert upgrade["input"]["tool"] == "general"
        assert upgrade["output"]["tool"] == "web_search"

    def test_a_single_selected_file_skips_the_file_choice(self, app, saved):
        ctx = _ctx("summarise it", media_ids=["m1"])
        _plan_, spans, _trace = _route_only(
            _orch(_Supabase(media=FILES[:1]), _Planner(_plan("media_llm"))),
            ctx,
            saved,
        )
        assert _checked(_one(spans, "route"))[:2] == [
            ("forced", False),
            ("media_choice", False),
        ]
        assert not _named(spans, "media_choice")

    def test_all_files_named_is_not_a_file_choice(self, app, saved):
        ctx = _ctx("compare notes and slides", media_ids=["m1", "m2"])
        _plan_, spans, _trace = _route_only(
            _orch(_Supabase(media=FILES), _Planner(_plan("media_llm"))),
            ctx,
            saved,
        )
        assert ("media_choice", False) in _checked(_one(spans, "route"))
        assert not _named(spans, "media_choice")


class TestWebUpgradeCue:
    """The cue named in the reason is looked for in a bounded prefix."""

    def test_cue_is_named(self, saved):
        tracing.start_turn(user_id="u", message="m", endpoint="stream")
        AssistantOrchestrator._web_upgrade(
            _plan("general"), "what is the weather today?"
        )
        tracing.finish_turn()
        reason = _one(saved["spans"], "web_upgrade")["meta"]["reason"]
        assert 'fresh-information cue "weather"' in reason

    def test_a_cue_far_into_a_long_message_is_not_searched_for(
        self, saved, monkeypatch
    ):
        searched: list[int] = []
        real = turn_trace._engine()._PRODUCT_INTENT_RE

        class Spy:
            def search(self, text: str):
                searched.append(len(text))
                return real.search(text)

        message = "please help me decide. " * 400 + "best laptops?"
        plain = AssistantOrchestrator._web_upgrade(_plan("general"), message)
        tracing.start_turn(user_id="u", message="m", endpoint="stream")
        engine = turn_trace._engine()
        monkeypatch.setattr(
            turn_trace, "_engine", lambda: _Engine(engine, Spy())
        )
        traced = AssistantOrchestrator._web_upgrade(_plan("general"), message)
        tracing.finish_turn()

        assert traced == plain
        assert traced["steps"][0]["tool"] == "web_search"
        assert searched == [turn_trace._CUE_SCAN_CHARS]
        reason = _one(saved["spans"], "web_upgrade")["meta"]["reason"]
        assert "a product/choice or fresh-information cue" in reason

    def test_nothing_is_searched_without_a_trace(self, monkeypatch):
        def fail():
            raise AssertionError("trace detail computed without a trace")

        monkeypatch.setattr(turn_trace, "_engine", fail)
        plan = AssistantOrchestrator._web_upgrade(
            _plan("general"), "suggest the best iPhone 17 model"
        )
        assert plan["steps"][0]["tool"] == "web_search"


class _Engine:
    """The orchestrator module with one regex swapped for a spy."""

    def __init__(self, module: Any, product_re: Any) -> None:
        self._module = module
        self._PRODUCT_INTENT_RE = product_re

    def __getattr__(self, name: str) -> Any:
        return getattr(self._module, name)


class _FailingAnswer(_AnswerTool):
    """Streams one chunk, then fails: the runner keeps the partial answer."""

    def execute_stream(self, ctx: ToolContext, params: dict[str, Any]):
        yield "Osmosis moves "
        raise RuntimeError("provider dropped the stream")


class _FailingQuiz(_QuizTool):
    def execute(self, ctx: ToolContext, params: dict[str, Any]) -> dict:
        raise ValueError("quiz model returned garbage")


class _SlowQuiz(_QuizTool):
    def execute(self, ctx: ToolContext, params: dict[str, Any]) -> dict:
        time.sleep(0.8)
        return super().execute(ctx, params)


TEAM = {
    "action": "run_tool",
    "steps": [
        {"tool": "general", "params": {"query": "cells"}},
        {
            "tool": "quiz_generator",
            "params": {"topic": "cells", "question_count": 3},
            "input": "message",
        },
    ],
}


class TestPartialTurns:
    """Answered and saved, but a step failed or timed out: ``partial``."""

    def test_answer_that_failed_mid_stream(self, app, saved):
        supabase = _Supabase()
        orch = _orch(
            supabase, _Planner(_plan("general")), [_FailingAnswer("general")]
        )
        frames = _stream(orch, _ctx("what is osmosis?"))
        tracing.finish_turn()

        assert frames[-1]["done"] is True
        trace = saved["trace"]
        assert trace["status"] == "partial"
        assert trace["error"] == "general: RuntimeError"
        assert trace["meta"]["failed_steps"] == [
            {"step_id": "answer", "tool": "general", "error": "RuntimeError"}
        ]
        # The partial answer was saved and is linked like any other.
        assert trace["assistant_message_id"] == _msg_id(2)
        assert (
            supabase.by_role("assistant")[0]["metadata"]["trace_id"]
            == (trace["id"])
        )
        root = saved["spans"][0]
        assert root["status"] == "ok"
        assert root["meta"]["outcome"] == "partial"
        assert "lost the thread" in root["output"]["display_text"]

    def test_generator_that_failed(self, app, saved):
        orch = _orch(
            _Supabase(),
            _Planner(TEAM),
            [_AnswerTool("general"), _FailingQuiz()],
        )
        frames = _stream(orch, _ctx("explain cells and test me on them"))
        tracing.finish_turn()

        assert frames[-1]["tools_used"] == ["general"]
        trace = saved["trace"]
        assert trace["status"] == "partial"
        assert trace["error"] == "quiz_generator: ValueError"
        assert trace["meta"]["failed_steps"] == [
            {
                "step_id": "gen1",
                "tool": "quiz_generator",
                "error": "ValueError",
            }
        ]

    def test_generator_that_timed_out(self, saved):
        flask_app = _make_app()
        flask_app.config["AGENT_STEP_TIMEOUT_S"] = 0.1
        with flask_app.app_context():
            orch = _orch(
                _Supabase(),
                _Planner(TEAM),
                [_AnswerTool("general"), _SlowQuiz()],
            )
            result = orch.run(_ctx("explain cells and test me on them"))
            tracing.finish_turn()

        assert result.status == RunStatus.COMPLETED
        assert saved["trace"]["status"] == "partial"
        assert saved["trace"]["error"] == "quiz_generator: timeout"
        assert saved["trace"]["endpoint"] == "sync"

    def test_all_steps_fine_is_completed_without_an_error(self, app, saved):
        orch = _orch(_Supabase(), _Planner(TEAM))
        frames = _stream(orch, _ctx("explain cells and test me on them"))
        tracing.finish_turn()

        assert frames[-1]["tools_used"] == ["general", "quiz_generator"]
        assert saved["trace"]["status"] == "completed"
        assert saved["trace"]["error"] is None
        assert "failed_steps" not in saved["trace"]["meta"]


# ------------------------------------------------ what the user receives


class TestBehaviourPreserved:
    MESSAGE = "what is osmosis?"

    def _turn(self, *, debug: bool = False):
        supabase = _Supabase(debug=debug, title="New chat")
        orch = _orch(supabase, _Planner(_plan("general")))
        frames = _stream(orch, _ctx(self.MESSAGE))
        return supabase, frames

    def test_metadata_links_the_trace_only_when_tracing(
        self, app, saved, monkeypatch
    ):
        supabase, _frames_ = self._turn()
        trace_id = tracing.finish_turn()
        metadata = supabase.by_role("assistant")[0]["metadata"]
        assert trace_id
        assert metadata["trace_id"] == trace_id == saved["trace"]["id"]
        assert _one(saved["spans"], "assistant_message")["output"] == {
            "message_id": _msg_id(2),
            "title_updated": True,
        }

        monkeypatch.setenv("AI_TRACE_ENABLED", "false")
        supabase, _frames_ = self._turn()
        assert not tracing.is_active()
        assert tracing.finish_turn() is None
        assert saved["writes"] == 1
        metadata = supabase.by_role("assistant")[0]["metadata"]
        assert "trace_id" not in metadata
        assert set(metadata) == {
            "status",
            "tool_used",
            "tools_used",
            "content",
        }

    def test_frames_and_writes_are_identical_with_tracing_off(
        self, app, saved, monkeypatch
    ):
        traced_db, traced = self._turn()
        tracing.finish_turn()
        assert saved["writes"] == 1

        monkeypatch.setenv("AI_TRACE_ENABLED", "false")
        plain_db, plain = self._turn()
        assert saved["writes"] == 1

        assert _stable(plain) == _stable(traced)
        assert plain_db.calls == traced_db.calls
        # The shape the client depends on, spelled out.
        assert [f.get("type") for f in plain[:3]] == [
            "agents_planned",
            "tool_selected",
            "agent_status",
        ]
        text = "".join(
            f["content"] for f in plain if isinstance(f["content"], str)
        )
        assert text == "".join(ANSWER)
        done = plain[-1]
        assert done["done"] is True
        assert done["tool_used"] == "general"
        assert done["tools_used"] == ["general"]
        assert done["content"]["answer"] == "".join(ANSWER)
        assert "debug" not in done["content"]
        assert "trace_id" not in json.dumps(plain)
        assert ("update_session", SESSION, USER, {"title": self.MESSAGE}) in (
            plain_db.calls
        )

    def test_debug_block_carries_the_trace_id_only_when_tracing(
        self, app, saved, monkeypatch
    ):
        _db, frames = self._turn(debug=True)
        trace_id = tracing.finish_turn()
        debug = frames[-1]["content"]["debug"]
        assert debug["trace_id"] == trace_id
        assert saved["trace"]["meta"]["is_debug_user"] is True
        assert _one(saved["spans"], "finish_turn")["output"]["badge"] is True

        monkeypatch.setenv("AI_TRACE_ENABLED", "false")
        _db, frames = self._turn(debug=True)
        debug = frames[-1]["content"]["debug"]
        assert "trace_id" not in debug
        assert debug["plan_source"] == "planner"

    def test_debug_users_scope_drops_other_users_traces(
        self, app, saved, monkeypatch
    ):
        monkeypatch.setenv("AI_TRACE_SCOPE", "debug_users")
        self._turn()
        assert tracing.finish_turn() is None
        assert saved["writes"] == 0

        self._turn(debug=True)
        assert tracing.finish_turn() == saved["trace"]["id"]


# ------------------------------------------------------- non-streaming


class TestSyncRun:
    def test_run_records_a_sync_turn(self, app, saved):
        supabase = _Supabase()
        orch = _orch(supabase, _Planner(_plan("general")))
        result = orch.run(_ctx("what is osmosis?"))
        assert saved["writes"] == 0
        tracing.finish_turn()

        assert result.status == RunStatus.COMPLETED
        assert result.message_id == _msg_id(2)
        assert result.display_text == "".join(ANSWER)
        trace = saved["trace"]
        assert trace["endpoint"] == "sync"
        assert trace["status"] == "completed"
        assert trace["assistant_message_id"] == _msg_id(2)
        assert (
            supabase.by_role("assistant")[0]["metadata"]["trace_id"]
            == (trace["id"])
        )

    def test_run_failure_is_traced_and_propagates(self, app, saved):
        orch = _orch(_Supabase(), _Planner(error=ValueError("bad plan")))
        with pytest.raises(ValueError, match="bad plan"):
            orch.run(_ctx("what is osmosis?"))
        tracing.finish_turn()
        assert saved["trace"]["status"] == "error"
        assert saved["trace"]["error"] == "ValueError: bad plan"

    def test_run_clarification_and_quiz_setup(self, app, saved):
        orch = _orch(_Supabase(), _Planner(CLARIFY))
        result = orch.run(_ctx("explain this to me in simple words"))
        tracing.finish_turn()
        assert result.status == RunStatus.CLARIFICATION_REQUIRED
        assert saved["trace"]["status"] == "clarification"
        assert saved["trace"]["run_id"] == RUN_ID

        orch = _orch(_Supabase(), _Planner(_plan("general")))
        result = orch.run(_ctx("quiz me"))
        tracing.finish_turn()
        assert result.status == RunStatus.QUIZ_SETUP
        assert saved["trace"]["status"] == "quiz_setup"


class TestRepositoryOutsideARequest:
    """No response to flush after: the trace is dropped, not written early.

    (The JSON endpoints write it after the response went out; see
    ``TestJsonEndpointFlush``.)
    """

    USER_DATA = UserData(id=USER, email="a@example.com")

    def _request(self, message: str) -> AssistantRequestData:
        return AssistantRequestData(session_id=SESSION, message=message)

    def test_process_returns_the_answer_and_writes_nothing(
        self, app, saved, monkeypatch
    ):
        orch = _orch(_Supabase(), _Planner(_plan("general")))
        monkeypatch.setattr(
            assistant_repository, "AssistantOrchestrator", lambda: orch
        )
        response = AssistantRepository.process(
            self.USER_DATA, self._request("what is osmosis?")
        )
        assert response["data"]["status"] == "completed"
        assert response["data"]["message_id"] == _msg_id(2)
        assert saved["writes"] == 0
        assert not tracing.is_active()

    def test_a_failed_turn_propagates_and_writes_nothing(
        self, app, saved, monkeypatch
    ):
        orch = _orch(_Supabase(), _Planner(error=RuntimeError("boom")))
        monkeypatch.setattr(
            assistant_repository, "AssistantOrchestrator", lambda: orch
        )
        with pytest.raises(RuntimeError, match="boom"):
            AssistantRepository.process(
                self.USER_DATA, self._request("what is osmosis?")
            )
        assert saved["writes"] == 0
        assert not tracing.is_active()

    def test_process_is_unchanged_with_tracing_off(
        self, app, saved, monkeypatch
    ):
        monkeypatch.setenv("AI_TRACE_ENABLED", "false")
        orch = _orch(_Supabase(), _Planner(_plan("general")))
        monkeypatch.setattr(
            assistant_repository, "AssistantOrchestrator", lambda: orch
        )
        response = AssistantRepository.process(
            self.USER_DATA, self._request("what is osmosis?")
        )
        assert response == {
            "msg": "OK",
            "data": {
                "status": "completed",
                "tool_used": "general",
                "content": response["data"]["content"],
                "message_id": _msg_id(2),
            },
        }
        assert saved["writes"] == 0


# ------------------------------------------------------ routing decisions


def _route_only(orch: AssistantOrchestrator, ctx: AssistantContext, saved):
    """Trace just ``_setup_and_plan`` and return (plan, spans, trace)."""
    tracing.start_turn(user_id=USER, message=ctx.message, endpoint="stream")
    plan = orch._setup_and_plan(ctx)[3]
    tracing.finish_turn()
    return plan, saved["spans"], saved["trace"]


FILES = [
    {"id": "m1", "file_name": "notes.pdf"},
    {"id": "m2", "file_name": "slides.pptx"},
]


class TestRoutingDecisions:
    def test_forced_by_quiz_options(self, app, saved):
        llm = _Planner(_plan("general"))
        ctx = _ctx("quiz me", quiz_options=QuizOptions(topic="cells"))
        plan, spans, trace = _route_only(_orch(_Supabase(), llm), ctx, saved)

        assert llm.calls == []
        assert plan["_source"] == "forced"
        route = _one(spans, "route")
        assert _checked(route) == [("forced", True)]
        decision = _one(spans, "forced_plan")
        assert decision["parent_id"] == route["id"]
        assert "quiz_options" in decision["meta"]["reason"]
        assert decision["output"]["steps"][0]["tool"] == "quiz_generator"
        assert trace["plan_source"] == "forced"

    def test_forced_quiz_runs_and_keeps_the_options_as_turn_input(
        self, app, saved
    ):
        options = QuizOptions(
            topic="cells", question_count=5, difficulty="easy"
        )
        quiz = _QuizTool()
        orch = _orch(_Supabase(), _Planner(), [_AnswerTool("general"), quiz])
        frames = _stream(orch, _ctx("quiz me", quiz_options=options))
        tracing.finish_turn()

        assert frames[-1]["tools_used"] == ["quiz_generator"]
        assert quiz.calls == [
            {"topic": "cells", "question_count": 5, "difficulty": "easy"}
        ]
        spans = saved["spans"]
        turn_input = spans[0]["input"]
        assert turn_input["quiz_options"]["topic"] == "cells"
        assert turn_input["quiz_options"]["question_count"] == 5
        assert _one(spans, "outcome")["output"]["outcome"] == "run_tools"
        roster = _one(spans, "normalize_steps")
        assert roster["meta"]["generator_input"].startswith("message")
        assert saved["trace"]["status"] == "completed"
        assert saved["trace"]["tools"] == ["quiz_generator"]

    def test_forced_by_flashcard_options(self, app, saved):
        ctx = _ctx("make cards", flashcard_options=FlashcardOptions(count=5))
        _plan_, spans, _trace = _route_only(
            _orch(_Supabase(), _Planner()), ctx, saved
        )
        reason = _one(spans, "forced_plan")["meta"]["reason"]
        assert "flashcard_options" in reason

    def test_forced_by_a_resolved_file_choice(self, app, saved):
        run = {
            "id": RUN_ID,
            "original_message": "summarise it",
            "plan": {
                "kind": "media_choice",
                "files": [{"id": "m1", "name": "notes.pdf"}],
                "clarification": {
                    "questions": [{"id": "media_choice", "text": "Choose"}]
                },
            },
        }
        supabase = _Supabase(run=run, media=FILES)
        ctx = _ctx(
            "notes.pdf",
            media_ids=["m1", "m2"],
            run_id=RUN_ID,
            clarification=UserClarificationResponse(
                action=ClarificationAction.ANSWER,
                answers={"media_choice": "notes.pdf"},
            ),
        )
        plan, spans, trace = _route_only(
            _orch(supabase, _Planner()), ctx, saved
        )

        assert plan["steps"][0]["params"] == {
            "media_ids": ["m1"],
            "query": "summarise it",
        }
        reason = _one(spans, "forced_plan")["meta"]["reason"]
        assert "which file?" in reason
        assert trace["run_id"] == RUN_ID
        resume = _one(spans, "load_context")["output"]["clarification_resume"]
        assert resume["run_id"] == RUN_ID
        assert resume["original_message"] == "summarise it"
        assert resume["plan_kind"] == "media_choice"
        assert resume["media_choice_ids"] == ["m1"]
        assert resume["response"]["answers"] == {"media_choice": "notes.pdf"}
        # A clarification reply saves no user bubble; the trace says so.
        user = _one(spans, "user_message")
        assert user["status"] == "skipped"
        assert supabase.added == []
        assert trace["user_message_id"] is None

    def test_media_choice_asks_which_file(self, app, saved):
        llm = _Planner(_plan("general"))
        ctx = _ctx("summarise it", media_ids=["m1", "m2"])
        plan, spans, trace = _route_only(
            _orch(_Supabase(media=FILES), llm), ctx, saved
        )

        assert llm.calls == []
        assert plan["action"] == "clarify"
        assert plan["_source"] == "media_choice"
        route = _one(spans, "route")
        assert _checked(route) == [
            ("forced", False),
            ("media_choice", True),
        ]
        decision = _one(spans, "media_choice")
        assert decision["parent_id"] == route["id"]
        reason = decision["meta"]["reason"]
        assert "notes.pdf" in reason
        assert "slides.pptx" in reason
        assert "names none" in reason
        assert decision["output"]["kind"] == "media_choice"
        assert route["output"]["source"] == "media_choice"
        assert route["output"]["action"] == "clarify"
        assert trace["plan_action"] == "clarify"

    def test_media_choice_narrows_to_the_named_file(self, app, saved):
        ctx = _ctx("summarise notes.pdf", media_ids=["m1", "m2"])
        plan, spans, _trace = _route_only(
            _orch(_Supabase(media=FILES), _Planner()), ctx, saved
        )
        assert plan["steps"][0] == {
            "tool": "media_llm",
            "params": {"media_ids": ["m1"]},
        }
        reason = _one(spans, "media_choice")["meta"]["reason"]
        assert reason.startswith("The message names notes.pdf")

    def test_continuation_names_the_cue_and_the_tool(self, app, saved):
        history = [
            {"role": "user", "content": "quiz me", "metadata": {}},
            {
                "role": "assistant",
                "content": "Here is a quiz",
                "metadata": {"tool_used": "quiz_generator"},
            },
        ]
        llm = _Planner(_plan("general"))
        plan, spans, trace = _route_only(
            _orch(_Supabase(messages=history), llm), _ctx("another one"), saved
        )

        assert llm.calls == []
        assert plan["steps"][0]["tool"] == "quiz_generator"
        reason = _one(spans, "continuation")["meta"]["reason"]
        assert '"another"' in reason
        assert "quiz_generator" in reason
        assert trace["plan_source"] == "continuation"
        assert _checked(_one(spans, "route"))[-1] == ("continuation", True)
        assert _one(spans, "load_context")["output"]["history_messages"] == 2

    def test_clarify_skipped_by_the_over_clarification_guard(self, app, saved):
        plan, spans, trace = _route_only(
            _orch(_Supabase(), _Planner(CLARIFY)),
            _ctx("what is osmosis?"),
            saved,
        )

        assert plan["action"] == "run_tool"
        assert _one(spans, "planner_output")["output"] == CLARIFY
        skipped = _one(spans, "clarify_skipped")
        assert skipped["input"] == CLARIFY
        assert skipped["output"]["steps"][0]["tool"] == "general"
        assert "general because" in skipped["meta"]["reason"]
        assert trace["plan_source"] == "planner"
        assert trace["plan_action"] == "run_tool"
        route = _one(spans, "route")
        assert route["output"]["plan"]["steps"][0]["tool"] == "general"

    def test_clarify_blocked_after_a_clarification_reply(self, app, saved):
        run = {
            "id": RUN_ID,
            "original_message": "explain this",
            "plan": CLARIFY,
        }
        ctx = _ctx(
            "skip",
            run_id=RUN_ID,
            clarification=UserClarificationResponse(
                action=ClarificationAction.SKIP
            ),
        )
        plan, spans, _trace = _route_only(
            _orch(_Supabase(run=run), _Planner(CLARIFY)), ctx, saved
        )

        assert plan["action"] == "run_tool"
        blocked = _one(spans, "clarify_blocked")
        assert blocked["input"]["action"] == "clarify"
        assert blocked["output"]["steps"][0]["tool"] == "general"
        assert "already responded" in blocked["meta"]["reason"]
        assert not _named(spans, "clarify_skipped")
        assert _one(spans, "route")["input"]["has_clarification"] is True
        enriched = _one(spans, "load_context")["output"]["enriched_message"]
        assert enriched.startswith("explain this")
        assert "skipped the clarifying questions" in enriched

    def test_media_guard_diverts_to_the_selected_file(self, app, saved):
        ctx = _ctx("explain chapter 2", media_ids=["m1"])
        plan, spans, trace = _route_only(
            _orch(_Supabase(media=FILES[:1]), _Planner(_plan("general"))),
            ctx,
            saved,
        )

        assert plan["steps"][0]["tool"] == "media_llm"
        guard = _one(spans, "media_guard")
        assert guard["input"]["tool"] == "general"
        assert guard["output"] == {
            "tool": "media_llm",
            "params": {"query": "q", "media_ids": ["m1"]},
        }
        assert "1 file(s) are selected" in guard["meta"]["reason"]
        assert "not small talk" in guard["meta"]["reason"]
        assert trace["plan_source"] == "planner+media_guard"
        assert _one(spans, "planner_output")["output"] == _plan("general")

    def test_standing_language_request_is_recorded(self, app, saved):
        supabase = _Supabase()
        ctx = _ctx("from now on talk in Hinglish about osmosis")
        _route_only(_orch(supabase, _Planner(_plan("general"))), ctx, saved)

        out = _one(saved["spans"], "load_context")["output"]
        assert out["standing_language_request"] == "Hinglish"
        assert out["preferred_language"] == "Hinglish"
        assert "Hinglish" in out["personalization"]
        assert (
            "update_learning_profile",
            USER,
            {"preferred_language": "Hinglish"},
        ) in supabase.calls

    def test_source_content_is_part_of_the_loaded_context(self, app, saved):
        ctx = _ctx("explain", source_content="Cells have membranes.")
        _plan_, spans, _trace = _route_only(
            _orch(_Supabase(), _Planner(_plan("general"))), ctx, saved
        )
        out = _one(spans, "load_context")["output"]
        assert out["source_content"] is True
        assert "Cells have membranes." in out["enriched_message"]


class TestNormalizeSteps:
    def test_dropped_degraded_and_ignored(self, app, saved, monkeypatch):
        monkeypatch.setattr(
            feature_flag_service,
            "get_flags",
            lambda: {"web_search": False, "image_generation": False},
        )
        plan = {
            "action": "run_tool",
            "steps": [
                {"tool": "web_search", "params": {"query": "x"}},
                {"tool": "image_generator", "params": {"prompt": "cell"}},
                {"tool": "media_llm", "params": {}},
                {"tool": "made_up", "params": {}},
                {"tool": "quiz_generator", "params": {"topic": "cells"}},
            ],
        }
        orch = _orch(_Supabase(), _Planner())
        tracing.start_turn(user_id=USER, message="m", endpoint="stream")
        steps = orch._normalize_steps(plan, "m")
        tracing.finish_turn()

        assert [(s.id, s.tool, s.input) for s in steps] == [
            ("answer", "general", "message"),
            ("gen1", "quiz_generator", "answer"),
        ]
        assert plan["_dropped"] == ["image_generator"]
        roster = _one(saved["spans"], "normalize_steps")
        assert [s["tool"] for s in roster["input"]] == [
            "web_search",
            "image_generator",
            "media_llm",
            "made_up",
            "quiz_generator",
        ]
        assert [s["tool"] for s in roster["output"]["steps"]] == [
            "general",
            "quiz_generator",
        ]
        assert roster["output"]["dropped"] == ["image_generator"]
        assert roster["meta"]["degraded"] == [
            {"tool": "web_search", "to": "general", "why": "flag off"}
        ]
        assert roster["meta"]["ignored"] == ["media_llm", "made_up"]

    def test_a_disabled_tool_after_the_answer_is_ignored_not_degraded(
        self, app, saved, monkeypatch
    ):
        # web_search is off, but it comes after the real answer step: it is
        # dropped as a second answer tool and degrades nothing.
        monkeypatch.setattr(
            feature_flag_service,
            "get_flags",
            lambda: {"web_search": False, "image_generation": True},
        )
        plan = {
            "action": "run_tool",
            "steps": [
                {"tool": "general", "params": {"query": "x"}},
                {"tool": "web_search", "params": {"query": "x"}},
            ],
        }
        orch = _orch(_Supabase(), _Planner())
        tracing.start_turn(user_id=USER, message="m", endpoint="stream")
        steps = orch._normalize_steps(plan, "m")
        tracing.finish_turn()

        assert [s.tool for s in steps] == ["general"]
        roster = _one(saved["spans"], "normalize_steps")
        assert roster["meta"]["degraded"] == []
        assert roster["meta"]["ignored"] == ["web_search"]
        assert roster["output"]["dropped"] == []
        assert "_dropped" not in plan

    def test_clamped_models_are_listed_in_plan_order(self, app, saved):
        plan = {
            "action": "run_tool",
            "steps": [
                {"tool": "quiz_generator", "model": "bogus", "params": {}},
                {"tool": "general", "model": "strong-model", "params": {}},
                {"tool": "quiz_generator", "model": "other", "params": {}},
                {"tool": "media_llm", "model": "bogus", "params": {}},
            ],
        }
        orch = _orch(_Supabase(), _Planner())
        tracing.start_turn(user_id=USER, message="m", endpoint="stream")
        steps = orch._normalize_steps(plan, "m")
        tracing.finish_turn()

        assert [(s.tool, s.model) for s in steps] == [
            ("general", "strong-model"),
            ("quiz_generator", "quiz-model"),
        ]
        roster = _one(saved["spans"], "normalize_steps")
        # Only the steps that made the roster can have been clamped.
        assert roster["meta"]["clamped"] == [
            {
                "tool": "quiz_generator",
                "requested": "bogus",
                "used": "quiz-model",
            }
        ]
        assert roster["meta"]["ignored"] == ["media_llm"]
        assert "defaulted" not in roster["meta"]

    def test_the_roster_is_the_same_with_and_without_a_trace(self, app, saved):
        def roster() -> tuple[list, dict]:
            plan = copy.deepcopy(TEAM)
            plan["steps"].append({"tool": "image_generator", "params": {}})
            steps = _orch(_Supabase(), _Planner())._normalize_steps(plan, "m")
            return steps, plan

        plain = roster()
        tracing.start_turn(user_id=USER, message="m", endpoint="stream")
        traced = roster()
        tracing.finish_turn()
        assert traced == plain

    def test_empty_plan_defaults_to_general(self, app, saved):
        orch = _orch(_Supabase(), _Planner())
        tracing.start_turn(user_id=USER, message="m", endpoint="stream")
        steps = orch._normalize_steps({"action": "run_tool"}, "m")
        tracing.finish_turn()

        assert [s.tool for s in steps] == ["general"]
        roster = _one(saved["spans"], "normalize_steps")
        assert roster["input"] == []
        assert "general" in roster["meta"]["defaulted"]

    def test_generators_alone_run_from_the_message(self, app, saved):
        orch = _orch(_Supabase(), _Planner())
        plan = {"action": "run_tool", "steps": [{"tool": "quiz_generator"}]}
        tracing.start_turn(user_id=USER, message="m", endpoint="stream")
        steps = orch._normalize_steps(plan, "m")
        tracing.finish_turn()

        assert [(s.tool, s.input) for s in steps] == [
            ("quiz_generator", "message")
        ]
        roster = _one(saved["spans"], "normalize_steps")
        assert "message" in roster["meta"]["generator_input"]


# ------------------------------------------- with mocks / without a turn


class TestWithMocks:
    """Private helpers are called directly with MagicMock collaborators."""

    def _orch(self) -> AssistantOrchestrator:
        return AssistantOrchestrator(
            llm=MagicMock(), registry=MagicMock(), supabase=MagicMock()
        )

    def test_rules_return_the_same_values_inside_a_trace(self, saved):
        ctx = AssistantContext(user_id="u", session_id="s", message="m")
        msg = "suggest the best iPhone 17 model for a student"

        def rewrite() -> tuple[dict, dict]:
            upgraded = AssistantOrchestrator._web_upgrade(_plan("general"), msg)
            guarded = AssistantOrchestrator._media_routing_guard(
                _plan("general"),
                AssistantContext(
                    user_id="u", session_id="s", message="m", media_ids=["m1"]
                ),
                "explain chapter 2",
            )
            return upgraded, guarded

        plain = rewrite()
        assert (
            self._orch()._refine_plan(_plan("general"), ctx, msg, [])
            == (plain[0])
        )

        tracing.start_turn(user_id="u", message=msg, endpoint="stream")
        traced = rewrite()
        refined = self._orch()._refine_plan(_plan("general"), ctx, msg, [])
        tracing.finish_turn()

        assert traced == plain
        assert refined == plain[0]
        assert plain[0]["steps"][0]["tool"] == "web_search"
        assert plain[0]["_upgraded"] is True
        assert plain[1]["steps"][0]["tool"] == "media_llm"
        assert plain[1]["_source"] == "planner+media_guard"
        names = [s["name"] for s in saved["spans"]]
        assert names.count("web_upgrade") == 2
        assert names.count("media_guard") == 1

    def test_message_id_is_used_only_when_it_is_a_string(self, saved):
        tracing.start_turn(user_id="u", message="m", endpoint="stream")
        row = MagicMock()
        assert turn_trace.user_message(row) is row
        tracing.finish_turn()

        assert saved["trace"]["user_message_id"] is None
        assert _one(saved["spans"], "user_message")["output"] == {
            "message_id": None
        }

    def test_setup_and_plan_survives_mocks_inside_a_trace(self, app, saved):
        orch = self._orch()
        orch.supabase.get_profile.return_value = {}
        orch.supabase.get_session.return_value = {"id": "s", "title": "T"}
        orch.supabase.get_messages.return_value = []
        orch.registry.list_definitions.return_value = []
        tracing.start_turn(user_id="u", message="m", endpoint="stream")
        plan = orch._setup_and_plan(
            AssistantContext(
                user_id="u", session_id="s", message="explain photosynthesis"
            )
        )[3]
        tracing.finish_turn()

        assert plan is orch.llm.generate_structured.return_value
        # A mock row has no usable id: the trace column stays empty.
        assert saved["trace"]["user_message_id"] is None
        assert _one(saved["spans"], "route")["status"] == "ok"
        json.dumps(saved["spans"])  # everything recorded is plain JSON

    def test_inputs_the_trace_cannot_digest_never_reach_the_turn(
        self, app, saved
    ):
        orch = self._orch()
        tracing.start_turn(user_id="u", message="m", endpoint="stream")
        # A plan of mocks: the rules see nothing to rewrite and return it.
        plan = MagicMock()
        assert AssistantOrchestrator._web_upgrade(plan, "best phone") is plan
        ctx = AssistantContext(
            user_id="u", session_id="s", message="m", media_ids=["m1"]
        )
        assert AssistantOrchestrator._media_routing_guard(plan, ctx, "x") is (
            plan
        )
        # The planner answering ``None`` fails exactly as it does untraced.
        with pytest.raises(AttributeError):
            orch._refine_plan(None, ctx, "m", [])
        tracing.finish_turn()
        assert saved["trace"]["status"] == "completed"

    def test_nothing_is_recorded_without_a_turn(self, app, saved):
        orch = _orch(_Supabase(), _Planner(_plan("general")))
        plan = orch._setup_and_plan(_ctx("what is osmosis?"))[3]
        assert plan["_source"] == "planner"
        assert not tracing.is_active()
        assert tracing.finish_turn() is None
        assert saved["writes"] == 0


# ------------------------------------------- the flush in the controllers

_SENTRY_STUBS = (
    "sentry_sdk",
    "sentry_sdk.integrations",
    "sentry_sdk.integrations.flask",
)
# Modules that (transitively) import sentry_sdk; dropped again after the test
# so a stubbed import never leaks into the rest of the suite.
_SENTRY_DEPENDENTS = (
    "aeva.common.sentry",
    "aeva.common.decorators",
    "aeva.assistant.assistant_controller",
    "aeva.chat.chat_controller",
)


@pytest.fixture
def controllers(monkeypatch):
    """Import both stream controllers (stubbing sentry_sdk if absent)."""
    stubbed = importlib.util.find_spec("sentry_sdk") is None
    if stubbed:
        for name in _SENTRY_STUBS:
            monkeypatch.setitem(sys.modules, name, MagicMock())
    assistant = importlib.import_module("aeva.assistant.assistant_controller")
    chat = importlib.import_module("aeva.chat.chat_controller")
    decorators = importlib.import_module("aeva.common.decorators")

    auth = MagicMock()
    auth.return_value.verify_token.return_value = {"id": USER, "email": "e"}
    monkeypatch.setattr(decorators, "SupabaseService", auth)
    yield {"/assistant/stream": assistant, "/chat/stream": chat}
    if stubbed:
        for name in _SENTRY_DEPENDENTS:
            sys.modules.pop(name, None)
            parent, _, child = name.rpartition(".")
            if hasattr(sys.modules.get(parent), child):
                delattr(sys.modules[parent], child)


def _http_app(controllers: dict, *, testing: bool = True) -> Flask:
    from flask_smorest import Api

    app = _make_app()
    app.config.update(
        API_TITLE="t",
        API_VERSION="v1",
        OPENAPI_VERSION="3.0.2",
        TESTING=testing,
    )
    api = Api(app)
    for module in controllers.values():
        api.register_blueprint(module.blueprint)
    return app


def _open_stream(app: Flask, url: str, message: str):
    response = app.test_client().post(
        url,
        json={"session_id": SESSION, "message": message},
        headers={"Authorization": "Bearer token"},
        buffered=False,
    )
    assert response.status_code == 200
    return response


@pytest.mark.filterwarnings("ignore::DeprecationWarning")
@pytest.mark.parametrize("url", ["/assistant/stream", "/chat/stream"])
class TestControllerFlush:
    """``finish_turn`` runs in the controller, after the last frame."""

    def _serve(self, monkeypatch, controllers, llm: _Planner) -> Flask:
        orch = _orch(_Supabase(), llm)
        monkeypatch.setattr(
            assistant_repository, "AssistantOrchestrator", lambda: orch
        )
        return _http_app(controllers)

    def test_trace_is_written_after_the_done_frame(
        self, url, controllers, saved, monkeypatch
    ):
        app = self._serve(monkeypatch, controllers, _Planner(_plan("general")))
        response = _open_stream(app, url, "what is osmosis?")
        chunks = iter(response.response)
        frames = []
        for chunk in chunks:
            frames.append(json.loads(chunk.decode()[len("data: ") :]))
            # Nothing is written while frames are still being handed out,
            # the done frame included.
            assert saved["writes"] == 0
            if frames[-1].get("done"):
                break
        assert next(chunks, None) is None
        assert saved["writes"] == 1
        assert saved["trace"]["status"] == "completed"
        assert saved["trace"]["endpoint"] == "stream"
        assert frames[-1]["tool_used"] == "general"

    def test_trace_is_written_after_the_error_frame(
        self, url, controllers, saved, monkeypatch
    ):
        app = self._serve(
            monkeypatch, controllers, _Planner(error=RuntimeError("503 down"))
        )
        response = _open_stream(app, url, "what is osmosis?")
        chunks = iter(response.response)
        frame = json.loads(next(chunks).decode()[len("data: ") :])
        assert frame == {
            "type": "error",
            "error": (
                "The assistant is overloaded right now. "
                "Please try again shortly."
            ),
            "code": "OVERLOADED",
        }
        assert saved["writes"] == 0
        assert next(chunks, None) is None
        assert saved["writes"] == 1
        assert saved["trace"]["status"] == "error"
        assert saved["trace"]["error"] == "RuntimeError: 503 down"

    def test_trace_is_written_when_the_client_disconnects(
        self, url, controllers, saved, monkeypatch
    ):
        app = self._serve(monkeypatch, controllers, _Planner(_plan("general")))
        response = _open_stream(app, url, "what is osmosis?")
        chunks = iter(response.response)
        next(chunks)
        assert saved["writes"] == 0
        response.close()
        assert saved["writes"] == 1
        assert saved["trace"]["status"] == "aborted"


@pytest.mark.filterwarnings("ignore::DeprecationWarning")
@pytest.mark.parametrize("url", ["/assistant/", "/chat/"])
class TestJsonEndpointFlush:
    """The JSON routes write the trace after the response went out."""

    def _post(self, url, monkeypatch, controllers, llm: _Planner, **app_kwargs):
        orch = _orch(_Supabase(), llm)
        monkeypatch.setattr(
            assistant_repository, "AssistantOrchestrator", lambda: orch
        )
        app = _http_app(controllers, **app_kwargs)
        return app.test_client().post(
            url,
            json={"session_id": SESSION, "message": "what is osmosis?"},
            headers={"Authorization": "Bearer token"},
            buffered=False,
        )

    def test_trace_is_written_only_after_the_body_was_sent(
        self, url, controllers, saved, monkeypatch
    ):
        response = self._post(
            url, monkeypatch, controllers, _Planner(_plan("general"))
        )
        assert response.status_code == 200
        # The turn is over and the response exists: nothing written yet.
        assert saved["writes"] == 0
        body = json.loads(b"".join(response.response))
        assert body["data"]["status"] == "completed"
        assert saved["writes"] == 0
        # The server closes the response once the body went out.
        response.close()
        assert saved["writes"] == 1
        assert saved["trace"]["status"] == "completed"
        assert saved["trace"]["endpoint"] == "sync"
        assert not tracing.is_active()

    def test_trace_of_a_failed_turn_is_written_after_the_error_response(
        self, url, controllers, saved, monkeypatch
    ):
        response = self._post(
            url,
            monkeypatch,
            controllers,
            _Planner(error=RuntimeError("planner down")),
            testing=False,
        )
        assert response.status_code == 500
        assert saved["writes"] == 0
        response.close()
        assert saved["writes"] == 1
        assert saved["trace"]["status"] == "error"
        assert saved["trace"]["error"] == "RuntimeError: planner down"

    def test_closing_from_another_thread_still_writes_the_trace(
        self, url, controllers, saved, monkeypatch
    ):
        response = self._post(
            url, monkeypatch, controllers, _Planner(_plan("general"))
        )
        closer = threading.Thread(target=response.close)
        closer.start()
        closer.join()
        assert saved["writes"] == 1
        assert saved["trace"]["status"] == "completed"

    def test_nothing_is_written_with_tracing_off(
        self, url, controllers, saved, monkeypatch
    ):
        monkeypatch.setenv("AI_TRACE_ENABLED", "false")
        response = self._post(
            url, monkeypatch, controllers, _Planner(_plan("general"))
        )
        assert json.loads(b"".join(response.response))["data"]["status"] == (
            "completed"
        )
        response.close()
        assert saved["writes"] == 0


# ------------------------------------- a tracing fault never reaches a turn

_TRACE_INTERNALS = (
    "_context_loaded",
    "_saved_message",
    "_route_begin",
    "_checked",
    "_decide",
    "_steps",
    "_route_output",
    "_roster_meta",
    "_failed_steps",
    "_arguments",
    "_turn_input",
)


class TestTracingFaults:
    """Whatever breaks inside the service, the user gets the same turn."""

    MESSAGE = "suggest the best iPhone 17 model for a student"

    def _turn(self) -> tuple[list[dict], list[tuple]]:
        supabase = _Supabase(title="New chat")
        orch = _orch(supabase, _Planner(_plan("general")))
        return _stable(_stream(orch, _ctx(self.MESSAGE))), supabase.calls

    @pytest.mark.parametrize("name", _TRACE_INTERNALS)
    def test_a_broken_trace_helper(self, app, saved, monkeypatch, name):
        monkeypatch.setenv("AI_TRACE_ENABLED", "false")
        plain = self._turn()
        monkeypatch.setenv("AI_TRACE_ENABLED", "true")

        def broken(*_args: Any, **_kwargs: Any) -> None:
            raise RuntimeError(f"bug in {name}")

        monkeypatch.setattr(turn_trace, name, broken)
        traced = self._turn()
        tracing.finish_turn()

        assert _untraced(traced[0]) == plain[0]
        assert traced[1] == plain[1]

    def test_a_broken_personalization_breakdown(self, app, saved, monkeypatch):
        def broken(*_args: Any) -> None:
            raise RuntimeError("bug in explain")

        monkeypatch.setattr(turn_trace.prompt_trace, "explain", broken)
        frames, _calls = self._turn()
        tracing.finish_turn()
        assert frames[-1]["done"] is True
        assert saved["trace"]["status"] == "completed"
        # Only the breakdown is lost; the rest of the context is recorded.
        context = _one(saved["spans"], "load_context")
        assert context["status"] == "ok"
        assert context["output"]["personalization_parts"] is None
        assert "Asha" in context["output"]["personalization"]
        assert (
            _one(saved["spans"], "route")["parent_id"]
            == (saved["spans"][0]["id"])
        )

    def test_a_context_that_cannot_be_recorded_still_closes_its_span(
        self, app, saved, monkeypatch
    ):
        def broken(*_args: Any) -> None:
            raise RuntimeError("bug in _context_loaded")

        monkeypatch.setattr(turn_trace, "_context_loaded", broken)
        self._turn()
        tracing.finish_turn()
        spans = saved["spans"]
        assert _one(spans, "load_context")["status"] == "ok"
        # Routing is not nested under the context it could not describe.
        assert _one(spans, "route")["parent_id"] == spans[0]["id"]


def _untraced(frames: list[dict]) -> list[dict]:
    """Frames without the trace id a traced turn stamps on the debug block."""
    out = copy.deepcopy(frames)
    for frame in out:
        content = frame.get("content")
        if isinstance(content, dict) and isinstance(content.get("debug"), dict):
            content["debug"].pop("trace_id", None)
    return out
