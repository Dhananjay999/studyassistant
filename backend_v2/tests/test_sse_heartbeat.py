"""SSE keep-alive contract (``aeva.orchestration.heartbeat``).

A streaming turn that is silent while a tool waits on its model must still
send ``ping`` frames, and wrapping a frame generator must not change its
frames, its return value, its exceptions or the context it runs in.
"""

import contextvars
import json
import time
from collections.abc import Generator

import pytest

from aeva.orchestration import heartbeat

INTERVAL = 0.05


def _frames(raw: list[str]) -> list[dict]:
    return [json.loads(f[len("data: ") :]) for f in raw]


def _drain(gen: Generator[str, None, object]) -> tuple[list[dict], object]:
    out: list[str] = []
    try:
        while True:
            out.append(next(gen))
    except StopIteration as stop:
        return _frames(out), stop.value


class TestPassThrough:
    def test_frames_and_return_value_are_unchanged(self):
        def source():
            yield 'data: {"content": "a", "done": false}\n\n'
            yield 'data: {"content": "b", "done": false}\n\n'
            return {"tool": "general"}

        frames, result = _drain(
            heartbeat.keep_alive(source(), interval_s=INTERVAL)
        )
        assert [f["content"] for f in frames] == ["a", "b"]
        assert result == {"tool": "general"}

    def test_exceptions_propagate_to_the_consumer(self):
        def source():
            yield 'data: {"content": "a", "done": false}\n\n'
            raise RuntimeError("model down")

        gen = heartbeat.keep_alive(source(), interval_s=INTERVAL)
        next(gen)
        with pytest.raises(RuntimeError, match="model down"):
            next(gen)

    def test_context_variables_reach_the_worker(self):
        marker: contextvars.ContextVar[str] = contextvars.ContextVar(
            "heartbeat_test_marker", default="unset"
        )
        marker.set("request-thread-value")

        def source():
            yield f"data: {json.dumps({'content': marker.get()})}\n\n"

        frames, _ = _drain(heartbeat.keep_alive(source(), interval_s=INTERVAL))
        assert frames[0]["content"] == "request-thread-value"


class TestPings:
    def test_silent_gap_yields_ping_frames_then_the_real_frame(self):
        def source():
            yield 'data: {"content": "start", "done": false}\n\n'
            time.sleep(INTERVAL * 5)
            yield 'data: {"content": "late", "done": false}\n\n'
            return "ok"

        frames, result = _drain(
            heartbeat.keep_alive(source(), interval_s=INTERVAL)
        )
        pings = [f for f in frames if f.get("type") == "ping"]
        assert len(pings) >= 2
        # A ping is a typed frame with no content, so the client's text
        # handler ignores it and the done flag is untouched.
        assert pings[0] == {"type": "ping", "content": "", "done": False}
        contents = [f["content"] for f in frames if f.get("type") != "ping"]
        assert contents == ["start", "late"]
        assert result == "ok"

    def test_no_ping_when_frames_keep_coming(self):
        def source():
            for i in range(5):
                yield f"data: {json.dumps({'content': str(i)})}\n\n"

        frames, _ = _drain(heartbeat.keep_alive(source(), interval_s=INTERVAL))
        assert not [f for f in frames if f.get("type") == "ping"]

    def test_ping_frame_shape(self):
        frame = heartbeat.ping_frame()
        assert frame.startswith("data: ")
        assert json.loads(frame[len("data: ") :]) == {
            "type": "ping",
            "content": "",
            "done": False,
        }


class TestEarlyClose:
    def test_source_cleanup_runs_when_the_consumer_stops(self):
        closed: list[str] = []

        def source():
            try:
                yield 'data: {"content": "a"}\n\n'
                yield 'data: {"content": "b"}\n\n'
                yield 'data: {"content": "c"}\n\n'
            finally:
                closed.append("yes")

        gen = heartbeat.keep_alive(source(), interval_s=INTERVAL)
        next(gen)
        gen.close()
        deadline = time.monotonic() + 2
        while not closed and time.monotonic() < deadline:
            time.sleep(0.01)
        assert closed == ["yes"]
