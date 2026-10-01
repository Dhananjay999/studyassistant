"""The turn_trace service on its own: decorators, guards and the flush.

``test_tracing_orchestrator.py`` checks what a real turn records. This file
checks the mechanics every decorator promises, on small stand-in functions:
the wrapped call is untouched (arguments, result, exceptions, generator
protocol), nothing happens without a trace, and a fault in the bookkeeping
never reaches the caller.
"""

import threading
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest
from flask import Flask, jsonify

from aeva import tracing
from aeva.tracing import recorder, store
from aeva.tracing.services import turn_trace

USER = "22222222-2222-2222-2222-222222222222"
SESSION = "11111111-1111-1111-1111-111111111111"

# Every decorator built on the shared observer (all but the turn wrappers
# and the flush).
OBSERVERS = (
    turn_trace.setup,
    turn_trace.resumed_run,
    turn_trace.branch_forced,
    turn_trace.named_files,
    turn_trace.branch_media_choice,
    turn_trace.branch_continuation,
    turn_trace.branch_fast_path,
    turn_trace.branch_planner,
    turn_trace.rule_clarify,
    turn_trace.rule_web_upgrade,
    turn_trace.rule_media_guard,
    turn_trace.outcome_quiz_setup,
    turn_trace.outcome_clarification,
    turn_trace.roster,
    turn_trace.finish,
    turn_trace.answer_saved,
)
ALL_DECORATORS = (
    *OBSERVERS,
    turn_trace.turn,
    turn_trace.flush_after_response,
)


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    recorder._BINDING.set(None)
    monkeypatch.setattr(store, "_unavailable_until", 0.0)
    for key in ("AI_TRACE_ENABLED", "AI_TRACE_SCOPE", "AI_TRACE_SAMPLE_RATE"):
        monkeypatch.delenv(key, raising=False)
    yield
    recorder._BINDING.set(None)


@pytest.fixture
def saved(monkeypatch):
    box: dict = {"writes": 0}

    def fake_persist(trace_row, span_rows, prompt_rows):
        box["trace"] = trace_row
        box["spans"] = span_rows
        box["writes"] += 1
        return True

    monkeypatch.setattr(store, "persist", fake_persist)
    return box


def _begin() -> None:
    assert tracing.start_turn(user_id=USER, message="m", endpoint="stream")


def _ctx(**over: Any) -> SimpleNamespace:
    values = {
        "user_id": USER,
        "session_id": SESSION,
        "message": "what is osmosis?",
        "media_ids": None,
        "run_id": None,
        "clarification": None,
        "quiz_options": None,
        "flashcard_options": None,
        "source_content": None,
    }
    values.update(over)
    return SimpleNamespace(**values)


def _names(saved: dict) -> list[str]:
    return [span["name"] for span in saved["spans"]]


# ----------------------------------------------------- what every one keeps


class TestEveryDecorator:
    @pytest.mark.parametrize("decorator", ALL_DECORATORS)
    def test_is_a_pass_through_without_a_trace(self, decorator, monkeypatch):
        def fail(*_args: Any, **_kwargs: Any) -> None:
            raise AssertionError("trace bookkeeping ran without a trace")

        monkeypatch.setenv("AI_TRACE_ENABLED", "false")
        calls: list[tuple] = []

        @decorator
        def work(ctx: Any, plan: Any = None, *, extra: int = 0) -> list:
            """Docstring of work."""
            calls.append((ctx, plan, extra))
            return [ctx, plan, extra]

        if decorator in OBSERVERS:
            monkeypatch.setattr(turn_trace, "_arguments", fail)
            monkeypatch.setattr(turn_trace, "_guard", fail)
        marker = object()
        ctx = _ctx()
        result = work(ctx, marker, extra=3)
        assert result == [ctx, marker, 3]
        assert result[1] is marker
        assert calls == [(ctx, marker, 3)]
        assert not tracing.is_active()
        assert work.__name__ == "work"
        assert work.__doc__ == "Docstring of work."

    @pytest.mark.parametrize("decorator", ALL_DECORATORS)
    def test_the_wrapped_exception_propagates_unchanged(self, decorator, saved):
        error = KeyError("the wrapped function's own failure")

        @decorator
        def work(ctx: Any, plan: Any = None) -> None:
            raise error

        _begin()
        with pytest.raises(KeyError) as raised:
            work(_ctx(), {"action": "clarify"})
        assert raised.value is error
        tracing.finish_turn()

    @pytest.mark.parametrize("decorator", OBSERVERS)
    def test_arguments_it_cannot_read_never_break_the_call(
        self, decorator, saved
    ):
        # None of these parameters is what the bookkeeping expects.
        @decorator
        def work(alpha: Any, beta: Any = None) -> Any:
            return (alpha, beta)

        _begin()
        marker = object()
        assert work(marker, beta=7) == (marker, 7)
        tracing.finish_turn()
        assert saved["trace"]["status"] == "completed"

    @pytest.mark.parametrize("decorator", OBSERVERS)
    def test_result_is_returned_as_is_inside_a_trace(self, decorator, saved):
        result = MagicMock()

        class Host:
            @staticmethod
            @decorator
            def static(plan: Any, ctx: Any, message: str = "") -> Any:
                return result

            @decorator
            def method(self, ctx: Any, plan: Any, message: str = "") -> Any:
                return result

        _begin()
        assert Host.static({"action": "run_tool"}, _ctx(), "hi") is result
        assert Host().static({"action": "run_tool"}, _ctx()) is result
        assert Host().method(_ctx(), {"action": "run_tool"}, "hi") is result
        tracing.finish_turn()

    def test_a_base_exception_is_not_swallowed(self, saved):
        @turn_trace.branch_planner
        def work(ctx: Any) -> None:
            raise KeyboardInterrupt

        _begin()
        with pytest.raises(KeyboardInterrupt):
            work(_ctx())


# --------------------------------------------------------- turn lifecycle


class _Turns:
    """Stand-in for the orchestrator's two entry points."""

    def __init__(self) -> None:
        self.received: list[Any] = []
        self.closed = False

    @turn_trace.turn
    def run(self, ctx: Any) -> str:
        if ctx.message == "boom":
            raise ValueError("sync failure")
        return f"answer to {ctx.message}"

    @turn_trace.turn_stream
    def run_stream(self, ctx: Any):
        try:
            self.received.append((yield "frame-1"))
            if ctx.message == "boom":
                raise ValueError("stream failure")
            try:
                self.received.append((yield "frame-2"))
            except LookupError as exc:
                self.received.append(exc)
                yield "recovered"
            return "the return value"
        finally:
            self.closed = True


class TestTurn:
    def test_run_records_a_sync_turn_and_returns_the_result(self, saved):
        ctx = _ctx()
        assert _Turns().run(ctx) == "answer to what is osmosis?"
        assert tracing.is_active()  # written later, by the flush
        assert saved["writes"] == 0
        tracing.finish_turn()
        assert saved["trace"]["endpoint"] == "sync"
        assert saved["trace"]["user_id"] == USER
        assert saved["trace"]["query"] == "what is osmosis?"
        assert saved["spans"][0]["input"] == {
            "message": "what is osmosis?",
            "media_ids": None,
            "run_id": None,
            "clarification": None,
            "quiz_options": None,
            "flashcard_options": None,
            "source_content_chars": 0,
        }

    def test_run_failure_marks_the_trace_and_propagates(self, saved):
        with pytest.raises(ValueError, match="sync failure"):
            _Turns().run(_ctx(message="boom"))
        tracing.finish_turn()
        assert saved["trace"]["status"] == "error"
        assert saved["trace"]["error"] == "ValueError: sync failure"

    def test_run_with_an_argument_that_is_no_context(self, saved):
        # Nothing to start a trace from; the call itself is untouched.
        assert _Turns.run.__wrapped__ is not None
        with pytest.raises(AttributeError):
            _Turns().run(None)
        assert not tracing.is_active()


class TestTurnStream:
    def test_nothing_runs_before_the_first_next(self, saved):
        host = _Turns()
        stream = host.run_stream(_ctx())
        assert not tracing.is_active()
        stream.close()
        assert not tracing.is_active()
        assert host.closed is False

    @pytest.mark.parametrize("enabled", ["true", "false"])
    def test_frames_send_and_return_value(self, saved, monkeypatch, enabled):
        monkeypatch.setenv("AI_TRACE_ENABLED", enabled)
        host = _Turns()
        stream = host.run_stream(_ctx())
        assert next(stream) == "frame-1"
        assert tracing.is_active() is (enabled == "true")
        assert stream.send("sent-1") == "frame-2"
        with pytest.raises(StopIteration) as stop:
            stream.send("sent-2")
        assert stop.value.value == "the return value"
        assert host.received == ["sent-1", "sent-2"]
        assert host.closed is True
        tracing.finish_turn()
        if enabled == "true":
            assert saved["trace"]["status"] == "completed"
            assert saved["trace"]["endpoint"] == "stream"
        else:
            assert saved["writes"] == 0

    def test_throw_reaches_the_wrapped_generator(self, saved):
        host = _Turns()
        stream = host.run_stream(_ctx())
        next(stream)
        next(stream)
        assert stream.throw(LookupError("thrown in")) == "recovered"
        assert isinstance(host.received[-1], LookupError)
        with pytest.raises(StopIteration):
            next(stream)
        tracing.finish_turn()
        assert saved["trace"]["status"] == "completed"

    def test_close_runs_the_wrapped_cleanup_and_marks_aborted(self, saved):
        host = _Turns()
        stream = host.run_stream(_ctx())
        next(stream)
        stream.close()
        assert host.closed is True
        tracing.finish_turn()
        assert saved["trace"]["status"] == "aborted"
        assert saved["spans"][0]["status"] == "aborted"

    def test_failure_marks_the_trace_and_propagates(self, saved):
        host = _Turns()
        stream = host.run_stream(_ctx(message="boom"))
        next(stream)
        with pytest.raises(ValueError, match="stream failure"):
            next(stream)
        assert host.closed is True
        tracing.finish_turn()
        assert saved["trace"]["status"] == "error"
        assert saved["trace"]["error"] == "ValueError: stream failure"

    def test_open_spans_are_closed_when_the_turn_fails(self, saved):
        class Host:
            @turn_trace.setup
            def _setup_and_plan(self, ctx: Any) -> Any:
                return self._forced_plan(ctx, None)

            @turn_trace.branch_forced
            def _forced_plan(self, ctx: Any, media_choice_ids: Any) -> Any:
                raise RuntimeError("routing failed")

            @turn_trace.turn
            def run(self, ctx: Any) -> Any:
                return self._setup_and_plan(ctx)

        with pytest.raises(RuntimeError, match="routing failed"):
            Host().run(_ctx())
        tracing.finish_turn()
        spans = {span["name"]: span for span in saved["spans"]}
        assert spans["load_context"]["status"] == "error"
        assert spans["route"]["status"] == "error"
        assert "routing failed" in spans["route"]["error"]


# ------------------------------------------------------------- small calls


class TestLinkAndMessages:
    def test_link_is_empty_without_a_trace(self):
        assert turn_trace.link() == {}
        assert {"status": "completed", **turn_trace.link()} == {
            "status": "completed"
        }

    def test_link_carries_the_trace_id(self, saved):
        _begin()
        link = turn_trace.link()
        assert tracing.finish_turn() == link["trace_id"]
        assert list(link) == ["trace_id"]

    def test_link_is_empty_once_the_turn_is_not_kept(self, monkeypatch):
        monkeypatch.setenv("AI_TRACE_SCOPE", "debug_users")
        _begin()
        turn_trace.context_loaded(
            _ctx(), {"id": SESSION}, {"is_debug_user": False}, [], "", "m"
        )
        assert turn_trace.link() == {}

    def test_user_message_returns_the_row_untouched(self, saved):
        row = {"id": "00000000-0000-0000-0000-000000000001", "role": "user"}
        assert turn_trace.user_message(row) is row  # no trace: nothing else
        _begin()
        assert turn_trace.user_message(row) is row
        tracing.finish_turn()
        assert saved["trace"]["user_message_id"] == row["id"]
        assert "user_message" in _names(saved)

    def test_context_loaded_does_nothing_without_a_trace(self, monkeypatch):
        def fail(*_args: Any) -> None:
            raise AssertionError("context built without a trace")

        monkeypatch.setattr(turn_trace, "_context_loaded", fail)
        turn_trace.context_loaded(_ctx(), {}, None, [], "", "m")

    def test_session_loaded_links_the_session(self, saved):
        turn_trace.session_loaded(_ctx())  # no trace: nothing happens
        _begin()
        turn_trace.session_loaded(_ctx())
        turn_trace.session_loaded(object())  # nothing to link, no failure
        tracing.finish_turn()
        assert saved["trace"]["session_id"] is None

        _begin()
        turn_trace.session_loaded(_ctx())
        tracing.finish_turn()
        assert saved["trace"]["session_id"] == SESSION

    def test_context_loaded_records_what_the_turn_runs_on(self, saved):
        _begin()
        turn_trace.session_loaded(_ctx())
        turn_trace.context_loaded(
            _ctx(),
            {"id": SESSION, "title": "T", "study_spaces": None},
            {"full_name": "Asha", "preferred_language": "Hindi"},
            [{"role": "user", "content": "hi"}],
            "Student's name: Asha.",
            "what is osmosis?",
        )
        tracing.finish_turn()
        assert saved["trace"]["session_id"] == SESSION
        assert saved["trace"]["meta"]["is_debug_user"] is False
        context = next(s for s in saved["spans"] if s["name"] == "load_context")
        assert context["kind"] == "context"
        assert context["output"]["history_messages"] == 1
        assert context["output"]["preferred_language"] == "Hindi"
        assert context["output"]["clarification_resume"] is None
        assert [
            p["part"] for p in context["output"]["personalization_parts"]
        ] == [
            "identity",
            "learning_profile",
            "study_space",
        ]

    def test_resumed_run_links_only_a_run_that_exists(self, saved):
        found = {"id": "r", "original_message": "explain this", "plan": {}}
        run_id = "22222222-2222-2222-2222-222222222222"

        class Host:
            @turn_trace.resumed_run
            def _get_run(self, run_id: str, user_id: str) -> Any:
                return found if user_id == "owner" else None

        _begin()
        assert Host()._get_run(run_id, "someone else") is None
        assert tracing.state().get(turn_trace._RUN) is None
        assert Host()._get_run(run_id, "owner") is found
        assert tracing.state()[turn_trace._RUN] is found
        tracing.finish_turn()
        assert saved["trace"]["run_id"] == run_id


# ------------------------------------------------------------------ rules


def _plan(tool: str) -> dict:
    return {
        "action": "run_tool",
        "steps": [{"tool": tool, "params": {"query": "q"}}],
    }


@turn_trace.rule_web_upgrade
def _swap_answer(plan: dict, message: str, to: str | None = None) -> dict:
    """Stand-in rule: optionally replace the answer step's tool."""
    if to is not None:
        plan["steps"][0] = {**plan["steps"][0], "tool": to}
    return plan


@turn_trace.rule_media_guard
def _divert(plan: dict, ctx: Any, message: str, to: str | None = None) -> dict:
    if to is not None:
        plan["steps"][0] = {**plan["steps"][0], "tool": to}
    return plan


class TestRules:
    def test_web_upgrade_is_recorded_only_for_general_to_web_search(
        self, saved
    ):
        _begin()
        _swap_answer(_plan("general"), "best phones", None)
        _swap_answer(_plan("general"), "best phones", "media_llm")
        _swap_answer(_plan("web_search"), "best phones", "web_search")
        _swap_answer(_plan("quiz_generator"), "best phones", "web_search")
        assert "web_upgrade" not in [
            span.name for span in recorder._BINDING.get()[0]._spans
        ]
        _swap_answer(_plan("general"), "best phones", "web_search")
        tracing.finish_turn()
        assert _names(saved).count("web_upgrade") == 1
        upgrade = next(s for s in saved["spans"] if s["name"] == "web_upgrade")
        assert upgrade["input"]["tool"] == "general"
        assert upgrade["output"]["tool"] == "web_search"
        assert upgrade["kind"] == "decision"

    def test_media_guard_is_recorded_only_for_a_diversion_to_the_files(
        self, saved
    ):
        ctx = _ctx(media_ids=["m1", "m2"])
        _begin()
        _divert(_plan("general"), ctx, "x", None)
        _divert(_plan("media_llm"), ctx, "x", "media_llm")
        _divert(_plan("product_info"), ctx, "x", "media_llm")
        _divert(_plan("general"), ctx, "x", "web_search")
        _divert(_plan("web_search"), ctx, "x", "media_llm")
        tracing.finish_turn()
        assert _names(saved).count("media_guard") == 1
        guard = next(s for s in saved["spans"] if s["name"] == "media_guard")
        assert guard["input"]["tool"] == "web_search"
        assert "2 file(s) are selected" in guard["meta"]["reason"]
        assert "no fresh-information cue" in guard["meta"]["reason"]

    def test_clarify_rule_needs_a_clarify_plan_that_was_replaced(self, saved):
        asked = {"action": "clarify", "clarification": {"questions": []}}
        fallback = _plan("general")

        @turn_trace.rule_clarify
        def refine(plan: dict, ctx: Any, *, replace: bool) -> dict:
            return fallback if replace else plan

        _begin()
        refine(_plan("general"), _ctx(), replace=True)
        refine(asked, _ctx(), replace=False)
        tracing.finish_turn()
        assert not {"clarify_skipped", "clarify_blocked"} & set(_names(saved))

        _begin()
        refine(asked, _ctx(), replace=True)
        refine(asked, _ctx(clarification=object()), replace=True)
        tracing.finish_turn()
        names = [n for n in _names(saved) if n.startswith("clarify")]
        assert names == ["clarify_skipped", "clarify_blocked"]
        skipped = next(
            s for s in saved["spans"] if s["name"] == "clarify_skipped"
        )
        assert skipped["input"] == asked
        assert skipped["output"] == fallback

    def test_a_failed_refinement_leaves_no_pending_clarify(self, saved):
        @turn_trace.rule_clarify
        def refine(plan: dict, ctx: Any) -> dict:
            raise RuntimeError("fallback failed")

        _begin()
        with pytest.raises(RuntimeError):
            refine({"action": "clarify"}, _ctx())
        assert turn_trace._CLARIFY not in tracing.state()
        # A later rule call does not inherit the failed refinement's plan.
        _swap_answer(_plan("general"), "x", None)
        tracing.finish_turn()
        assert not [n for n in _names(saved) if n.startswith("clarify")]


# ------------------------------------------------------------------ flush


def _flask_app(handler: Any, *, testing: bool = True) -> Flask:
    app = Flask(__name__)
    app.config["TESTING"] = testing
    app.add_url_rule("/turn", "turn", handler, methods=["POST"])
    return app


class TestFlush:
    def test_flush_writes_the_turn(self, saved):
        _begin()
        turn_trace.flush()
        assert saved["writes"] == 1
        assert not tracing.is_active()
        turn_trace.flush()  # nothing recorded: nothing to do
        assert saved["writes"] == 1

    def test_after_response_waits_for_the_response_to_close(self, saved):
        seen: dict = {}

        @turn_trace.flush_after_response
        def process() -> dict:
            _begin()
            seen["trace_id"] = tracing.trace_id()
            return {"answer": 42}

        app = _flask_app(lambda: jsonify(process()))
        response = app.test_client().post("/turn", buffered=False)
        assert saved["writes"] == 0
        assert b"".join(response.response).strip() == b'{"answer":42}'
        assert saved["writes"] == 0
        response.close()
        assert saved["writes"] == 1
        assert saved["trace"]["id"] == seen["trace_id"]
        assert not tracing.is_active()

    def test_after_response_also_when_the_handler_raised(self, saved):
        @turn_trace.flush_after_response
        def process() -> dict:
            _begin()
            tracing.fail_turn(RuntimeError("turn failed"))
            raise RuntimeError("turn failed")

        app = _flask_app(lambda: jsonify(process()), testing=False)
        response = app.test_client().post("/turn", buffered=False)
        assert response.status_code == 500
        assert saved["writes"] == 0
        response.close()
        assert saved["writes"] == 1
        assert saved["trace"]["status"] == "error"

    def test_after_response_from_another_thread(self, saved):
        @turn_trace.flush_after_response
        def process() -> dict:
            _begin()
            return {}

        app = _flask_app(lambda: jsonify(process()))
        response = app.test_client().post("/turn", buffered=False)
        closer = threading.Thread(target=response.close)
        closer.start()
        closer.join()
        assert saved["writes"] == 1

    def test_no_request_means_the_trace_is_dropped_not_written(self, saved):
        @turn_trace.flush_after_response
        def process() -> str:
            _begin()
            return "done"

        assert process() == "done"
        assert saved["writes"] == 0
        assert not tracing.is_active()
        assert tracing.finish_turn() is None

    def test_a_response_that_cannot_take_the_hook_drops_the_trace(
        self, saved, monkeypatch
    ):
        import flask

        def refuse(_func: Any) -> None:
            raise RuntimeError("no after-request hooks here")

        monkeypatch.setattr(flask, "after_this_request", refuse)

        @turn_trace.flush_after_response
        def process() -> dict:
            _begin()
            return {}

        app = _flask_app(lambda: jsonify(process()))
        response = app.test_client().post("/turn")
        assert response.status_code == 200
        assert saved["writes"] == 0
        assert not tracing.is_active()

    def test_without_a_trace_flask_is_not_touched(self, saved, monkeypatch):
        import flask

        def fail(_func: Any) -> None:
            raise AssertionError("hook registered without a trace")

        monkeypatch.setattr(flask, "after_this_request", fail)
        app = _flask_app(
            lambda: jsonify(turn_trace.flush_after_response(dict)())
        )
        assert app.test_client().post("/turn").status_code == 200
        assert saved["writes"] == 0
