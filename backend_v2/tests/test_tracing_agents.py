"""Execution tracing of step execution: AgentRunner and the tools.

Every executed step must be one ``tool`` span under whatever span was
current when the runner started — also across the pool-thread hop — with the
tool's own decisions and LLM work nested inside it. And nothing the student
receives may change whether a trace is being recorded or not.

The runner and the tools hold no tracing logic: they are decorated by, or
call into, ``aeva.tracing.services.agent_trace`` / ``tool_trace``. The
decorators and wrappers of those services are tested on their own at the end
(pass-through with tracing off, exceptions unchanged, generator semantics).
Retrieval and grounding are covered in ``test_tracing_retrieval.py``.
"""

import inspect
import json
import threading
import time
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from aeva import tracing
from aeva.llm import prompts
from aeva.llm.llm_client import LLMClient
from aeva.llm.prompts import image_skills
from aeva.mcp import base as mcp_base
from aeva.mcp.base import BaseTool, PriorResult, ToolContext, ToolDefinition
from aeva.mcp.registry import ToolRegistry
from aeva.mcp.tools import (
    flashcard_generator,
    image_generator,
    media_llm,
    product_info,
    quiz_generator,
    web_search,
)
from aeva.mcp.tools.flashcard_generator import FlashcardGeneratorTool
from aeva.mcp.tools.general import GeneralAnswerTool
from aeva.mcp.tools.image_generator import ImageGeneratorTool
from aeva.mcp.tools.media_llm import MediaLLMTool
from aeva.mcp.tools.product_info import ProductInfoTool
from aeva.mcp.tools.quiz_generator import QuizGeneratorTool
from aeva.mcp.tools.web_search import WebSearchTool
from aeva.media.retrieval import RetrievalResult
from aeva.media.retrieval_utils import Excerpt
from aeva.orchestration import agent_runner
from aeva.orchestration.agent_runner import AgentRunner
from aeva.orchestration.models import (
    STEP_INPUT_ANSWER,
    STEP_INPUT_MESSAGE,
    STEP_KIND_ANSWER,
    STEP_KIND_GENERATOR,
    Step,
)
from aeva.tracing import recorder, store
from aeva.tracing.services import agent_trace, tool_trace


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    """Each test starts unbound, with storage 'available'."""
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
    yield
    recorder._BINDING.set(None)


@pytest.fixture
def saved(monkeypatch):
    """Capture what finish_turn would write instead of hitting Supabase."""
    box: dict = {}

    def fake_persist(trace_row, span_rows, prompt_rows):
        box["trace"] = trace_row
        box["spans"] = span_rows
        box["prompts"] = prompt_rows
        return True

    monkeypatch.setattr(store, "persist", fake_persist)
    return box


def _start() -> str | None:
    return tracing.start_turn(
        user_id="u1", message="explain osmosis", endpoint="stream"
    )


def _named(spans: list[dict], name: str, kind: str | None = None) -> list[dict]:
    return [
        s
        for s in spans
        if s["name"] == name and (kind is None or s["kind"] == kind)
    ]


def _one(spans: list[dict], name: str, kind: str | None = None) -> dict:
    found = _named(spans, name, kind)
    assert len(found) == 1, (name, [s["name"] for s in spans])
    return found[0]


# ------------------------------------------------------------ runner fakes


class _Tool(BaseTool):
    """Fake tool; fires a trace event from wherever it actually runs."""

    def __init__(
        self,
        name: str,
        *,
        delay: float = 0.0,
        fail: bool = False,
        stream: bool = False,
        fail_after: int | None = None,
        result: dict[str, Any] | None = None,
    ) -> None:
        self._name = name
        self._delay = delay
        self._fail = fail
        self._stream = stream
        self._fail_after = fail_after
        self._result = result or {}
        self.calls: list[ToolContext] = []
        self.threads: set[int] = set()
        self.stream_closed = False

    @property
    def definition(self) -> ToolDefinition:
        return ToolDefinition(self._name, "", {"type": "object"})

    def can_stream(self) -> bool:
        return self._stream

    def execute(self, ctx: ToolContext, params: dict[str, Any]) -> dict:
        self.calls.append(ctx)
        self.threads.add(threading.get_ident())
        tracing.event(tracing.KIND_DECISION, f"{self._name}.inner")
        ctx.note("working")
        time.sleep(self._delay)
        if self._fail:
            msg = "boom"
            raise RuntimeError(msg)
        return {"answer": f"{self._name} done", **self._result}

    def _llm_stream(self):
        """Stands in for LLMClient.generate_stream: a span held across yields.

        A generator of its own, as in production, so it only ends early if
        whoever iterates it is closed.
        """
        try:
            with tracing.span(tracing.KIND_LLM, f"{self._name}.llm"):
                for index, word in enumerate(("hello ", "world")):
                    if (
                        self._fail_after is not None
                        and index >= self._fail_after
                    ):
                        msg = "stream broke"
                        raise RuntimeError(msg)
                    time.sleep(self._delay / 2)
                    yield word
        except GeneratorExit:
            self.stream_closed = True
            raise

    def execute_stream(self, ctx: ToolContext, params: dict[str, Any]):
        self.calls.append(ctx)
        tracing.event(tracing.KIND_DECISION, f"{self._name}.inner")
        # A plain loop, as the real tools do: the inner stream is not closed
        # by delegation when this generator is.
        for word in self._llm_stream():  # noqa: UP028
            yield word
        return {
            "answer": "hello world",
            "sources": [{"title": "s", "url": "u"}],
        }


def _passthrough(gen):
    raw = ""
    try:
        while True:
            chunk = next(gen)
            raw += chunk
            yield chunk
    except StopIteration as stop:
        return raw, (stop.value or {})


def _split(raw: str):
    return raw, {"available_actions": [], "suggested_followups": []}


def _display(tool: str, result: dict) -> str:
    return result.get("answer", tool)


def _app() -> Flask:
    app = Flask(__name__)
    app.config["X"] = 1
    return app


def _runner(registry: ToolRegistry, **kw) -> AgentRunner:
    kw.setdefault("stream_answer", _passthrough)
    return AgentRunner(
        registry,
        _app(),
        build_ctx=lambda step, prior: ToolContext(
            user_id="u",
            session_id="s",
            message="m",
            enriched_message="m",
            media_ids=None,
            prior_results=list(prior),
        ),
        split_meta=_split,
        format_display=_display,
        **kw,
    )


def _run(registry: ToolRegistry, steps: list[Step], **kw):
    frames: list[dict] = []
    gen = _runner(registry, **kw).run(steps)
    try:
        while True:
            frames.append(json.loads(next(gen)[len("data: ") :]))
    except StopIteration as stop:
        return frames, stop.value


def _registry(*tools: _Tool) -> ToolRegistry:
    registry = ToolRegistry()
    for tool in tools:
        registry.register(tool)
    return registry


def _answer(tool: str = "general") -> Step:
    return Step(
        id="answer",
        tool=tool,
        kind=STEP_KIND_ANSWER,
        params={"query": "osmosis"},
        purpose="explain",
    )


def _gen(id_: str, tool: str, input_: str = STEP_INPUT_MESSAGE) -> Step:
    return Step(
        id=id_,
        tool=tool,
        kind=STEP_KIND_GENERATOR,
        input=input_,
        params={"topic": "osmosis"},
    )


def _team() -> tuple[ToolRegistry, list[Step], dict[str, _Tool]]:
    """Answer + an independent quiz + flashcards built from the answer."""
    tools = {
        "general": _Tool("general", delay=0.05, stream=True),
        "quiz_generator": _Tool("quiz_generator", result={"questions": [1]}),
        "flashcard_generator": _Tool(
            "flashcard_generator", result={"cards": [1, 2]}
        ),
    }
    steps = [
        _answer(),
        _gen("gen1", "quiz_generator"),
        _gen("gen2", "flashcard_generator", STEP_INPUT_ANSWER),
    ]
    return _registry(*tools.values()), steps, tools


# ------------------------------------------------------------ AgentRunner


class TestRunnerSpans:
    def test_three_tool_spans_under_the_span_current_at_start(self, saved):
        registry, steps, tools = _team()
        _start()
        with tracing.span(tracing.KIND_CONTEXT, "team") as parent:
            _frames, outcome = _run(registry, steps)
            # The answer span must not stay current once the runner is done.
            tracing.event(tracing.KIND_DECISION, "after_runner")
        tracing.finish_turn()
        spans = saved["spans"]

        tool_spans = [s for s in spans if s["kind"] == "tool"]
        assert sorted(s["name"] for s in tool_spans) == [
            "flashcard_generator",
            "general",
            "quiz_generator",
        ]
        assert {s["parent_id"] for s in tool_spans} == {parent.id}
        assert all(s["status"] == "ok" for s in tool_spans)
        assert _one(spans, "after_runner")["parent_id"] == parent.id
        assert sorted(saved["trace"]["tools"]) == [
            "flashcard_generator",
            "general",
            "quiz_generator",
        ]

        answer = _one(spans, "general", "tool")
        assert answer["meta"] == {
            "step_id": "answer",
            "step_kind": "answer",
            "step_input": "message",
            "model": None,
            "config_key": None,
            "thread": "request",
            "streamed": True,
            "sources": 1,
        }
        assert answer["input"] == {
            "params": {"query": "osmosis"},
            "purpose": "explain",
            "prior_results": [],
        }
        assert answer["output"] == {
            "answer": "hello world",
            "sources": [{"title": "s", "url": "u"}],
        }

        quiz = _one(spans, "quiz_generator", "tool")
        assert quiz["meta"]["thread"] == "worker"
        assert quiz["meta"]["step_id"] == "gen1"
        assert quiz["meta"]["streamed"] is False
        assert quiz["input"]["prior_results"] == []
        assert quiz["output"] == {
            "answer": "quiz_generator done",
            "questions": [1],
        }

        cards = _one(spans, "flashcard_generator", "tool")
        assert cards["meta"]["step_input"] == "answer"
        assert cards["input"]["prior_results"] == [
            {"tool": "general", "text_chars": 11, "sources": 1}
        ]
        # The runner really used pool threads for both generators.
        main = threading.get_ident()
        assert tools["quiz_generator"].threads
        assert main not in tools["quiz_generator"].threads
        assert main not in tools["flashcard_generator"].threads
        assert outcome.tools_used == [
            "general",
            "quiz_generator",
            "flashcard_generator",
        ]

    def test_work_inside_a_worker_nests_under_its_own_tool_span(self, saved):
        registry, steps, _tools = _team()
        _start()
        _run(registry, steps)
        tracing.finish_turn()
        spans = saved["spans"]
        for name in ("general", "quiz_generator", "flashcard_generator"):
            tool = _one(spans, name, "tool")
            inner = _one(spans, f"{name}.inner")
            assert inner["parent_id"] == tool["id"], name
        # The answer's "LLM" span (held across yields) is under the answer.
        assert (
            _one(spans, "general.llm")["parent_id"]
            == _one(spans, "general", "tool")["id"]
        )
        assert len({s["id"] for s in spans}) == len(spans)

    def test_handoff_records_what_dependents_received(self, saved):
        registry, steps, _tools = _team()
        _start()
        _run(registry, steps)
        tracing.finish_turn()
        spans = saved["spans"]
        handoff = _one(spans, "handoff", "decision")
        assert handoff["parent_id"] == spans[0]["id"]
        assert handoff["output"] == {
            "from": "general",
            "to": [{"id": "gen2", "tool": "flashcard_generator"}],
            "text_chars": len("hello world"),
            "sources": 1,
        }
        assert "flashcard_generator" in handoff["meta"]["reason"]
        # Recorded after the answer finished, before the dependent started.
        answer = _one(spans, "general", "tool")
        cards = _one(spans, "flashcard_generator", "tool")
        assert answer["seq"] < handoff["seq"] < cards["seq"]

    def test_no_handoff_without_dependents(self, saved):
        registry = _registry(
            _Tool("general", stream=True),
            _Tool("quiz_generator", result={"questions": []}),
        )
        _start()
        _run(registry, [_answer(), _gen("gen1", "quiz_generator")])
        tracing.finish_turn()
        assert not _named(saved["spans"], "handoff")

    def test_failing_generator_span_is_an_error(self, saved):
        registry = _registry(
            _Tool("quiz_generator", fail=True),
            _Tool("flashcard_generator", delay=0.05, result={"cards": [1]}),
        )
        steps = [
            _gen("gen1", "quiz_generator"),
            _gen("gen2", "flashcard_generator"),
        ]
        _start()
        _frames, outcome = _run(registry, steps)
        tracing.finish_turn()
        spans = saved["spans"]
        bad = _one(spans, "quiz_generator", "tool")
        assert bad["status"] == "error"
        assert bad["error"] == "RuntimeError: boom"
        assert bad["output"] is None
        good = _one(spans, "flashcard_generator", "tool")
        assert good["status"] == "ok"
        # The failure is still swallowed: the turn reports it, not raises.
        by_id = {a["id"]: a for a in outcome.result["agents"]}
        assert by_id["gen1"]["status"] == "failed"
        assert by_id["gen1"]["error"] == "RuntimeError"
        assert by_id["gen2"]["status"] == "done"

    def test_answer_failing_mid_stream_is_an_error_but_turn_completes(
        self, saved
    ):
        registry = _registry(
            _Tool("general", stream=True, fail_after=1),
            _Tool("flashcard_generator", result={"cards": [1]}),
        )
        steps = [
            _answer(),
            _gen("gen1", "flashcard_generator", STEP_INPUT_ANSWER),
        ]
        _start()
        frames, outcome = _run(registry, steps)
        tracing.event(tracing.KIND_DECISION, "after_runner")
        tracing.finish_turn()
        spans = saved["spans"]

        answer = _one(spans, "general", "tool")
        assert answer["status"] == "error"
        # The runner absorbs the exception, so the span only learns what the
        # runner kept of it (its type); the message is on the failing span
        # inside the step.
        # The runner keeps only the type; the message comes from the span
        # that raised.
        assert answer["error"] == "RuntimeError: stream broke"
        assert "partial text was kept" in answer["meta"]["partial_answer"]
        assert answer["meta"]["streamed"] is True
        assert answer["output"]["answer"].startswith("hello ")
        assert "lost the thread" in answer["output"]["answer"]
        llm = _one(spans, "general.llm")
        assert llm["status"] == "error"
        assert llm["error"] == "RuntimeError: stream broke"
        assert llm["parent_id"] == answer["id"]
        # The failed stream ended no later than the step that ran it.
        assert (
            llm["start_ms"] + llm["duration_ms"]
            <= answer["start_ms"] + answer["duration_ms"] + 2
        )
        # The turn went on: note streamed, dependent ran on the partial text.
        assert outcome.display_text.startswith("hello ")
        assert "lost the thread" in outcome.display_text
        by_id = {a["id"]: a for a in outcome.result["agents"]}
        assert by_id["answer"]["status"] == "failed"
        assert by_id["gen1"]["status"] == "done"
        assert _one(spans, "flashcard_generator", "tool")["status"] == "ok"
        assert _one(spans, "handoff")["output"]["from"] == "general"
        assert _one(spans, "after_runner")["parent_id"] == spans[0]["id"]
        assert any(f.get("content") == "hello " for f in frames)

    def test_answer_failing_before_any_text_raises_and_is_an_error(self, saved):
        registry = _registry(_Tool("general", stream=True, fail_after=0))
        _start()
        with pytest.raises(RuntimeError, match="stream broke"):
            _run(registry, [_answer()])
        tracing.event(tracing.KIND_DECISION, "after_runner")
        tracing.finish_turn()
        spans = saved["spans"]
        answer = _one(spans, "general", "tool")
        assert answer["status"] == "error"
        assert answer["error"] == "RuntimeError: stream broke"
        assert _one(spans, "after_runner")["parent_id"] == spans[0]["id"]

    def test_unknown_tool_is_an_error_span(self, saved):
        _start()
        with pytest.raises(Exception, match="Unknown tool|TOOL"):
            _run(ToolRegistry(), [_answer("nope")])
        tracing.finish_turn()
        assert _one(saved["spans"], "nope", "tool")["status"] == "error"

    def test_closing_the_runner_mid_answer_aborts_the_answer_span(self, saved):
        tool = _Tool("general", stream=True)
        _start()
        gen = _runner(_registry(tool)).run([_answer()])
        while True:
            frame = json.loads(next(gen)[len("data: ") :])
            if frame.get("content") == "hello ":
                break
        gen.close()  # the client went away
        # Closing the runner lets go of the tool's stream, exactly as without
        # a trace: it is ended there and then, not when it is collected.
        assert tool.stream_closed
        # Nothing of the abandoned answer may stay current on this thread.
        tracing.event(tracing.KIND_DECISION, "after_close")
        tracing.abort_turn()
        tracing.finish_turn()
        spans = saved["spans"]
        answer = _one(spans, "general", "tool")
        llm = _one(spans, "general.llm")
        assert answer["status"] == "aborted"
        assert llm["status"] == "aborted"
        assert llm["parent_id"] == answer["id"]
        # The tool's own stream was closed first: inner span ends no later
        # (start and duration are each truncated to whole ms, hence the 2).
        assert (
            llm["start_ms"] + llm["duration_ms"]
            <= answer["start_ms"] + answer["duration_ms"] + 2
        )
        assert _one(spans, "after_close")["parent_id"] == spans[0]["id"]
        assert saved["trace"]["status"] == "aborted"

    def test_timeout_decision_and_unfinished_worker_span(self, saved):
        registry = _registry(_Tool("quiz_generator", delay=1.0))
        _start()
        _frames, outcome = _run(
            registry, [_gen("gen1", "quiz_generator")], step_timeout_s=0.2
        )
        tracing.finish_turn()
        spans = saved["spans"]
        timeout = _one(spans, "agent_timeout", "decision")
        assert timeout["status"] == "timeout"
        assert timeout["parent_id"] == spans[0]["id"]
        assert timeout["output"]["step_id"] == "gen1"
        assert timeout["output"]["tool"] == "quiz_generator"
        assert timeout["output"]["elapsed_ms"] >= 200
        assert timeout["output"]["timeout_s"] == 0.2
        # Neutral wording: a step queued behind the pool never "ran".
        reason = timeout["meta"]["reason"]
        assert "did not finish within the 0.2s step timeout" in reason
        assert "ran past" not in reason
        # The worker is still running: its span is simply left open.
        worker = _one(spans, "quiz_generator", "tool")
        assert worker["status"] == "unfinished"
        assert worker["output"] is None
        # The service recognises a timeout by the error the runner writes.
        assert outcome.result["agents"][0]["error"] == agent_trace.TIMEOUT_ERROR

    def test_step_that_never_started_is_a_timeout_without_a_tool_span(
        self, saved
    ):
        """Queued behind ``max_parallel`` until the step timeout (finding 9)."""
        registry = _registry(
            _Tool("quiz_generator", delay=0.6, result={"questions": []}),
            _Tool("flashcard_generator", result={"cards": []}),
        )
        steps = [
            _gen("gen1", "quiz_generator"),
            _gen("gen2", "flashcard_generator"),
        ]
        _start()
        _frames, outcome = _run(
            registry, steps, max_parallel=1, step_timeout_s=0.2
        )
        tracing.finish_turn()
        spans = saved["spans"]
        expired = {
            row["output"]["step_id"]: row
            for row in _named(spans, "agent_timeout", "decision")
        }
        assert sorted(expired) == ["gen1", "gen2"]
        assert "did not finish within" in expired["gen2"]["meta"]["reason"]
        # gen2 was cancelled in the queue: it never ran, so it has no span.
        assert not _named(spans, "flashcard_generator", "tool")
        assert {a["error"] for a in outcome.result["agents"]} == {"timeout"}

    def test_no_timeout_decision_when_every_step_finished(self, saved):
        registry, steps, _tools = _team()
        _start()
        _run(registry, steps)
        tracing.finish_turn()
        assert not _named(saved["spans"], "agent_timeout")

    def test_handoff_lists_every_dependent_generator_once(self, saved):
        registry = _registry(
            _Tool("general", stream=True),
            _Tool("quiz_generator", result={"questions": [1]}),
            _Tool("flashcard_generator", result={"cards": [1]}),
        )
        steps = [
            _answer(),
            _gen("gen1", "quiz_generator", STEP_INPUT_ANSWER),
            _gen("gen2", "flashcard_generator", STEP_INPUT_ANSWER),
        ]
        _start()
        _run(registry, steps)
        tracing.finish_turn()
        handoff = _one(saved["spans"], "handoff", "decision")
        assert handoff["status"] == "ok"
        assert handoff["output"]["to"] == [
            {"id": "gen1", "tool": "quiz_generator"},
            {"id": "gen2", "tool": "flashcard_generator"},
        ]
        assert handoff["meta"]["reason"].startswith(
            "quiz_generator, flashcard_generator build(s) from"
        )

    def test_failing_generator_does_not_save_anything(self, saved):
        registry = _registry(_Tool("quiz_generator", fail=True))
        _start()
        _run(registry, [_gen("gen1", "quiz_generator")])
        tracing.finish_turn()
        assert not [s for s in saved["spans"] if s["kind"] == "persist"]

    def test_work_is_callable_without_a_binding(self):
        tool = _Tool("quiz_generator", result={"questions": [1]})
        runner = _runner(_registry(tool))
        step = _gen("gen1", "quiz_generator")
        runner._work(step, [])
        kind, sid, payload = runner._events.get_nowait()
        assert (kind, sid) == ("note", "gen1")
        kind, sid, payload = runner._events.get_nowait()
        assert (kind, sid) == ("done", "gen1")
        assert payload[0]["questions"] == [1]


class _StreamProvider:
    """Minimal vendor stand-in behind a real ``LLMClient``."""

    model = "fake-1"
    last_sources: list[dict[str, str]] = []  # noqa: RUF012

    def generate_stream(self, _user_message, **_kwargs):
        yield from ("Osmosis ", "is ", "diffusion.")


def _real_general() -> GeneralAnswerTool:
    """The real ``general`` tool over a real client (factory skipped)."""
    client = LLMClient.__new__(LLMClient)
    client._provider = _StreamProvider()
    client._config_key = "LLM_WEB_SEARCH_MODEL"
    return GeneralAnswerTool(llm=client)


class TestRealAnswerTool:
    """The runner's span around the real tool + ``LLMClient`` choke point."""

    def test_prompt_and_llm_spans_nest_under_the_tool_span(self, saved):
        _start()
        _frames, outcome = _run(_registry(_real_general()), [_answer()])
        tracing.finish_turn()
        spans = saved["spans"]
        tool = _one(spans, "general", "tool")
        children = [s for s in spans if s["parent_id"] == tool["id"]]
        assert [(s["kind"], s["name"]) for s in children] == [
            ("decision", "resolve_model"),
            ("prompt", "general_answer"),
            ("llm", "general_answer"),
        ]
        assert children[0]["output"] == {
            "config_key": "LLM_WEB_SEARCH_MODEL",
            "model": "fake-1",
            "source": "injected",
        }
        assert children[2]["output"] == {"text": "Osmosis is diffusion."}
        assert tool["output"]["answer"] == "Osmosis is diffusion."
        assert outcome.display_text == "Osmosis is diffusion."
        assert saved["trace"]["llm_calls"] == 1

    def test_client_disconnect_closes_the_llm_span_under_the_tool(self, saved):
        _start()
        gen = _runner(_registry(_real_general())).run([_answer()])
        while True:
            frame = json.loads(next(gen)[len("data: ") :])
            if frame.get("content") == "Osmosis ":
                break
        gen.close()
        tracing.event(tracing.KIND_DECISION, "after_close")
        tracing.finish_turn()
        spans = saved["spans"]
        tool = _one(spans, "general", "tool")
        llm = _one(spans, "general_answer", "llm")
        assert tool["status"] == "aborted"
        # Closed when the client left, not left open until the flush.
        assert llm["status"] == "aborted"
        assert llm["parent_id"] == tool["id"]
        assert llm["output"] == {"text": "Osmosis "}
        assert _one(spans, "after_close")["parent_id"] == spans[0]["id"]


def _stable(frames: list[dict]) -> list[dict]:
    """Frames without their timing field."""
    return [{k: v for k, v in f.items() if k != "ms"} for f in frames]


def _per_agent(frames: list[dict]) -> dict[str, list[dict]]:
    """Frames grouped by agent (content and roster frames under their type)."""
    groups: dict[str, list[dict]] = {}
    for frame in _stable(frames):
        key = frame.get("id") or frame.get("type") or "content"
        groups.setdefault(key, []).append(frame)
    return groups


def _stable_result(result: dict) -> dict:
    data = json.loads(json.dumps(result))
    for agent in data["agents"]:
        agent.pop("ms", None)
    return data


class TestIdenticalWithTracingOff:
    def _both(self, build, steps, saved) -> tuple[Any, Any]:
        plain = _run(build(), steps())
        _start()
        traced = _run(build(), steps())
        assert tracing.finish_turn()
        assert [s for s in saved["spans"] if s["kind"] == "tool"]
        return plain, traced

    def _assert_same(self, plain, traced, *, racing: bool = False) -> None:
        (frames_a, out_a), (frames_b, out_b) = plain, traced
        if racing:
            # Two workers start at once, so how their frames interleave is
            # down to the scheduler: compare each agent's own sequence and
            # the text stream instead of the raw order.
            assert _per_agent(frames_a) == _per_agent(frames_b)
        else:
            assert _stable(frames_a) == _stable(frames_b)
        assert out_a.display_text == out_b.display_text
        assert out_a.tool_used == out_b.tool_used
        assert out_a.tools_used == out_b.tools_used
        assert out_a.meta == out_b.meta
        assert out_a.streamed == out_b.streamed
        assert out_a.parallel == out_b.parallel
        assert _stable_result(out_a.result) == _stable_result(out_b.result)
        assert [a.status for a in out_a.agents] == [
            a.status for a in out_b.agents
        ]

    def test_answer_with_dependent_generator(self, saved):
        def build() -> ToolRegistry:
            return _registry(
                _Tool("general", stream=True),
                _Tool("flashcard_generator", result={"cards": [1]}),
            )

        def steps() -> list[Step]:
            return [
                _answer(),
                _gen("gen1", "flashcard_generator", STEP_INPUT_ANSWER),
            ]

        self._assert_same(*self._both(build, steps, saved))

    def test_parallel_generators_one_failing(self, saved):
        def build() -> ToolRegistry:
            return _registry(
                _Tool("quiz_generator", fail=True),
                _Tool("flashcard_generator", delay=0.2, result={"cards": [1]}),
            )

        def steps() -> list[Step]:
            return [
                _gen("gen1", "quiz_generator"),
                _gen("gen2", "flashcard_generator"),
            ]

        self._assert_same(*self._both(build, steps, saved), racing=True)

    def test_mid_stream_answer_failure(self, saved):
        def build() -> ToolRegistry:
            return _registry(_Tool("general", stream=True, fail_after=1))

        self._assert_same(*self._both(build, lambda: [_answer()], saved))

    def test_single_generator_keeps_flat_shape(self, saved):
        def build() -> ToolRegistry:
            return _registry(
                _Tool(
                    "quiz_generator", result={"quiz_id": "q", "questions": []}
                )
            )

        plain, traced = self._both(
            build, lambda: [_gen("gen1", "quiz_generator")], saved
        )
        self._assert_same(plain, traced)
        assert traced[1].result["quiz_id"] == "q"

    def test_nothing_is_recorded_without_a_turn(self):
        registry, steps, _tools = _team()
        _frames, outcome = _run(registry, steps)
        assert not tracing.is_active()
        assert outcome.result["flashcards"]["cards"] == [1, 2]


# --------------------------------------------------------- resolve_model


class _FakeClient:
    def __init__(self, model: str | None = None, *, config_key: str = "X"):
        self.model = model or f"default-of-{config_key}"
        self.config_key = config_key


class _LLMTool(_Tool):
    def __init__(self, name: str, llm: Any = None) -> None:
        super().__init__(name)
        self._llm = llm

    def execute(self, ctx: ToolContext, params: dict[str, Any]) -> dict:
        self.client = self.resolve_llm(ctx, "LLM_QUIZ_MODEL")
        return {"answer": "ok", "questions": []}


def _ctx(**kw) -> ToolContext:
    base: dict[str, Any] = {
        "user_id": "u",
        "session_id": "s",
        "message": "m",
        "enriched_message": "m",
        "media_ids": None,
    }
    base.update(kw)
    return ToolContext(**base)


class TestResolveModel:
    @pytest.fixture(autouse=True)
    def _fake_llm_client(self, monkeypatch):
        import aeva.llm.llm_client as module

        monkeypatch.setattr(module, "LLMClient", _FakeClient)

    def _decide(self, saved, tool: BaseTool, ctx: ToolContext) -> tuple:
        _start()
        client = tool.resolve_llm(ctx, "LLM_QUIZ_MODEL")
        tracing.finish_turn()
        return client, _one(saved["spans"], "resolve_model", "decision")

    def test_injected_singleton_when_no_model_was_chosen(self, saved):
        injected = SimpleNamespace(model="quiz-default")
        client, row = self._decide(saved, _LLMTool("q", injected), _ctx())
        assert client is injected
        assert row["output"] == {
            "config_key": "LLM_QUIZ_MODEL",
            "model": "quiz-default",
            "source": "injected",
        }
        assert row["meta"]["turn_model"] is None
        assert row["meta"]["reason"] == (
            "No model was set for this step, so the tool's injected client "
            "is used as is."
        )

    def test_injected_when_it_already_runs_the_planner_model(self, saved):
        injected = SimpleNamespace(model="quiz-default")
        client, row = self._decide(
            saved, _LLMTool("q", injected), _ctx(model="quiz-default")
        )
        assert client is injected
        assert row["output"]["source"] == "injected"
        assert row["meta"]["turn_model"] == "quiz-default"
        # The step's model is always set (the orchestrator fills in the
        # tool's default), so the reason must not claim the planner chose it.
        reason = row["meta"]["reason"]
        assert reason.startswith(
            "The step's model (the planner's pick, or the tool's default "
            "when it picked none) is the one the tool's injected client"
        )
        assert "planner chose" not in reason

    @pytest.mark.parametrize(
        ("injected", "ctx_kw"),
        [
            (None, {}),
            (None, {"model": "m"}),
            (None, {"model": "m", "config_key": "LLM_FAST_MODEL"}),
            (None, {"config_key": "LLM_FAST_MODEL"}),
            ("same", {"model": "m"}),
            ("same", {"model": "other"}),
            ("same", {"model": "m", "config_key": "LLM_FAST_MODEL"}),
            ("same", {"config_key": "LLM_FAST_MODEL"}),
        ],
    )
    def test_reason_never_says_the_planner_chose(self, saved, injected, ctx_kw):
        client = SimpleNamespace(model="m") if injected else None
        _client, row = self._decide(
            saved, _LLMTool("q", client), _ctx(**ctx_kw)
        )
        reason = row["meta"]["reason"]
        assert "planner chose" not in reason
        assert "the planner's model" not in reason
        assert reason.endswith(".")

    def test_a_client_built_from_the_turn_key_names_that_key(self, saved):
        """No model, no injected client, a turn-level key (finding 8)."""
        client, row = self._decide(
            saved, _LLMTool("q"), _ctx(config_key="LLM_FAST_MODEL")
        )
        assert client.config_key == "LLM_FAST_MODEL"
        assert row["output"] == {
            "config_key": "LLM_FAST_MODEL",
            "model": "default-of-LLM_FAST_MODEL",
            "source": "default",
        }
        assert row["meta"]["reason"] == (
            "No model was set for this step and no injected client is "
            "available, so one was built from LLM_FAST_MODEL."
        )
        assert row["meta"]["tool_config_key"] == "LLM_QUIZ_MODEL"

    def test_turn_key_is_reported_as_ignored_by_an_injected_client(self, saved):
        injected = SimpleNamespace(model="quiz-default")
        client, row = self._decide(
            saved,
            _LLMTool("q", injected),
            _ctx(config_key="LLM_FAST_MODEL"),
        )
        assert client is injected
        assert row["output"]["config_key"] == "LLM_QUIZ_MODEL"
        assert row["meta"]["turn_config_key"] == "LLM_FAST_MODEL"
        assert row["meta"]["turn_config_key_ignored"] is True

    def test_a_falsy_injected_client_counts_as_built(self, saved):
        class _Falsy(SimpleNamespace):
            def __bool__(self) -> bool:
                return False

        injected = _Falsy(model="quiz-default")
        client, row = self._decide(saved, _LLMTool("q", injected), _ctx())
        assert client is not injected
        assert row["output"]["source"] == "default"

    def test_planner_model_builds_a_client(self, saved):
        injected = SimpleNamespace(model="quiz-default")
        client, row = self._decide(
            saved, _LLMTool("q", injected), _ctx(model="quiz-pro")
        )
        assert isinstance(client, _FakeClient)
        assert client.config_key == "LLM_QUIZ_MODEL"
        assert row["output"] == {
            "config_key": "LLM_QUIZ_MODEL",
            "model": "quiz-pro",
            "source": "planner_model",
        }
        assert row["meta"]["injected_model"] == "quiz-default"
        assert row["meta"]["reason"].endswith(
            "is not the one the tool's injected client runs, so a client "
            "was built for it from LLM_QUIZ_MODEL."
        )

    def test_config_override_wins_even_for_the_same_model(self, saved):
        injected = SimpleNamespace(model="fast")
        client, row = self._decide(
            saved,
            _LLMTool("q", injected),
            _ctx(model="fast", config_key="LLM_FAST_MODEL"),
        )
        assert client is not injected
        assert client.config_key == "LLM_FAST_MODEL"
        assert row["output"] == {
            "config_key": "LLM_FAST_MODEL",
            "model": "fast",
            "source": "config_override",
        }
        assert row["meta"]["tool_config_key"] == "LLM_QUIZ_MODEL"
        assert row["meta"]["reason"].startswith(
            "This turn resolves through LLM_FAST_MODEL instead of the "
            "tool's own LLM_QUIZ_MODEL, so a client was built from "
            "LLM_FAST_MODEL"
        )

    def test_default_when_nothing_is_injected(self, saved):
        client, row = self._decide(saved, _LLMTool("q"), _ctx())
        assert isinstance(client, _FakeClient)
        assert row["output"] == {
            "config_key": "LLM_QUIZ_MODEL",
            "model": "default-of-LLM_QUIZ_MODEL",
            "source": "default",
        }

    def test_same_client_with_tracing_off(self):
        injected = SimpleNamespace(model="quiz-default")
        tool = _LLMTool("q", injected)
        assert tool.resolve_llm(_ctx(), "LLM_QUIZ_MODEL") is injected
        built = tool.resolve_llm(_ctx(model="other"), "LLM_QUIZ_MODEL")
        assert (built.model, built.config_key) == ("other", "LLM_QUIZ_MODEL")

    def test_decision_nests_under_the_worker_tool_span(self, saved):
        tool = _LLMTool("quiz_generator", SimpleNamespace(model="quiz-default"))
        _start()
        _run(_registry(tool), [_gen("gen1", "quiz_generator")])
        tracing.finish_turn()
        spans = saved["spans"]
        decision = _one(spans, "resolve_model", "decision")
        assert (
            decision["parent_id"] == _one(spans, "quiz_generator", "tool")["id"]
        )


# ------------------------------------------------------- media fixtures

INDEXED = {
    "id": "a",
    "processing_status": "ready",
    "chunk_count": 9,
    "mime_type": "application/pdf",
    "file_name": "n.pdf",
}
IMAGE = {
    "id": "b",
    "processing_status": "ready",
    "chunk_count": 0,
    "mime_type": "image/png",
    "file_name": "d.png",
}


def _excerpt() -> Excerpt:
    return Excerpt(
        media_id="a",
        document_name="n.pdf",
        content="excerpt body",
        page_number=1,
        section="Sec",
        chunk_ids=("c1",),
        first_index=0,
        last_index=0,
        score=0.5,
        similarity=0.9,
    )


def _retrieved(context: str) -> RetrievalResult:
    return RetrievalResult(
        chunks=[],
        excerpts=[_excerpt()] if context else [],
        sources=[
            {
                "document_name": "n.pdf",
                "media_id": "a",
                "page_number": 1,
                "chunk_id": "c1",
                "section": "Sec",
                "snippet": "excerpt body",
            }
        ]
        if context
        else [],
        context_text=context,
        allowed_markers={"[cite:n.pdf#1]", "[cite:n.pdf]"}
        if context
        else set(),
        query_used="q",
        diagnostics={"mode": "hybrid"},
    )


# ------------------------------------------------------------------ tools


def _decisions(saved, run) -> list[dict]:
    """Run ``run`` inside a traced tool span; return the recorded spans."""
    _start()
    with tracing.span(tracing.KIND_TOOL, "tool"):
        run()
    tracing.finish_turn()
    return saved["spans"]


def _drain(gen) -> tuple[str, dict]:
    text = ""
    try:
        while True:
            text += next(gen)
    except StopIteration as stop:
        return text, stop.value


def _as_step(saved, tool: BaseTool, ctx: ToolContext, params: dict, app=None):
    """Run one real tool as the only step of a turn, through the runner.

    What a finished step saved and the counts read off its result are
    recorded by the runner's step span, so those need the real path: an
    answer tool on the request thread, a generator in a pool thread.
    """
    app = app or Flask(__name__)
    streams = tool.can_stream()
    step = Step(
        id="answer" if streams else "gen1",
        tool=tool.definition.name,
        kind=STEP_KIND_ANSWER if streams else STEP_KIND_GENERATOR,
        params=params,
    )
    registry = ToolRegistry()
    registry.register(tool)
    runner = AgentRunner(
        registry,
        app,
        build_ctx=lambda _step, _prior: ctx,
        stream_answer=_passthrough,
        split_meta=_split,
        format_display=_display,
    )
    _start()
    with app.app_context():
        gen = runner.run([step])
        try:
            while True:
                next(gen)
        except StopIteration as stop:
            outcome = stop.value
    # What the services left in the per-trace scratch dict, for the tests
    # that check a call cleans up after itself.
    saved["state"] = dict(tracing.state())
    tracing.finish_turn()
    return outcome, saved["spans"]


class TestToolDecisions:
    def test_web_search_intent_from_the_planner(self, saved):
        ctx = _ctx(enriched_message="best laptop for students")
        params = {"query": "best student laptops", "search_intent": "compare"}
        spans = _decisions(saved, lambda: WebSearchTool._render(ctx, params))
        row = _one(spans, "search_intent", "decision")
        assert row["parent_id"] == _one(spans, "tool", "tool")["id"]
        assert row["output"] == {
            "search_intent": "compare",
            "source": "planner_params",
        }
        assert row["input"] == {
            "search_intent": "compare",
            "query": "best student laptops",
            "query_source": "params.query",
        }

    def test_web_search_intent_from_the_regex_fallback(self, saved):
        ctx = _ctx(enriched_message="iphone vs pixel")
        box: dict = {}

        def run() -> None:
            box["out"] = WebSearchTool._render(ctx, {"search_intent": "??"})

        spans = _decisions(saved, run)
        row = _one(spans, "search_intent", "decision")
        assert row["output"] == {
            "search_intent": box["out"][2],
            "source": "regex_fallback",
        }
        assert row["output"]["search_intent"] == prompts.guess_search_intent(
            "iphone vs pixel"
        )
        assert row["input"]["query_source"] == "message"
        assert "guessed" in row["meta"]["reason"]
        # Tracing does not change what is rendered.
        assert box["out"] == WebSearchTool._render(ctx, {"search_intent": "??"})

    def test_web_search_sources_count_on_the_tool_span(self, saved):
        llm = MagicMock()
        llm.model = "web"
        llm.generate_stream.return_value = iter(["a", "b"])
        llm.last_sources = [
            {"title": "t", "url": "u"},
            {"title": "v", "url": "w"},
        ]
        tool = WebSearchTool(llm=llm)
        outcome, spans = _as_step(
            saved, tool, _ctx(enriched_message="news today"), {}
        )
        step = _one(spans, "web_search", "tool")
        assert step["meta"]["sources"] == 2
        assert step["meta"]["thread"] == "request"
        assert _one(spans, "search_intent")["parent_id"] == step["id"]
        assert outcome.result["sources"] == llm.last_sources
        assert outcome.result["answer"] == "ab"

    def _image(self, message: str, params: dict, saved) -> tuple[dict, dict]:
        llm = MagicMock()
        llm.model = "img"
        llm.generate_image.return_value = (b"png-bytes", "image/png", "")
        supabase = MagicMock()
        supabase.create_media_record.return_value = {
            "id": "m1",
            "file_name": "f",
        }
        supabase.get_signed_url.return_value = "https://signed"
        tool = ImageGeneratorTool(llm=llm, supabase=supabase)
        notes: list[str] = []
        ctx = _ctx(
            message=message, enriched_message=message, report=notes.append
        )
        box: dict = {}

        def run() -> None:
            with Flask(__name__).app_context():
                box["result"] = tool.execute(ctx, params)

        spans = _decisions(saved, run)
        assert len(notes) == 2  # tracing adds no progress notes
        return _one(spans, "image_skill", "decision"), box["result"]

    def test_image_skill_from_keyword_match(self, saved):
        row, result = self._image(
            "draw a flowchart of the TCP handshake", {"prompt": "TCP"}, saved
        )
        assert row["output"] == {
            "skill": "flowchart",
            "label": "Flowchart",
            "aspect": "portrait",
            "source": "keyword_match",
        }
        assert result["style"] == "flowchart"

    def test_image_skill_from_planner_style(self, saved):
        row, _result = self._image(
            "draw a flowchart of TCP",
            {"prompt": "TCP", "style": "mind_map"},
            saved,
        )
        assert row["output"]["skill"] == "mind_map"
        assert row["output"]["source"] == "planner_style"
        assert row["input"] == {"style": "mind_map"}

    def test_image_skill_default(self, saved):
        row, _result = self._image(
            "zzz qqq", {"prompt": "zzz", "style": "not-a-skill"}, saved
        )
        assert row["output"]["skill"] == prompts.pick_skill("").id
        assert row["output"]["source"] == "default"

    def test_product_info_records_the_planner_query_replacing_the_message(
        self, saved
    ):
        llm = MagicMock()
        llm.model = "fast"
        llm.generate.return_value = "answer"
        llm.generate_stream.side_effect = lambda *_a, **_k: iter(["an", "swer"])
        tool = ProductInfoTool(llm=llm)
        ctx = _ctx(enriched_message="how do i add my notes??")
        asked = {"query": "How to upload study material"}
        box: dict = {}

        def run() -> None:
            box["stream"] = _drain(tool.execute_stream(ctx, asked))
            box["sync"] = tool.execute(ctx, asked)
            # No planner query: the student's message is sent, nothing to say.
            box["own"] = tool.execute(ctx, {})

        spans = _decisions(saved, run)
        rows = _named(spans, "planner_query", "decision")
        assert len(rows) == 2  # the stream call and the sync call
        for row in rows:
            assert row["output"] == {
                "user_message": "How to upload study material",
                "source": "params.query",
            }
            assert row["input"] == {"message": "how do i add my notes??"}
            assert row["parent_id"] == _one(spans, "tool", "tool")["id"]
        # The tool itself behaves as ever.
        assert box["stream"] == ("answer", {"answer": "answer", "sources": []})
        assert box["sync"] == {"answer": "answer", "sources": []}
        sent = [call.args[0] for call in llm.generate.call_args_list]
        assert "How to upload study material" in sent[0]
        assert "how do i add my notes??" in sent[1]

    def _quiz_tool(self) -> tuple[QuizGeneratorTool, MagicMock]:
        llm = MagicMock()
        llm.model = "quiz"
        llm.generate_structured.return_value = {
            "title": "Osmosis",
            "topic": "osmosis",
            "questions": [
                {
                    "type": "single_select",
                    "options": ["a", "b"],
                    "correct_answers": ["a", "b"],
                },
                {
                    "type": "true_false",
                    "options": ["Yes", "No"],
                    "correct_answers": ["True"],
                },
                {
                    "type": "multi_select",
                    "options": ["x", "y"],
                    "correct_answers": ["x", "y"],
                },
            ],
        }
        repo = MagicMock()
        repo.create.side_effect = lambda **kw: {
            "id": "quiz-1",
            "title": kw["quiz_data"]["title"],
            "topic": kw["quiz_data"]["topic"],
            "questions": kw["quiz_data"]["questions"],
        }
        tool = QuizGeneratorTool(
            llm=llm, quiz_repo=repo, supabase=MagicMock(), retrieval=MagicMock()
        )
        return tool, llm

    def test_quiz_params_repairs_and_persisted_id(self, saved):
        tool, llm = self._quiz_tool()
        ctx = _ctx(
            history=[{"role": "user", "content": "earlier"}],
            prior_results=[PriorResult(tool="general", text="Osmosis is …")],
        )
        params = {
            "topic": "osmosis",
            "question_count": 50,
            "difficulty": "hard",
        }
        outcome, spans = _as_step(saved, tool, ctx, params)

        step = _one(spans, "quiz_generator", "tool")
        assert step["meta"]["thread"] == "worker"
        assert step["input"]["prior_results"] == [
            {"tool": "general", "text_chars": 12, "sources": 0}
        ]
        names = [s["name"] for s in spans if s["parent_id"] == step["id"]]
        assert names == [
            "grounding",
            "quiz_params",
            "quiz_generation",
            "resolve_model",
            "quiz_normalize",
            "quiz",
        ]
        params_row = _one(spans, "quiz_params", "decision")
        assert params_row["input"] == {
            "topic": "osmosis",
            "question_count": 50,
            "difficulty": "hard",
            "question_types": None,
            "exam_config": None,
            "use_media": None,
        }
        assert params_row["output"] == {
            "topic": "osmosis",
            "question_count": 10,  # clamped to the max
            "difficulty": "hard",
            "question_types": ["single_select", "multi_select", "true_false"],
            "question_types_source": "default",
            "exam_config": {},
            "wants_media": False,
            "wants_media_source": "no_files",
            "history_dropped": True,
            "history_turns": 0,
            "attachments": 0,
        }
        assert params_row["meta"]["reason"] == (
            "Grounded in source material, so chat history is not sent."
        )
        assert llm.generate_structured.call_args.kwargs["history"] is None

        normalize = _one(spans, "quiz_normalize", "decision")["output"]
        assert normalize["questions"] == 3
        assert normalize["repaired"] == 2
        assert normalize["repairs"] == [
            {
                "index": 0,
                "type": "single_select",
                "options_reset": False,
                "correct_before": ["a", "b"],
                "correct_after": ["a"],
            },
            {
                "index": 1,
                "type": "true_false",
                "options_reset": True,
                "correct_before": ["True"],
                "correct_after": ["True"],
            },
        ]
        persisted = _one(spans, "quiz", "persist")
        assert persisted["output"] == {
            "quiz_id": "quiz-1",
            "title": "Osmosis",
            "questions": 3,
        }
        assert _one(spans, "grounding")["output"]["source"] == "prior_output"
        assert outcome.result["quiz_id"] == "quiz-1"

    def test_quiz_types_from_the_exam_pattern_and_files_from_the_params(
        self, saved
    ):
        tool, _llm = self._quiz_tool()
        pattern = next(
            name
            for name, preset in quiz_generator.exam_patterns.EXAM_PATTERNS.items()
            if isinstance(preset.get("default_type"), str)
        )
        ctx = _ctx(media_ids=["a"])
        params = {"exam_config": {"pattern": pattern}, "use_media": False}
        box: dict = {}

        def run() -> None:
            with Flask(__name__).app_context():
                box["result"] = tool.execute(ctx, params)

        spans = _decisions(saved, run)
        resolved = _one(spans, "quiz_params", "decision")["output"]
        assert resolved["question_types_source"] == "exam_pattern"
        assert resolved["exam_config"] == box["result"]["exam_config"]
        assert resolved["wants_media"] is False
        assert resolved["wants_media_source"] == "params.use_media"

    def test_quiz_result_is_the_same_with_tracing_off(self, saved):
        ctx = _ctx(history=[{"role": "user", "content": "earlier"}])
        params = {"topic": "osmosis"}

        def run() -> tuple[dict, Any]:
            tool, llm = self._quiz_tool()
            with Flask(__name__).app_context():
                return tool.execute(
                    ctx, params
                ), llm.generate_structured.call_args

        plain, plain_call = run()
        _start()
        traced, traced_call = run()
        tracing.finish_turn()
        assert plain == traced
        assert plain_call == traced_call
        # No material: the history is sent, and the trace says so.
        resolved = _one(saved["spans"], "quiz_params")
        assert resolved["output"]["history_dropped"] is False
        assert resolved["output"]["history_turns"] == 1
        assert resolved["meta"]["reason"].startswith("No source material")

    def test_flashcard_params_and_persisted_set_id(self, saved):
        llm = MagicMock()
        llm.model = "cards"
        llm.generate_structured.return_value = {"title": "T", "cards": []}
        repo = MagicMock()
        repo.create.return_value = {
            "set_id": "set-1",
            "title": "T",
            "topic": "osmosis",
            "cards": [{"front": "f", "back": "b"}],
        }
        tool = FlashcardGeneratorTool(
            llm=llm,
            flashcard_repo=repo,
            supabase=MagicMock(),
            retrieval=MagicMock(),
        )
        ctx = _ctx(history=[{"role": "user", "content": "earlier"}])
        outcome, spans = _as_step(
            saved, tool, ctx, {"topic": "osmosis", "count": 99}
        )

        step = _one(spans, "flashcard_generator", "tool")
        params_row = _one(spans, "flashcard_params", "decision")
        assert params_row["parent_id"] == step["id"]
        assert params_row["input"] == {
            "topic": "osmosis",
            "count": 99,
            "use_media": None,
        }
        assert params_row["output"] == {
            "topic": "osmosis",
            "count": 20,  # clamped to the max
            "wants_media": False,
            "wants_media_source": "no_files",
            "source_type": "response",
            "history_dropped": False,
            "history_turns": 1,
            "attachments": 0,
        }
        persisted = _one(spans, "flashcard_set", "persist")
        assert persisted["parent_id"] == step["id"]
        assert persisted["output"] == {
            "set_id": "set-1",
            "title": "T",
            "cards": 1,
            "source_type": "response",
        }
        assert _one(spans, "grounding")["output"]["source"] == "none"
        assert outcome.result["set_id"] == "set-1"
        # The slot that carried ``source_type`` to the persist event is empty
        # again once the step is done.
        assert not [k for k in saved["state"] if k.startswith("tool_trace.")]


def _media_tool(records: list[dict], retrieved: RetrievalResult | None = None):
    supabase = MagicMock()
    supabase.list_media.return_value = records
    supabase.get_media.side_effect = lambda mid, _u: next(
        (r for r in records if r["id"] == mid), None
    )
    retrieval = MagicMock()
    retrieval.retrieve.return_value = retrieved or _retrieved("")
    llm = MagicMock()
    llm.model = "media"
    llm.generate_stream.side_effect = lambda *_a, **_k: iter(
        ["Osmosis [cite:n.pdf#1] is", " diffusion [cite:other.pdf#9]."]
    )
    tool = MediaLLMTool(llm=llm, supabase=supabase, retrieval=retrieval)
    return tool, llm


class TestMediaPrepare:
    @pytest.fixture
    def media_app(self) -> Flask:
        app = Flask(__name__)
        app.config["RAG_ATTACHMENT_FALLBACK"] = False
        return app

    def _run(self, saved, app, tool, ctx, params) -> tuple[dict, list[dict]]:
        box: dict = {}

        def run() -> None:
            with app.app_context():
                box["out"] = _drain(tool.execute_stream(ctx, params))
                box["state"] = [
                    key
                    for key in tracing.state()
                    if key.startswith("tool_trace.")
                ]

        return box, _decisions(saved, run)

    def test_answer_with_excerpts_and_citation_counts(self, saved, media_app):
        tool, llm = _media_tool([INDEXED], _retrieved("[1] excerpt"))
        before = dict(vars(tool))
        ctx = _ctx(
            message="what is osmosis", enriched_message="what is osmosis"
        )
        outcome, spans = _as_step(
            saved, tool, ctx, {"query": "osmosis definition"}, media_app
        )
        row = _one(spans, "media_prepare", "decision")
        assert row["input"] == {
            "query": "osmosis definition",
            "query_source": "params.query",
            "media_ids": None,
            "media_ids_source": "session_files",
        }
        assert row["output"] == {
            "indexed": ["n.pdf"],
            "images": [],
            "raw_docs": [],
            "attached_whole": [],
            "excerpts": 1,
            "early_answer": None,
            "llm_call": True,
        }
        assert row["meta"]["reason"].startswith("The answer model is called")
        step = _one(spans, "media_llm", "tool")
        assert row["parent_id"] == step["id"]
        # Read off the step's result: one marker kept, one dropped.
        assert step["meta"]["citations_used"] == 1
        assert step["meta"]["citations_dropped"] == 1
        assert step["meta"]["sources"] == 1
        assert _one(spans, "resolve_model")["output"]["source"] == "injected"
        # The disallowed marker is filtered exactly as without a trace.
        text = "Osmosis [cite:n.pdf#1] is diffusion ."
        assert outcome.display_text == text
        assert outcome.result["answer"] == text
        assert outcome.result["_retrieval"]["citations_dropped"] == 1
        llm.generate_stream.assert_called_once()
        # The shared tool keeps nothing of the call.
        assert vars(tool) == before

    def test_no_media_is_an_early_answer_without_the_model(
        self, saved, media_app
    ):
        tool, llm = _media_tool([])
        box, spans = self._run(saved, media_app, tool, _ctx(), {})
        row = _one(spans, "media_prepare", "decision")
        assert row["output"]["early_answer"] == "no_media"
        assert row["output"]["llm_call"] is False
        assert row["input"]["query_source"] == "message"
        assert row["meta"]["reason"] == "No files are in scope for this turn."
        assert box["out"][0] == prompts.NO_MEDIA_MESSAGE
        assert box["state"] == []  # the call's slot was cleared
        llm.generate_stream.assert_not_called()
        assert not _named(spans, "resolve_model")

    def test_nothing_retrievable(self, saved, media_app):
        tool, llm = _media_tool([INDEXED], _retrieved(""))
        ctx = _ctx(media_ids=["a"])
        box, spans = self._run(saved, media_app, tool, ctx, {})
        row = _one(spans, "media_prepare", "decision")
        assert row["output"]["early_answer"] == "nothing_retrievable"
        assert row["output"]["indexed"] == ["n.pdf"]
        assert row["output"]["excerpts"] == 0
        assert row["input"]["media_ids_source"] == "request"
        assert box["out"][1]["suggested_followups"]
        llm.generate_stream.assert_not_called()

    def test_still_processing(self, saved, media_app):
        pending = {
            "id": "p",
            "processing_status": "parsing",
            "chunk_count": 0,
            "mime_type": "application/pdf",
            "file_name": "big.pdf",
        }
        tool, llm = _media_tool([pending])
        box, spans = self._run(
            saved, media_app, tool, _ctx(), {"media_ids": ["p"]}
        )
        row = _one(spans, "media_prepare", "decision")
        assert row["output"]["early_answer"] == "still_processing"
        assert row["output"]["raw_docs"] == ["big.pdf"]
        assert row["output"]["attached_whole"] == []
        assert row["input"]["media_ids_source"] == "params.media_ids"
        assert box["out"][0] == prompts.PROCESSING_MESSAGE
        llm.generate_stream.assert_not_called()

    def test_nothing_usable(self, saved, media_app):
        failed = {
            "id": "f",
            "processing_status": "failed",
            "chunk_count": 0,
            "mime_type": "application/pdf",
            "file_name": "bad.pdf",
        }
        tool, llm = _media_tool([failed])
        box, spans = self._run(saved, media_app, tool, _ctx(), {})
        row = _one(spans, "media_prepare", "decision")
        assert row["output"]["early_answer"] == "nothing_usable"
        assert row["output"]["raw_docs"] == ["bad.pdf"]
        assert box["out"][0] == prompts.NO_MEDIA_MESSAGE
        llm.generate_stream.assert_not_called()

    def test_files_attached_whole_beside_the_excerpts(self, saved, media_app):
        tool, llm = _media_tool([INDEXED, IMAGE], _retrieved("[1] excerpt"))
        ctx = _ctx(media_ids=["a", "b"])
        with patch.object(
            media_llm,
            "download_attachments",
            return_value=[{"mime_type": "image/png", "data": b"RAWBYTES" * 9}],
        ):
            box, spans = self._run(saved, media_app, tool, ctx, {})
        row = _one(spans, "media_prepare", "decision")
        assert row["output"] == {
            "indexed": ["n.pdf"],
            "images": ["d.png"],
            "raw_docs": [],
            "attached_whole": ["d.png (image)"],
            "excerpts": 1,
            "early_answer": None,
            "llm_call": True,
        }
        assert box["out"][1]["media_count"] == 2
        # Attachment bytes never enter the trace.
        assert "RAWBYTES" not in json.dumps(spans)
        sent = llm.generate_stream.call_args.kwargs["attachments"]
        assert sent[0]["data"] == b"RAWBYTES" * 9

    def test_a_failing_prepare_raises_unchanged_and_records_no_decision(
        self, saved, media_app
    ):
        tool, _llm = _media_tool([INDEXED])
        boom = RuntimeError("index down")
        tool.retrieval.retrieve.side_effect = boom
        _start()
        with media_app.app_context(), pytest.raises(RuntimeError) as caught:
            _drain(tool.execute_stream(_ctx(), {}))
        assert caught.value is boom
        assert not [k for k in tracing.state() if k.startswith("tool_trace.")]
        tracing.finish_turn()
        assert not _named(saved["spans"], "media_prepare")

    def test_same_answer_with_tracing_off(self, media_app):
        def run() -> tuple[str, dict]:
            tool, _llm = _media_tool([INDEXED], _retrieved("[1] excerpt"))
            with media_app.app_context():
                return _drain(tool.execute_stream(_ctx(), {}))

        plain = run()
        _start()
        with tracing.span(tracing.KIND_TOOL, "tool"):
            traced = run()
        tracing.discard_turn()
        assert plain == traced


# ------------------------------------------------- the agent_trace service


class _Agent(SimpleNamespace):
    """Stands in for the runner's ``AgentOutcome``."""


class _FakeRunner:
    """Just enough of ``AgentRunner`` for the service's decorators."""

    def __init__(self) -> None:
        self._outcomes: dict[str, Any] = {}
        self._timeout_s = 0.5
        self._pool: Any = object()
        self.log: list[Any] = []
        self.fail: BaseException | None = None

    @agent_trace.answer_step
    def _run_answer(self, step):
        try:
            sent = yield "a"
            self.log.append(("sent", sent))
            if self.fail is not None:
                raise self.fail
            try:
                yield "b"
            except KeyError as exc:
                self.log.append(("thrown", exc))
                yield "recovered"
            yield "c"
        except GeneratorExit:
            self.log.append("closed")
            raise
        return "abc", {"answer": "abc", "sources": []}, {"m": 1}, True

    @agent_trace.handoff
    def _submit(self, step, prior):
        self.log.append(("submit", step, prior))
        return "submitted"

    @agent_trace.timeouts
    def _expire_timeouts(self):
        for sid, agent in self._outcomes.items():
            if agent.error is None:
                agent.error = "timeout"
                yield f"expired {sid}"
        return "done"


def _step(id_: str = "answer", tool: str = "general") -> Step:
    return Step(id=id_, tool=tool, kind=STEP_KIND_ANSWER, params={"q": 1})


def _all(gen) -> tuple[list, Any]:
    items = []
    try:
        while True:
            items.append(next(gen))
    except StopIteration as stop:
        return items, stop.value


class TestAgentTraceService:
    def test_the_runner_and_the_tools_hold_no_tracing_logic(self):
        """Existing files only import their service and call into it."""
        for module in (
            agent_runner,
            mcp_base,
            flashcard_generator,
            image_generator,
            media_llm,
            product_info,
            quiz_generator,
            web_search,
        ):
            source = inspect.getsource(module)
            assert "from aeva import tracing" not in source, module.__name__
            assert "tracing." not in source.replace(
                "aeva.tracing.services", ""
            ), module.__name__
        for name in ("_answer_frames", "_close_streams", "_tool_span"):
            assert not hasattr(AgentRunner, name)
        assert not hasattr(agent_runner, "_AnswerRun")
        assert not hasattr(ProductInfoTool, "_question")

    def test_decorated_methods_keep_their_identity(self):
        for method, name in (
            (AgentRunner._run_answer, "_run_answer"),
            (AgentRunner._submit, "_submit"),
            (AgentRunner._expire_timeouts, "_expire_timeouts"),
            (BaseTool.resolve_llm, "resolve_llm"),
        ):
            assert method.__name__ == name
            assert method.__doc__
            assert method.__wrapped__.__name__ == name

    # ---- answer_step

    def test_answer_step_hands_back_the_methods_own_generator_when_off(self):
        runner = _FakeRunner()
        gen = runner._run_answer(_step())
        assert gen.gi_code.co_name == "_run_answer"  # no wrapper generator
        frames, value = _all(gen)
        assert frames == ["a", "b", "c"]
        assert value == (
            "abc",
            {"answer": "abc", "sources": []},
            {"m": 1},
            True,
        )

    def test_answer_step_forwards_send_throw_and_the_return_value(self, saved):
        runner = _FakeRunner()
        thrown = KeyError("k")
        _start()
        gen = runner._run_answer(_step())
        assert next(gen) == "a"
        assert gen.send("hi") == "b"
        assert gen.throw(thrown) == "recovered"
        assert next(gen) == "c"
        with pytest.raises(StopIteration) as stop:
            next(gen)
        tracing.event(tracing.KIND_DECISION, "after")
        tracing.finish_turn()
        assert stop.value.value == (
            "abc",
            {"answer": "abc", "sources": []},
            {"m": 1},
            True,
        )
        assert runner.log == [("sent", "hi"), ("thrown", thrown)]
        spans = saved["spans"]
        span = _one(spans, "general", "tool")
        assert span["status"] == "ok"
        assert span["output"] == {"answer": "abc", "sources": []}
        assert span["meta"]["streamed"] is True
        assert span["meta"]["thread"] == "request"
        assert _one(spans, "after")["parent_id"] == spans[0]["id"]

    def test_answer_step_span_is_current_between_frames(self, saved):
        runner = _FakeRunner()
        _start()
        gen = runner._run_answer(_step())
        next(gen)
        tracing.event(tracing.KIND_DECISION, "between")
        _all(gen)
        tracing.finish_turn()
        spans = saved["spans"]
        assert (
            _one(spans, "between")["parent_id"]
            == _one(spans, "general", "tool")["id"]
        )

    def test_answer_step_close_reaches_the_method_and_aborts_the_span(
        self, saved
    ):
        runner = _FakeRunner()
        _start()
        gen = runner._run_answer(_step())
        next(gen)
        gen.close()
        tracing.event(tracing.KIND_DECISION, "after")
        tracing.finish_turn()
        assert runner.log == ["closed"]
        spans = saved["spans"]
        assert _one(spans, "general", "tool")["status"] == "aborted"
        assert _one(spans, "after")["parent_id"] == spans[0]["id"]

    def test_answer_step_exception_propagates_unchanged(self, saved):
        runner = _FakeRunner()
        runner.fail = ValueError("broke")
        _start()
        gen = runner._run_answer(_step())
        next(gen)
        with pytest.raises(ValueError, match="broke") as caught:
            next(gen)
        tracing.event(tracing.KIND_DECISION, "after")
        tracing.finish_turn()
        assert caught.value is runner.fail
        assert caught.value.__context__ is None
        spans = saved["spans"]
        span = _one(spans, "general", "tool")
        assert span["status"] == "error"
        assert span["error"] == "ValueError: broke"
        assert _one(spans, "after")["parent_id"] == spans[0]["id"]

    def test_answer_step_reports_a_failure_the_runner_absorbed(self, saved):
        runner = _FakeRunner()
        runner._outcomes["answer"] = _Agent(error="LookupError")
        _start()
        _all(runner._run_answer(_step()))
        tracing.finish_turn()
        span = _one(saved["spans"], "general", "tool")
        assert span["status"] == "error"
        assert span["error"] == "LookupError"
        assert span["output"] == {"answer": "abc", "sources": []}
        assert "sources" not in span["meta"]  # a failed step saved nothing

    @pytest.mark.parametrize("step", [object(), None, "general"])
    def test_answer_step_survives_a_step_it_cannot_describe(self, saved, step):
        runner = _FakeRunner()
        _start()
        frames, value = _all(runner._run_answer(step))
        tracing.finish_turn()
        assert frames == ["a", "b", "c"]
        assert value[0] == "abc"
        assert not [s for s in saved["spans"] if s["kind"] == "tool"]

    def test_answer_step_survives_an_odd_return_value(self, saved):
        class _Odd:
            _outcomes = None

            @agent_trace.answer_step
            def _run_answer(self, step):
                yield "x"
                return "not a tuple of four"

        _start()
        frames, value = _all(_Odd()._run_answer(_step()))
        tracing.event(tracing.KIND_DECISION, "after")
        tracing.finish_turn()
        assert (frames, value) == (["x"], "not a tuple of four")
        spans = saved["spans"]
        # Still closed, and nothing stays current.
        assert _one(spans, "general", "tool")["status"] == "ok"
        assert _one(spans, "after")["parent_id"] == spans[0]["id"]

    # ---- run_step / carry

    def test_run_step_is_the_plain_call_when_off(self):
        calls: list[tuple] = []
        result = {"answer": "x"}

        def execute(name, ctx, params):
            calls.append((name, ctx, params))
            return result

        step = _step("gen1", "quiz_generator")
        ctx = _ctx()
        assert agent_trace.run_step(execute, step, ctx) is result
        assert calls == [("quiz_generator", ctx, step.params)]
        assert calls[0][2] is step.params

    def test_run_step_records_result_and_keeps_the_exception(self, saved):
        boom = RuntimeError("boom")

        def fails(_name, _ctx, _params):
            raise boom

        result = {"quiz_id": "q1", "title": "T", "questions": [1, 2]}
        _start()
        got = agent_trace.run_step(
            lambda *_a: result, _step("gen1", "quiz_generator"), _ctx()
        )
        with pytest.raises(RuntimeError) as caught:
            agent_trace.run_step(
                fails, _step("gen2", "image_generator"), _ctx()
            )
        tracing.event(tracing.KIND_DECISION, "after")
        tracing.finish_turn()
        assert got is result
        assert caught.value is boom
        spans = saved["spans"]
        ok = _one(spans, "quiz_generator", "tool")
        assert ok["output"] == result
        assert ok["meta"]["streamed"] is False
        # Run on the calling thread, and labelled so.
        assert ok["meta"]["thread"] == "request"
        saved_quiz = _one(spans, "quiz", "persist")
        assert saved_quiz["parent_id"] == ok["id"]
        assert saved_quiz["output"] == {
            "quiz_id": "q1",
            "title": "T",
            "questions": 2,
        }
        bad = _one(spans, "image_generator", "tool")
        assert bad["status"] == "error"
        assert bad["error"] == "RuntimeError: boom"
        assert _one(spans, "after")["parent_id"] == spans[0]["id"]

    def test_run_step_survives_a_step_it_cannot_describe(self, saved):
        step = SimpleNamespace(tool="quiz_generator", params={"a": 1})
        _start()
        got = agent_trace.run_step(lambda *a: a, step, object())
        tracing.finish_turn()
        assert got[0] == "quiz_generator"
        assert got[2] == {"a": 1}
        assert not [s for s in saved["spans"] if s["kind"] == "tool"]

    def test_carry_is_the_function_itself_when_off(self):
        def work() -> None:
            return None

        assert agent_trace.carry(work) is work

    def test_carry_binds_the_trace_and_marks_the_worker_thread(self, saved):
        box: dict = {}

        def work(step, prior):
            box["active"] = tracing.is_active()
            box["args"] = (step, prior)
            return agent_trace.run_step(lambda *_a: {"cards": []}, step, _ctx())

        step = _step("gen1", "flashcard_generator")
        _start()
        with tracing.span(tracing.KIND_CONTEXT, "team") as parent:
            carried = agent_trace.carry(work)
        assert carried.__name__ == "work"
        thread = threading.Thread(target=carried, args=(step, []))
        thread.start()
        thread.join()
        tracing.finish_turn()
        assert box == {"active": True, "args": (step, [])}
        span = _one(saved["spans"], "flashcard_generator", "tool")
        assert span["meta"]["thread"] == "worker"
        # Under the span that was current when the work was handed over.
        assert span["parent_id"] == parent.id

    def test_carried_work_keeps_its_exception(self, saved):
        boom = KeyError("k")
        box: dict = {}

        def work() -> None:
            raise boom

        _start()
        carried = agent_trace.carry(work)

        def target() -> None:
            try:
                carried()
            except KeyError as exc:
                box["exc"] = exc

        thread = threading.Thread(target=target)
        thread.start()
        thread.join()
        tracing.finish_turn()
        assert box["exc"] is boom

    # ---- handoff

    def test_handoff_is_the_plain_call_when_off_or_without_prior(self, saved):
        runner = _FakeRunner()
        step = _step("gen1", "quiz_generator")
        assert runner._submit(step, []) == "submitted"
        _start()
        assert runner._submit(step, []) == "submitted"
        tracing.finish_turn()
        assert not _named(saved["spans"], "handoff")
        assert len(runner.log) == 2

    def test_handoff_without_a_pool_records_nothing(self, saved):
        runner = _FakeRunner()
        runner._pool = None
        prior = [PriorResult(tool="general", text="hello")]
        _start()
        assert runner._submit(_step("gen1", "quiz_generator"), prior) == (
            "submitted"
        )
        tracing.finish_turn()
        assert not _named(saved["spans"], "handoff")

    @pytest.mark.parametrize("prior", [[object()], "text", [None]])
    def test_handoff_survives_a_prior_it_cannot_describe(self, saved, prior):
        runner = _FakeRunner()
        step = _step("gen1", "quiz_generator")
        _start()
        assert runner._submit(step, prior) == "submitted"
        tracing.event(tracing.KIND_DECISION, "after")
        tracing.finish_turn()
        assert runner.log == [("submit", step, prior)]
        spans = saved["spans"]
        # No half-filled decision is left behind.
        assert not _named(spans, "handoff")
        assert _one(spans, "after")["parent_id"] == spans[0]["id"]

    def test_handoff_of_a_second_hand_over_is_a_second_decision(self, saved):
        runner = _FakeRunner()
        first = [PriorResult(tool="general", text="one")]
        second = [PriorResult(tool="web_search", text="three")]
        _start()
        runner._submit(_step("gen1", "quiz_generator"), first)
        runner._submit(_step("gen2", "flashcard_generator"), second)
        tracing.finish_turn()
        rows = _named(saved["spans"], "handoff", "decision")
        assert [row["output"]["from"] for row in rows] == [
            "general",
            "web_search",
        ]
        assert [len(row["output"]["to"]) for row in rows] == [1, 1]

    # ---- timeouts

    def test_timeouts_hands_back_the_methods_own_generator_when_off(self):
        runner = _FakeRunner()
        gen = runner._expire_timeouts()
        assert gen.gi_code.co_name == "_expire_timeouts"
        assert _all(gen) == ([], "done")

    def test_timeouts_records_only_the_steps_expired_by_this_call(self, saved):
        runner = _FakeRunner()
        step = SimpleNamespace(tool="quiz_generator")
        runner._outcomes = {
            "old": _Agent(error="timeout", ms=9, step=step),
            "failed": _Agent(error="RuntimeError", ms=9, step=step),
            "gen1": _Agent(error=None, ms=700, step=step),
        }
        _start()
        frames, value = _all(runner._expire_timeouts())
        # A second pass finds nothing new.
        assert _all(runner._expire_timeouts()) == ([], "done")
        tracing.finish_turn()
        assert (frames, value) == (["expired gen1"], "done")
        row = _one(saved["spans"], "agent_timeout", "decision")
        assert row["status"] == "timeout"
        assert row["output"] == {
            "step_id": "gen1",
            "tool": "quiz_generator",
            "elapsed_ms": 700,
            "timeout_s": 0.5,
        }
        assert row["meta"]["reason"] == (
            "quiz_generator (gen1) did not finish within the 0.5s step "
            "timeout, counted from when it was submitted; the turn finished "
            "without it."
        )

    def test_timeouts_are_recorded_when_the_consumer_stops(self, saved):
        runner = _FakeRunner()
        step = SimpleNamespace(tool="quiz_generator")
        runner._outcomes = {"gen1": _Agent(error=None, ms=1, step=step)}
        _start()
        gen = runner._expire_timeouts()
        assert next(gen) == "expired gen1"
        gen.close()
        tracing.finish_turn()
        assert _one(saved["spans"], "agent_timeout")["output"]["step_id"] == (
            "gen1"
        )

    def test_timeouts_survive_a_runner_they_cannot_read(self, saved):
        class _Bare:
            @agent_trace.timeouts
            def _expire_timeouts(self):
                yield "frame"
                return "done"

        _start()
        assert _all(_Bare()._expire_timeouts()) == (["frame"], "done")
        tracing.finish_turn()
        assert not _named(saved["spans"], "agent_timeout")

    # ---- model_choice

    def test_model_choice_keeps_the_exception_and_records_nothing(self, saved):
        boom = LookupError("no such model")

        class _Broken(_Tool):
            @agent_trace.model_choice
            def resolve_llm(self, ctx, config_key):
                raise boom

        _start()
        with pytest.raises(LookupError) as caught:
            _Broken("q").resolve_llm(_ctx(), "LLM_QUIZ_MODEL")
        tracing.finish_turn()
        assert caught.value is boom
        assert not _named(saved["spans"], "resolve_model")

    def test_model_choice_survives_a_context_it_cannot_read(self, saved):
        client = SimpleNamespace(model="m")

        class _Odd:
            @agent_trace.model_choice
            def resolve_llm(self, ctx, config_key):
                return client

        _start()
        assert _Odd().resolve_llm(object(), "KEY") is client
        assert _Odd().resolve_llm(ctx=None, config_key=None) is client
        tracing.finish_turn()
        assert not _named(saved["spans"], "resolve_model")


# -------------------------------------------------- the tool_trace service


class TestToolTraceService:
    def test_the_service_mirrors_the_tools_constants(self):
        assert tool_trace.DEFAULT_IMAGE_SKILL == image_skills.DEFAULT_SKILL_ID
        assert prompts.pick_skill("").id == tool_trace.DEFAULT_IMAGE_SKILL
        assert (
            media_llm._IN_PROGRESS_STATUSES == tool_trace.IN_PROGRESS_STATUSES
        )

    def test_decorated_functions_keep_their_identity(self):
        for func, name in (
            (WebSearchTool._render, "_render"),
            (ProductInfoTool.execute, "execute"),
            (ProductInfoTool.execute_stream, "execute_stream"),
            (quiz_generator._normalize_questions, "_normalize_questions"),
            (MediaLLMTool._prepare, "_prepare"),
            (MediaLLMTool._retrieve, "_retrieve"),
            (MediaLLMTool._whole_file_attachments, "_whole_file_attachments"),
        ):
            assert func.__name__ == name
            assert func.__doc__
            assert func.__wrapped__.__name__ == name

    @pytest.mark.parametrize(
        "decorator",
        [
            tool_trace.search_intent,
            tool_trace.planner_query,
            tool_trace.quiz_repairs,
            tool_trace.media_prepare,
            tool_trace.media_whole_files,
            tool_trace.media_retrieval,
        ],
    )
    def test_decorators_pass_through_and_never_raise(self, saved, decorator):
        """Off and on, fed arguments and results they cannot make sense of."""
        calls: list[tuple] = []
        result = object()
        boom = ZeroDivisionError("own")

        @decorator
        def plain(*args, **kwargs):
            calls.append((args, kwargs))
            return result

        @decorator
        def failing(*_args, **_kwargs):
            raise boom

        assert plain(1, two=2) is result
        _start()
        with tracing.span(tracing.KIND_TOOL, "tool"):
            assert plain(1, two=2) is result
            assert plain() is result
            with pytest.raises(ZeroDivisionError) as caught:
                failing(1)
            assert not [
                k for k in tracing.state() if k.startswith("tool_trace.")
            ]
            tracing.event(tracing.KIND_DECISION, "after")
        tracing.finish_turn()
        assert caught.value is boom
        assert calls == [((1,), {"two": 2}), ((1,), {"two": 2}), ((), {})]
        spans = saved["spans"]
        # Nothing it could not describe was recorded; the position is intact.
        assert [s["name"] for s in spans] == ["chat_turn", "tool", "after"]
        assert _one(spans, "after")["parent_id"] == _one(spans, "tool")["id"]

    def test_search_intent_works_under_staticmethod(self, saved):
        class _Web:
            @staticmethod
            @tool_trace.search_intent
            def _render(ctx, params):
                return "rendered", "q", "news"

        plain = _Web._render(None, {})
        _start()
        traced = _Web()._render(None, {"search_intent": "news", "query": "q"})
        tracing.finish_turn()
        assert plain == traced == ("rendered", "q", "news")
        row = _one(saved["spans"], "search_intent", "decision")
        assert row["output"] == {
            "search_intent": "news",
            "source": "planner_params",
        }

    def test_planner_query_on_a_generator_function_adds_no_layer(self, saved):
        class _Info:
            @tool_trace.planner_query
            def execute_stream(self, ctx, params):
                yield "a"
                return {"answer": "a"}

        _start()
        gen = _Info().execute_stream(_ctx(), {"query": "restated"})
        assert gen.gi_code.co_name == "execute_stream"
        assert _all(gen) == (["a"], {"answer": "a"})
        tracing.finish_turn()
        assert _one(saved["spans"], "planner_query")["output"] == {
            "user_message": "restated",
            "source": "params.query",
        }

    def test_in_body_calls_do_nothing_when_off_and_never_raise(self, saved):
        for call in (
            lambda: tool_trace.quiz_params({}),
            lambda: tool_trace.quiz_params({"params": None, "ctx": None}),
            lambda: tool_trace.flashcard_params({}),
            lambda: tool_trace.flashcard_params(locals()),
            lambda: tool_trace.image_skill(object(), None),
            lambda: tool_trace.image_skill(None, ["x"]),
        ):
            assert call() is None
        _start()
        for call in (
            lambda: tool_trace.quiz_params({}),
            lambda: tool_trace.quiz_params({"params": None, "ctx": None}),
            lambda: tool_trace.flashcard_params({}),
            lambda: tool_trace.flashcard_params(locals()),
            lambda: tool_trace.image_skill(object(), None),
            lambda: tool_trace.image_skill(None, ["x"]),
        ):
            assert call() is None
        tracing.finish_turn()
        assert [s["name"] for s in saved["spans"]] == ["chat_turn"]

    def test_quiz_repairs_survives_questions_it_cannot_compare(self, saved):
        @tool_trace.quiz_repairs
        def normalize(questions):
            return ["not", "dicts"]

        _start()
        assert normalize(questions=[1, 2]) == ["not", "dicts"]
        assert normalize(None) == ["not", "dicts"]
        tracing.finish_turn()
        assert not _named(saved["spans"], "quiz_normalize")

    def test_media_notes_outside_a_prepare_call_record_nothing(self, saved):
        tool, _llm = _media_tool([INDEXED], _retrieved("[1] excerpt"))
        app = Flask(__name__)
        app.config["RAG_ATTACHMENT_FALLBACK"] = False
        _start()
        with app.app_context():
            assert tool._whole_file_attachments(_ctx(), [], []) == ([], [])
            assert tool._retrieve(_ctx(), "q", [INDEXED]).excerpts
        assert not [k for k in tracing.state() if k.startswith("tool_trace.")]
        tracing.finish_turn()
        assert [s["name"] for s in saved["spans"]] == ["chat_turn"]

    def test_result_meta(self):
        assert tool_trace.result_meta({"sources": [1, 2]}) == {"sources": 2}
        assert tool_trace.result_meta({"sources": []}) == {"sources": 0}
        assert tool_trace.result_meta({"sources": "not-a-list"}) == {}
        assert tool_trace.result_meta({"quiz_id": "q"}) == {}
        assert tool_trace.result_meta(None) == {}
        assert tool_trace.result_meta(["x"]) == {}
        assert tool_trace.result_meta(
            {
                "sources": [1],
                "_retrieval": {"citations_used": 2, "citations_dropped": 1},
            }
        ) == {"sources": 1, "citations_used": 2, "citations_dropped": 1}
        # Diagnostics of a turn that filtered no citations add nothing.
        assert tool_trace.result_meta({"_retrieval": {"mode": "hybrid"}}) == {}

    def test_persisted_records_only_what_a_result_says_was_saved(self, saved):
        _start()
        tool_trace.persisted({"answer": "plain answer", "sources": []})
        tool_trace.persisted(None)
        tool_trace.persisted(["x"])
        tool_trace.persisted({"quiz_id": None, "set_id": None})
        tool_trace.persisted({"set_id": "s1", "title": "T", "cards": None})
        tracing.finish_turn()
        rows = [s for s in saved["spans"] if s["kind"] == "persist"]
        assert [(r["name"], r["output"]) for r in rows] == [
            (
                "flashcard_set",
                {"set_id": "s1", "title": "T", "cards": 0, "source_type": None},
            )
        ]

    def test_persisted_is_silent_without_a_trace(self):
        assert tool_trace.persisted({"quiz_id": "q"}) is None
        assert not tracing.is_active()
