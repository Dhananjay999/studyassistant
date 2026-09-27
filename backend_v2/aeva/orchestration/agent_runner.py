"""Run one turn's planned steps as a small team of agents.

A turn has at most one *answer* agent (it streams text) and up to three
*generator* agents (quiz, flashcards, image — they produce artifacts). The
runner owns the concurrency and the client-facing progress protocol:

- generators whose ``input`` is ``"message"`` start immediately in a thread
  pool, in parallel with the streaming answer and with each other;
- generators whose ``input`` is ``"answer"`` start once the answer agent has
  finished, receiving its text as ``PriorResult``;
- the request thread is the ONLY one that yields SSE frames — workers push
  events onto a queue that is drained between answer tokens and while
  waiting for stragglers, so ``agent_status`` frames interleave with text;
- every agent is bounded by a timeout and a failure never cancels its
  siblings: the turn always completes with whatever succeeded.

Frames: ``agents_planned`` (the roster, once), ``tool_selected`` (unchanged
legacy frame for the primary tool), ``agent_status`` (queued / running /
done / failed, with a short note), plus ordinary content chunks. Single-step
turns emit exactly what they did before plus the two roster frames.
"""

import logging
import queue
import time
from collections.abc import Callable, Generator
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any

from flask import Flask

from aeva.llm.llm_client import LLMClient
from aeva.mcp.base import PriorResult, ToolContext
from aeva.mcp.registry import ToolRegistry
from aeva.orchestration.models import (
    STEP_INPUT_ANSWER,
    STEP_KIND_ANSWER,
    STEP_KIND_GENERATOR,
    Step,
)

logger = logging.getLogger(__name__)

STATUS_QUEUED = "queued"
STATUS_RUNNING = "running"
STATUS_DONE = "done"
STATUS_FAILED = "failed"

_DRAIN_WAIT_S = 0.25

# Friendly noun per generator, for the failure note.
_AGENT_NOUN = {
    "quiz_generator": "quiz",
    "flashcard_generator": "flashcards",
    "image_generator": "image",
}

BuildCtx = Callable[[Step, list[PriorResult]], ToolContext]
StreamAnswer = Callable[
    [Generator[str, None, dict[str, Any]]],
    Generator[str, None, tuple[str, dict[str, Any]]],
]
SplitMeta = Callable[[str], tuple[str, dict[str, Any]]]
FormatDisplay = Callable[[str, dict[str, Any]], str]


@dataclass
class AgentOutcome:
    """Terminal state of one agent."""

    step: Step
    status: str = STATUS_QUEUED
    ms: int = 0
    note: str | None = None
    result: dict[str, Any] | None = None
    error: str | None = None

    def to_public(self) -> dict[str, Any]:
        """Client-facing summary persisted with the message."""
        data = {
            **self.step.to_public(),
            "status": self.status,
            "ms": self.ms,
        }
        if self.note:
            data["note"] = self.note
        if self.error:
            data["error"] = self.error
        return data


@dataclass
class TeamOutcome:
    """Everything the orchestrator needs after the agents finished."""

    display_text: str
    result: dict[str, Any]
    tool_used: str
    tools_used: list[str]
    agents: list[AgentOutcome]
    meta: dict[str, Any] = field(default_factory=dict)
    streamed: bool = False
    parallel: bool = False
    primary_model: str | None = None
    primary_config_key: str | None = None


def _frame(payload: dict[str, Any]) -> str:
    """Build a typed (non-content) SSE frame."""
    return LLMClient.format_sse_chunk("", extra=payload)


class AgentRunner:
    """Execute a normalized step list, streaming progress as SSE frames."""

    def __init__(
        self,
        registry: ToolRegistry,
        app: Flask,
        *,
        build_ctx: BuildCtx,
        stream_answer: StreamAnswer,
        split_meta: SplitMeta,
        format_display: FormatDisplay,
        max_parallel: int = 3,
        step_timeout_s: float = 90.0,
    ) -> None:
        self._registry = registry
        self._app = app
        self._build_ctx = build_ctx
        self._stream_answer = stream_answer
        self._split_meta = split_meta
        self._format_display = format_display
        self._max_parallel = max(1, max_parallel)
        self._timeout_s = step_timeout_s
        self._events: queue.Queue[tuple[str, str, Any]] = queue.Queue()
        self._futures: dict[str, Future[None]] = {}
        self._started: dict[str, float] = {}
        self._outcomes: dict[str, AgentOutcome] = {}
        self._pool: ThreadPoolExecutor | None = None
        # Everything streamed to the client as content so far. Generator
        # summary lines are appended as each agent finishes — but held
        # back while the answer is still streaming, so a line never lands
        # in the middle of a sentence.
        self._text = ""
        self._holding = False
        self._held: list[str] = []
        self._single = False
        self._has_answer = False

    # ------------------------------------------------------------------ run

    def run(self, steps: list[Step]) -> Generator[str, None, TeamOutcome]:
        """Run the steps; yields SSE frames, returns the composed outcome."""
        answer = next((s for s in steps if s.kind == STEP_KIND_ANSWER), None)
        generators = [s for s in steps if s.kind == STEP_KIND_GENERATOR]
        independent = [
            g for g in generators
            if answer is None or g.input != STEP_INPUT_ANSWER
        ]
        dependent = [g for g in generators if g not in independent]
        self._outcomes = {s.id: AgentOutcome(step=s) for s in steps}
        self._single = len(steps) == 1
        self._has_answer = answer is not None
        primary = answer or steps[0]

        yield _frame({
            "type": "agents_planned",
            "agents": [s.to_public() for s in steps],
            "parallel": len(independent) + (1 if answer else 0) > 1,
        })
        yield _frame({"type": "tool_selected", "tool": primary.tool})

        if generators:
            self._pool = ThreadPoolExecutor(max_workers=self._max_parallel)
        try:
            for step in independent:
                yield from self._submit(step, [])

            answer_text = ""
            answer_result: dict[str, Any] = {}
            meta: dict[str, Any] = {}
            streamed = False
            if answer is not None:
                self._holding = True
                answer_text, answer_result, meta, streamed = (
                    yield from self._run_answer(answer)
                )
                self._text = answer_text
                self._holding = False
                yield from self._flush_held()
                prior = [
                    PriorResult(
                        tool=answer.tool,
                        text=answer_text,
                        sources=list(answer_result.get("sources") or []),
                    )
                ]
                for step in dependent:
                    yield from self._submit(step, prior)

            yield from self._drain_until_done()
        finally:
            if self._pool is not None:
                self._pool.shutdown(wait=False, cancel_futures=True)

        return self._compose(
            steps, answer, answer_text, answer_result, meta, streamed=streamed
        )

    # --------------------------------------------------------------- answer

    def _run_answer(
        self, step: Step
    ) -> Generator[str, None, tuple[str, dict[str, Any], dict[str, Any], bool]]:
        """Stream (or run) the answer agent.

        Sibling events are drained between tokens so generator progress
        interleaves with the text. Returns
        ``(answer_text, result, meta, streamed)``.
        """
        outcome = self._outcomes[step.id]
        outcome.status = STATUS_RUNNING
        started = time.perf_counter()
        yield self._status_frame(outcome)
        tool = self._registry.get(step.tool)
        ctx = self._build_ctx(step, [])
        result: dict[str, Any] = {}
        meta: dict[str, Any] = {}
        text = ""
        try:
            if tool.can_stream():
                stream = self._stream_answer(
                    tool.execute_stream(ctx, step.params)
                )
                raw = ""
                try:
                    while True:
                        chunk = next(stream)
                        text += chunk
                        yield LLMClient.format_sse_chunk(chunk)
                        yield from self._drain_nowait()
                except StopIteration as stop:
                    raw, result = stop.value if stop.value else ("", {})
                if not isinstance(result, dict):
                    result = {}
                answer, meta = self._split_meta(raw)
                result["answer"] = answer
                text = answer or self._format_display(step.tool, result)
                if not answer:
                    yield LLMClient.format_sse_chunk(text)
            else:
                result = self._registry.execute(step.tool, ctx, step.params)
                text = self._format_display(step.tool, result)
                yield LLMClient.format_sse_chunk(text)
        except Exception as exc:
            outcome.status = STATUS_FAILED
            outcome.ms = int((time.perf_counter() - started) * 1000)
            outcome.error = type(exc).__name__
            if not text:
                # Nothing reached the student yet: let the normal error
                # path (controller error frame) handle it.
                raise
            logger.exception("Answer agent %s failed mid-stream", step.tool)
            note = "\n\n_I lost the thread there — ask me again to continue._"
            text += note
            yield LLMClient.format_sse_chunk(note)
            yield self._status_frame(outcome)
            return text, {"answer": text}, meta, tool.can_stream()
        outcome.status = STATUS_DONE
        outcome.ms = int((time.perf_counter() - started) * 1000)
        outcome.result = result
        yield self._status_frame(outcome)
        return text, result, meta, tool.can_stream()

    # ----------------------------------------------------------- generators

    def _submit(
        self, step: Step, prior: list[PriorResult]
    ) -> Generator[str, None, None]:
        """Start a generator agent in the pool and announce it."""
        if self._pool is None:
            return
        outcome = self._outcomes[step.id]
        outcome.status = STATUS_RUNNING
        self._started[step.id] = time.perf_counter()
        self._futures[step.id] = self._pool.submit(self._work, step, prior)
        yield self._status_frame(outcome)

    def _work(self, step: Step, prior: list[PriorResult]) -> None:
        """Worker: run one generator inside an app context, report events."""
        started = time.perf_counter()
        with self._app.app_context():
            try:
                ctx = self._build_ctx(step, prior)
                ctx.report = lambda note: self._events.put(
                    ("note", step.id, note)
                )
                result = self._registry.execute(step.tool, ctx, step.params)
            except Exception as exc:  # reported to the client, not raised
                logger.exception("Agent %s failed", step.tool)
                self._events.put(("failed", step.id, (
                    type(exc).__name__,
                    int((time.perf_counter() - started) * 1000),
                )))
                return
        self._events.put(("done", step.id, (
            result,
            int((time.perf_counter() - started) * 1000),
        )))

    def _drain_nowait(self) -> Generator[str, None, None]:
        """Emit every event already queued, without waiting."""
        while True:
            try:
                event = self._events.get_nowait()
            except queue.Empty:
                return
            yield from self._handle_event(event)

    def _drain_until_done(self) -> Generator[str, None, None]:
        """Wait for every running agent (bounded by the timeout)."""
        while self._pending():
            try:
                event = self._events.get(timeout=_DRAIN_WAIT_S)
            except queue.Empty:
                yield from self._expire_timeouts()
                continue
            yield from self._handle_event(event)

    def _pending(self) -> list[str]:
        """Ids of agents still running."""
        return [
            sid
            for sid, outcome in self._outcomes.items()
            if outcome.status == STATUS_RUNNING and sid in self._futures
        ]

    def _expire_timeouts(self) -> Generator[str, None, None]:
        """Mark agents past the per-agent timeout as failed."""
        now = time.perf_counter()
        for sid in self._pending():
            if now - self._started.get(sid, now) <= self._timeout_s:
                continue
            outcome = self._outcomes[sid]
            outcome.status = STATUS_FAILED
            outcome.error = "timeout"
            outcome.ms = int((now - self._started[sid]) * 1000)
            self._futures[sid].cancel()
            logger.warning("Agent %s timed out", outcome.step.tool)
            yield self._status_frame(outcome)
            yield from self._emit_line(self._failure_note(outcome.step))

    def _handle_event(
        self, event: tuple[str, str, Any]
    ) -> Generator[str, None, None]:
        """Turn one worker event into frames (and a summary chunk)."""
        kind, sid, payload = event
        outcome = self._outcomes.get(sid)
        if outcome is None or outcome.status != STATUS_RUNNING:
            return  # late event from a timed-out agent
        if kind == "note":
            outcome.note = str(payload)
            yield self._status_frame(outcome)
            return
        if kind == "failed":
            outcome.status = STATUS_FAILED
            outcome.error, outcome.ms = payload
            outcome.note = None
            yield self._status_frame(outcome)
            yield from self._emit_line(self._failure_note(outcome.step))
            return
        result, ms = payload
        outcome.status = STATUS_DONE
        outcome.result = result if isinstance(result, dict) else {}
        outcome.ms = ms
        outcome.note = self._done_note(outcome.step.tool, outcome.result)
        yield self._status_frame(outcome)
        yield from self._emit_line(
            self._summary_line(outcome.step, outcome.result)
        )

    # ---------------------------------------------------------------- text

    def _emit_line(self, line: str) -> Generator[str, None, None]:
        """Stream one standalone line after whatever text came before."""
        line = line.strip()
        if not line:
            return
        if self._holding:
            self._held.append(line)
            return
        chunk = f"\n\n{line}" if self._text else line
        self._text += chunk
        yield LLMClient.format_sse_chunk(chunk)

    def _flush_held(self) -> Generator[str, None, None]:
        """Stream the lines that arrived while the answer was streaming."""
        held, self._held = self._held, []
        for line in held:
            yield from self._emit_line(line)

    # -------------------------------------------------------------- frames

    @staticmethod
    def _status_frame(outcome: AgentOutcome) -> str:
        """``agent_status`` frame for one agent."""
        payload: dict[str, Any] = {
            "type": "agent_status",
            "id": outcome.step.id,
            "tool": outcome.step.tool,
            "status": outcome.status,
        }
        if outcome.ms:
            payload["ms"] = outcome.ms
        if outcome.note:
            payload["note"] = outcome.note
        if outcome.error:
            payload["error"] = outcome.error
        return _frame(payload)

    @staticmethod
    def _failure_note(step: Step) -> str:
        """Inline note appended to the answer when a generator fails."""
        noun = _AGENT_NOUN.get(step.tool, "that")
        return (
            f"_I couldn't create the {noun} this time — ask me again and "
            "I'll retry._"
        )

    @staticmethod
    def _done_note(tool: str, result: dict[str, Any]) -> str:
        """Short completion note shown on the agent card."""
        if tool == "quiz_generator":
            return f"{len(result.get('questions') or [])} questions ready"
        if tool == "flashcard_generator":
            return f"{len(result.get('cards') or [])} cards ready"
        if tool == "image_generator":
            return "Image ready"
        return "Done"

    # -------------------------------------------------------------- compose

    def _summary_line(self, step: Step, result: dict[str, Any]) -> str:
        """Sentence announcing a finished generator in the answer text.

        A single-agent turn keeps the tool's own display sentence (unchanged
        from before multi-agent turns existed).
        """
        if self._single:
            return self._format_display(step.tool, result)
        first = not self._has_answer and not self._text and not self._held
        lead = "I've created" if first else "I've also created"
        if step.tool == "quiz_generator":
            title = result.get("title", "Quiz")
            count = len(result.get("questions") or [])
            return (
                f"{lead} a **{title}** quiz with {count} questions — open "
                "it below to start."
            )
        if step.tool == "flashcard_generator":
            title = result.get("title", "Flashcards")
            count = len(result.get("cards") or [])
            return (
                f"{lead} the **{title}** flashcard set with {count} cards — "
                "open it to start studying."
            )
        if step.tool == "image_generator":
            label = result.get("style_label") or "image"
            return (
                f"Here's the {str(label).lower()} you asked for — it's saved "
                "in your Study Material."
            )
        return self._format_display(step.tool, result)

    def _compose(
        self,
        steps: list[Step],
        answer: Step | None,
        answer_text: str,
        answer_result: dict[str, Any],
        meta: dict[str, Any],
        *,
        streamed: bool,
    ) -> TeamOutcome:
        """Fold every agent's output into one result + display text."""
        outcomes = [self._outcomes[s.id] for s in steps]
        primary = answer or steps[0]
        # The display text is exactly what was streamed, in stream order.
        text = self._text or answer_text
        if len(steps) == 1:
            result = self._single_result(
                outcomes[0], text, answer_result, is_answer=bool(answer)
            )
            parallel = False
        else:
            result = self._team_result(outcomes, text, answer_result)
            generator_count = sum(
                1 for o in outcomes if o.step.kind == STEP_KIND_GENERATOR
            )
            parallel = generator_count + (1 if answer else 0) > 1
        tools_used = [
            o.step.tool for o in outcomes if o.status == STATUS_DONE
        ] or [primary.tool]
        result.update({
            "tools_used": tools_used,
            "agents": [o.to_public() for o in outcomes],
            "parallel": parallel,
        })
        return TeamOutcome(
            display_text=text,
            result=result,
            tool_used=primary.tool,
            tools_used=tools_used,
            agents=outcomes,
            meta=meta,
            streamed=streamed,
            parallel=parallel,
            primary_model=primary.model,
            primary_config_key=primary.config_key,
        )

    @staticmethod
    def _single_result(
        outcome: AgentOutcome,
        text: str,
        answer_result: dict[str, Any],
        *,
        is_answer: bool,
    ) -> dict[str, Any]:
        """Single-agent turn: the tool's own result, shape unchanged."""
        if is_answer:
            return dict(answer_result)
        if outcome.status == STATUS_FAILED:
            # A lone generator that failed: the note is the whole answer.
            return {"answer": text}
        return dict(outcome.result or {})

    def _team_result(
        self,
        outcomes: list[AgentOutcome],
        text: str,
        answer_result: dict[str, Any],
    ) -> dict[str, Any]:
        """Multi-agent turn: answer + nested generator artifacts."""
        team: dict[str, Any] = {
            "answer": text,
            "sources": list(answer_result.get("sources") or []),
        }
        for key in ("search_intent", "media_count", "_retrieval"):
            if key in answer_result:
                team[key] = answer_result[key]
        for outcome in outcomes:
            if (
                outcome.step.kind == STEP_KIND_GENERATOR
                and outcome.status == STATUS_DONE
                and outcome.result is not None
            ):
                self._attach_artifact(team, outcome)
        return team

    @staticmethod
    def _attach_artifact(team: dict[str, Any], outcome: AgentOutcome) -> None:
        """Nest one generator's payload under its artifact key."""
        payload = outcome.result or {}
        tool = outcome.step.tool
        if tool == "quiz_generator":
            team["quiz"] = payload
        elif tool == "flashcard_generator":
            team["flashcards"] = payload
        elif tool == "image_generator":
            team.setdefault("images", []).extend(payload.get("images") or [])
            if payload.get("style"):
                team["style"] = payload["style"]
                team["style_label"] = payload.get("style_label")
