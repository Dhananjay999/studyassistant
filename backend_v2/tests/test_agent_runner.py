"""AgentRunner: parallelism, dependencies, failures, timeouts, framing."""

import json
import threading
import time
from typing import Any

from flask import Flask

from aeva.mcp.base import BaseTool, PriorResult, ToolContext, ToolDefinition
from aeva.mcp.registry import ToolRegistry
from aeva.orchestration.agent_runner import AgentRunner
from aeva.orchestration.models import (
    STEP_INPUT_ANSWER,
    STEP_INPUT_MESSAGE,
    STEP_KIND_ANSWER,
    STEP_KIND_GENERATOR,
    Step,
)


class _Tool(BaseTool):
    def __init__(
        self,
        name: str,
        *,
        delay: float = 0.0,
        fail: bool = False,
        stream: bool = False,
        result: dict[str, Any] | None = None,
    ) -> None:
        self._name = name
        self._delay = delay
        self._fail = fail
        self._stream = stream
        self._result = result or {}
        self.calls: list[ToolContext] = []
        self.threads: set[int] = set()
        self.started: list[float] = []

    @property
    def definition(self) -> ToolDefinition:
        return ToolDefinition(self._name, "", {"type": "object"})

    def can_stream(self) -> bool:
        return self._stream

    def execute(self, ctx: ToolContext, params: dict[str, Any]) -> dict:
        self.calls.append(ctx)
        self.threads.add(threading.get_ident())
        self.started.append(time.perf_counter())
        ctx.note("working")
        time.sleep(self._delay)
        if self._fail:
            msg = "boom"
            raise RuntimeError(msg)
        return {"answer": f"{self._name} done", **self._result}

    def execute_stream(self, ctx: ToolContext, params: dict[str, Any]):
        self.calls.append(ctx)
        for word in ("hello ", "world"):
            time.sleep(self._delay / 2)
            yield word
        return {"answer": "hello world", "sources": [{"title": "s", "url": "u"}]}


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


def _run(app: Flask, registry: ToolRegistry, steps: list[Step], **kw):
    runner = AgentRunner(
        registry,
        app,
        build_ctx=lambda step, prior: ToolContext(
            user_id="u", session_id="s", message="m", enriched_message="m",
            media_ids=None, prior_results=list(prior),
        ),
        stream_answer=_passthrough,
        split_meta=_split,
        format_display=_display,
        **kw,
    )
    frames: list[dict] = []
    gen = runner.run(steps)
    try:
        while True:
            frames.append(json.loads(next(gen)[len("data: "):]))
    except StopIteration as stop:
        return frames, stop.value


def _app() -> Flask:
    app = Flask(__name__)
    app.config["X"] = 1
    return app


def _gen(id_: str, tool: str, input_: str = STEP_INPUT_MESSAGE) -> Step:
    return Step(id=id_, tool=tool, kind=STEP_KIND_GENERATOR, input=input_)


class TestParallelism:
    def test_independent_generators_overlap(self):
        quiz = _Tool("quiz_generator", delay=0.3, result={"questions": [1, 2]})
        cards = _Tool("flashcard_generator", delay=0.3, result={"cards": [1]})
        registry = ToolRegistry()
        registry.register(quiz)
        registry.register(cards)
        steps = [_gen("gen1", "quiz_generator"), _gen("gen2", "flashcard_generator")]
        t0 = time.perf_counter()
        with _app().app_context():
            frames, outcome = _run(_app(), registry, steps)
        wall = time.perf_counter() - t0
        assert wall < 0.55, wall  # ran together, not 0.6 s in sequence
        assert quiz.threads
        assert cards.threads
        assert quiz.threads != cards.threads
        assert outcome.parallel is True
        assert outcome.tools_used == ["quiz_generator", "flashcard_generator"]
        assert outcome.result["quiz"]["questions"] == [1, 2]
        assert outcome.result["flashcards"]["cards"] == [1]
        # Lines are streamed in completion order; the first one leads.
        assert outcome.display_text.count("created") == 2
        assert outcome.display_text.startswith("I've created")
        assert "I've also created" in outcome.display_text
        streamed = "".join(
            f["content"] for f in frames if isinstance(f.get("content"), str)
        )
        assert streamed == outcome.display_text
        assert outcome.result["answer"] == outcome.display_text
        types = [f.get("type") for f in frames]
        assert types[0] == "agents_planned"
        assert types[1] == "tool_selected"
        statuses = [
            (f["id"], f["status"]) for f in frames if f.get("type") == "agent_status"
        ]
        assert ("gen1", "running") in statuses
        assert ("gen1", "done") in statuses
        assert ("gen2", "done") in statuses
        assert any(f.get("note") == "working" for f in frames)

    def test_dependent_waits_for_answer_and_gets_prior(self):
        answer = _Tool("general", delay=0.2, stream=True)
        cards = _Tool("flashcard_generator", delay=0.05, result={"cards": [1]})
        registry = ToolRegistry()
        registry.register(answer)
        registry.register(cards)
        steps = [
            Step(id="answer", tool="general", kind=STEP_KIND_ANSWER),
            _gen("gen1", "flashcard_generator", STEP_INPUT_ANSWER),
        ]
        with _app().app_context():
            frames, outcome = _run(_app(), registry, steps)
        # The generator started only after the answer stream finished.
        prior = cards.calls[0].prior_results
        assert isinstance(prior[0], PriorResult)
        assert prior[0].text == "hello world"
        assert prior[0].sources == [{"title": "s", "url": "u"}]
        assert outcome.tool_used == "general"
        assert outcome.result["answer"].startswith("hello world")
        assert "I've also created the" in outcome.result["answer"]
        assert outcome.result["flashcards"]["cards"] == [1]
        assert outcome.result["sources"] == [{"title": "s", "url": "u"}]
        # Text tokens precede the generator's completion.
        idx_text = next(i for i, f in enumerate(frames) if f.get("content") == "hello ")
        idx_done = next(
            i for i, f in enumerate(frames)
            if f.get("type") == "agent_status" and f["id"] == "gen1" and f["status"] == "done"
        )
        assert idx_text < idx_done


class TestFailures:
    def test_failure_does_not_cancel_sibling(self):
        bad = _Tool("quiz_generator", fail=True)
        good = _Tool("flashcard_generator", delay=0.05, result={"cards": [1]})
        registry = ToolRegistry()
        registry.register(bad)
        registry.register(good)
        steps = [_gen("gen1", "quiz_generator"), _gen("gen2", "flashcard_generator")]
        with _app().app_context():
            frames, outcome = _run(_app(), registry, steps)
        by_id = {a["id"]: a for a in outcome.result["agents"]}
        assert by_id["gen1"]["status"] == "failed"
        assert by_id["gen1"]["error"] == "RuntimeError"
        assert by_id["gen2"]["status"] == "done"
        assert outcome.tools_used == ["flashcard_generator"]
        assert "couldn't create the quiz" in outcome.display_text
        assert "flashcards" in outcome.result

    def test_timeout_marks_failed_without_hanging(self):
        slow = _Tool("quiz_generator", delay=1.0)
        registry = ToolRegistry()
        registry.register(slow)
        steps = [_gen("gen1", "quiz_generator")]
        t0 = time.perf_counter()
        with _app().app_context():
            _frames, outcome = _run(
                _app(), registry, steps, step_timeout_s=0.2
            )
        assert time.perf_counter() - t0 < 0.9
        assert outcome.result["agents"][0]["status"] == "failed"
        assert outcome.result["agents"][0]["error"] == "timeout"

    def test_single_generator_keeps_flat_shape(self):
        quiz = _Tool("quiz_generator", result={"quiz_id": "q1", "questions": [1]})
        registry = ToolRegistry()
        registry.register(quiz)
        with _app().app_context():
            _frames, outcome = _run(_app(), registry, [_gen("gen1", "quiz_generator")])
        assert outcome.result["quiz_id"] == "q1"
        assert "quiz" not in outcome.result
        assert outcome.parallel is False
        assert outcome.tool_used == "quiz_generator"
        # The tool's own sentence is streamed as content (not just composed).
        chunks = [f["content"] for f in _frames if isinstance(f.get("content"), str)]
        assert "".join(chunks) == outcome.display_text
        assert outcome.display_text


class TestAppContextInWorkers:
    def test_tool_reads_config_in_worker_thread(self):
        class Cfg(_Tool):
            def execute(self, ctx: ToolContext, params: dict[str, Any]) -> dict:
                from flask import current_app

                return {"answer": str(current_app.config["X"]), "cards": []}

        tool = Cfg("flashcard_generator")
        registry = ToolRegistry()
        registry.register(tool)
        app = _app()
        with app.app_context():
            _frames, outcome = _run(app, registry, [_gen("gen1", "flashcard_generator")])
        assert outcome.result["answer"] == "1"
