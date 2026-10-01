"""Tracing of step execution: the agent runner and the tools' model choice.

``aeva.orchestration.agent_runner`` and ``aeva.mcp.base`` contain no tracing
logic: they import this module and add a decorator, or wrap one expression,
where a step of the trace happens. What is recorded and how it is worded
lives here::

    tool "<tool name>"            @answer_step    AgentRunner._run_answer
                                  run_step        the registry call in ._work
    └─ decision "resolve_model"   @model_choice   BaseTool.resolve_llm
    decision "handoff"            @handoff        AgentRunner._submit
    decision "agent_timeout"      @timeouts       AgentRunner._expire_timeouts
    (pool-thread hop)             carry           the pool.submit(...) site

Rules everything here keeps:

* no trace being recorded → the wrapped function is called and nothing else
  happens (a generator method hands back its own generator, untouched);
* the wrapped function's result and exceptions pass through unchanged;
* the bookkeeping cannot raise into the turn;
* nothing is kept on the runner, the registry or a tool: what one call must
  tell another travels in ``tracing.state()``.
"""

import contextvars
import functools
import inspect
import logging
from collections.abc import Callable, Generator, Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any, ParamSpec, TypeVar

from aeva import tracing
from aeva.tracing.services import tool_trace

logger = logging.getLogger(__name__)

_P = ParamSpec("_P")
_R = TypeVar("_R")
_Y = TypeVar("_Y")
_S = TypeVar("_S")

# Where a step runs (``meta.thread`` of its tool span).
_REQUEST = "request"
_WORKER = "worker"
_THREAD: contextvars.ContextVar[str] = contextvars.ContextVar(
    "aeva_trace_step_thread", default=_REQUEST
)

# Mirrors what ``AgentRunner._expire_timeouts`` writes to a step's ``error``
# (not imported: that module imports this one). A test keeps the two equal.
TIMEOUT_ERROR = "timeout"

# ``tracing.state()`` slot of the hand-off being recorded (request thread).
_HANDOFF = "agent_trace.handoff"

_NO_SPAN = tracing.SpanHandle(None, None)

_PARTIAL_ANSWER = (
    "The answer failed after some text had reached the student: the partial "
    "text was kept and the turn carried on. The exception's message is on "
    "the failing step inside this one, or in the server log."
)


@dataclass
class _Handoff:
    """The ``handoff`` decision of one answer → generators hand-over."""

    prior: Any
    span: tracing.SpanHandle
    steps: list[Any] = field(default_factory=list)


# ------------------------------------------------------------------ plumbing


def _quiet(func: Callable[_P, None]) -> Callable[_P, None]:
    """Make a bookkeeping function unable to raise into the turn."""

    @functools.wraps(func)
    def safe(*args: _P.args, **kwargs: _P.kwargs) -> None:
        try:
            func(*args, **kwargs)
        except Exception:  # noqa: BLE001 — tracing must never break a turn.
            logger.debug("agent trace failed", exc_info=True)

    return safe


def _arguments(
    signature: inspect.Signature,
    args: tuple[object, ...],
    kwargs: Mapping[str, object],
) -> dict[str, Any]:
    """Map the wrapped call's arguments by parameter name (``{}`` if odd)."""
    try:
        bound = signature.bind(*args, **kwargs)
        bound.apply_defaults()
        return dict(bound.arguments)
    except Exception:  # noqa: BLE001 — the wrapped call reports a bad call.
        return {}


def _model_name(client: Any) -> str | None:
    """Model id of an LLM client, when it exposes one as a string."""
    model = getattr(client, "model", None)
    return model if isinstance(model, str) else None


# ---------------------------------------------------------------- tool span


def _open_step(
    step: Any,
    prior: Iterable[Any] | None,
    *,
    thread: str,
    streamed: bool | None = None,
) -> tracing.SpanHandle:
    """Open the ``tool`` span of one step; a no-op handle if that fails.

    ``thread`` says where the step runs: ``"request"`` (the answer agent)
    or ``"worker"`` (a generator in the pool).
    """
    try:
        meta: dict[str, Any] = {
            "step_id": step.id,
            "step_kind": step.kind,
            "step_input": step.input,
            "model": step.model,
            "config_key": step.config_key,
            "thread": thread,
        }
        if streamed is not None:
            meta["streamed"] = streamed
        return tracing.begin(
            tracing.KIND_TOOL,
            str(step.tool),
            input={
                "params": step.params,
                "purpose": step.purpose,
                "prior_results": [
                    {
                        "tool": item.tool,
                        "text_chars": len(item.text or ""),
                        "sources": len(item.sources),
                    }
                    for item in prior or ()
                ],
            },
            meta=meta,
        )
    except Exception:  # noqa: BLE001 — tracing must never break a turn.
        logger.debug("agent trace failed", exc_info=True)
        return _NO_SPAN


def _end_step(
    span: tracing.SpanHandle,
    result: Any,
    *,
    streamed: bool | None = None,
    failed: str | None = None,
) -> None:
    """Close a step's span with its result.

    ``failed`` is the error of a step whose failure the runner absorbed
    (the turn went on with what the step had produced so far).
    """
    try:
        meta: dict[str, Any] = {}
        if streamed is not None:
            meta["streamed"] = streamed
        if failed:
            meta["partial_answer"] = _PARTIAL_ANSWER
            span.end(
                output=result,
                meta=meta,
                status=tracing.STATUS_ERROR,
                error=failed,
            )
        else:
            meta.update(tool_trace.result_meta(result))
            tool_trace.persisted(result)
            span.end(output=result, meta=meta)
    except Exception:  # noqa: BLE001 — tracing must never break a turn.
        logger.debug("agent trace failed", exc_info=True)
    # Only acts when the code above failed before it closed the span.
    span.end()


# ------------------------------------------------------------- answer agent


def answer_step(
    func: Callable[[Any, Any], Generator[_Y, _S, _R]],
) -> Callable[[Any, Any], Generator[_Y, _S, _R]]:
    """Record the answer agent as one ``tool`` span (request thread).

    For ``AgentRunner._run_answer(self, step)``. The span opens when the
    runner starts on the step and stays current while its frames are
    consumed, so the tool's prompt, LLM and retrieval spans nest under it.
    """

    @functools.wraps(func)
    def wrapper(runner: Any, step: Any) -> Generator[_Y, _S, _R]:
        frames = func(runner, step)
        if not tracing.is_active():
            return frames
        return _answer_span(runner, step, frames)

    return wrapper


def _answer_span(
    runner: Any, step: Any, frames: Generator[_Y, _S, _R]
) -> Generator[_Y, _S, _R]:
    """Relay the answer agent's frames inside its ``tool`` span.

    ``yield from`` hands ``send`` / ``throw`` / ``close`` to the runner's own
    generator, exactly as the runner's caller would. When the consumer stops
    (client disconnect) that generator is closed first, which lets go of the
    tool's stream and of the LLM stream inside it: their spans end before,
    and under, this one, which then ends ``aborted``.
    """
    span = _open_step(
        step, (), thread=_REQUEST, streamed=_can_stream(runner, step)
    )
    try:
        outcome = yield from frames
    except GeneratorExit:
        span.end(status=tracing.STATUS_ABORTED)
        raise
    except BaseException as exc:
        span.end(status=tracing.STATUS_ERROR, error=exc)
        raise
    _end_answer(span, runner, step, outcome)
    return outcome


def _can_stream(runner: Any, step: Any) -> bool | None:
    """Whether the step's tool streams, asked of the runner's registry."""
    try:
        return bool(runner._registry.get(step.tool).can_stream())  # noqa: SLF001
    except Exception:  # noqa: BLE001 — unknown tool: the runner reports it.
        return None


def _end_answer(
    span: tracing.SpanHandle, runner: Any, step: Any, outcome: Any
) -> None:
    """Close the answer span from what ``_run_answer`` returned.

    A failure after some text had been streamed is absorbed by the runner
    (the turn carries on with the partial text), so no exception reaches
    the span: the step's own outcome says it failed, and with which error.
    """
    result: Any = None
    streamed: bool | None = None
    failed: str | None = None
    try:
        _text, result, _meta, streamed = outcome
        agent = (getattr(runner, "_outcomes", None) or {}).get(step.id)
        error = getattr(agent, "error", None)
        failed = str(error) if error else None
        # The runner keeps only the exception's type; the span that raised
        # (the LLM call, usually) has the message.
        detail = tracing.error_below(span) if failed else None
        if failed and detail and detail.startswith(failed):
            failed = detail
    except Exception:  # noqa: BLE001 — tracing must never break a turn.
        logger.debug("agent trace failed", exc_info=True)
    _end_step(span, result, streamed=streamed, failed=failed)


# --------------------------------------------------------- generator agents


def carry(work: Callable[_P, _R]) -> Callable[_P, _R]:
    """Hand the trace position to a pool thread: ``pool.submit(carry(fn), …)``.

    Pool threads do not inherit the request thread's trace position, so it
    is captured here, at submit time, and re-bound around ``work`` inside
    the worker (``tracing.carry``). Returns ``work`` itself when no trace
    is being recorded.
    """
    if not tracing.is_active():
        return work

    @functools.wraps(work)
    def in_worker(*args: _P.args, **kwargs: _P.kwargs) -> _R:
        token = _THREAD.set(_WORKER)
        try:
            return work(*args, **kwargs)
        finally:
            _THREAD.reset(token)

    return tracing.carry(in_worker)


def run_step(
    execute: Callable[[str, Any, dict[str, Any]], _R], step: Any, ctx: Any
) -> _R:
    """Run ``execute(step.tool, ctx, step.params)`` inside a ``tool`` span.

    For the registry call of a generator agent. The span records the tool's
    result, or the exception (which the worker reports to the client as an
    event, never raises). A step still running when its turn is written
    keeps its span open: it is stored as ``unfinished``.
    """
    if not tracing.is_active():
        return execute(step.tool, ctx, step.params)
    span = _open_step(
        step,
        getattr(ctx, "prior_results", None),
        thread=_THREAD.get(),
        streamed=False,
    )
    try:
        result = execute(step.tool, ctx, step.params)
    except BaseException as exc:
        span.end(status=tracing.STATUS_ERROR, error=exc)
        raise
    _end_step(span, result)
    return result


def handoff(
    func: Callable[[Any, Any, Any], _R],
) -> Callable[[Any, Any, Any], _R]:
    """Record the answer output handed to the dependent generators.

    For ``AgentRunner._submit(self, step, prior)``: a step submitted with
    prior results is a dependent generator. One ``handoff`` decision per
    hand-over lists every generator that received it.
    """

    @functools.wraps(func)
    def wrapper(runner: Any, step: Any, prior: Any) -> _R:
        if prior and tracing.is_active():
            _note_handoff(runner, step, prior)
        return func(runner, step, prior)

    return wrapper


@_quiet
def _note_handoff(runner: Any, step: Any, prior: Any) -> None:
    """Add ``step`` to the ``handoff`` decision of this hand-over."""
    if getattr(runner, "_pool", None) is None:
        return  # no pool: the runner submits nothing
    state = tracing.state()
    held = state.get(_HANDOFF)
    record = (
        held if isinstance(held, _Handoff) and held.prior is prior else None
    )
    steps = [*record.steps, step] if record is not None else [step]
    # Described in full before anything is recorded: a hand-over that cannot
    # be described leaves no half-filled decision behind.
    answer = prior[0]
    tools = ", ".join(str(item.tool) for item in steps)
    output = {
        "from": answer.tool,
        "to": [{"id": item.id, "tool": item.tool} for item in steps],
        "text_chars": len(answer.text or ""),
        "sources": len(answer.sources),
    }
    reason = (
        f"{tools} build(s) from the answer agent's output, so the "
        f"{answer.tool} answer text and its sources were passed on as prior "
        "results."
    )
    if record is None:
        span = tracing.begin(tracing.KIND_DECISION, "handoff")
        span.end()
        record = _Handoff(prior=prior, span=span)
        state[_HANDOFF] = record
    record.steps = steps
    record.span.set(output=output, meta={"reason": reason})


def timeouts(
    func: Callable[[Any], Generator[_Y, _S, _R]],
) -> Callable[[Any], Generator[_Y, _S, _R]]:
    """Record each generator the runner gave up on as ``agent_timeout``.

    For ``AgentRunner._expire_timeouts(self)``: the steps whose error
    became ``"timeout"`` during the call are the ones it expired.
    """

    @functools.wraps(func)
    def wrapper(runner: Any) -> Generator[_Y, _S, _R]:
        frames = func(runner)
        if not tracing.is_active():
            return frames
        return _watch_timeouts(runner, frames)

    return wrapper


def _watch_timeouts(
    runner: Any, frames: Generator[_Y, _S, _R]
) -> Generator[_Y, _S, _R]:
    """Relay the frames; record the steps that timed out meanwhile."""
    before = _timed_out(runner)
    try:
        return (yield from frames)
    finally:
        _note_timeouts(runner, before)


def _timed_out(runner: Any) -> set[str]:
    """Ids of the steps the runner has marked as timed out."""
    try:
        outcomes = getattr(runner, "_outcomes", None) or {}
        return {
            sid
            for sid, outcome in outcomes.items()
            if getattr(outcome, "error", None) == TIMEOUT_ERROR
        }
    except Exception:  # noqa: BLE001 — tracing must never break a turn.
        logger.debug("agent trace failed", exc_info=True)
        return set()


@_quiet
def _note_timeouts(runner: Any, before: set[str]) -> None:
    """One ``agent_timeout`` decision per step expired since ``before``."""
    outcomes = getattr(runner, "_outcomes", None) or {}
    timeout_s = getattr(runner, "_timeout_s", None)
    limit = f"{timeout_s:g}s " if isinstance(timeout_s, int | float) else ""
    for sid in sorted(_timed_out(runner) - before):
        outcome = outcomes[sid]
        tool = outcome.step.tool
        # The worker keeps running (or never started): its own tool span,
        # if any, is simply still open when the trace is written.
        tracing.event(
            tracing.KIND_DECISION,
            "agent_timeout",
            output={
                "step_id": sid,
                "tool": tool,
                "elapsed_ms": outcome.ms,
                "timeout_s": timeout_s,
            },
            meta={
                "reason": (
                    f"{tool} ({sid}) did not finish within the {limit}step "
                    "timeout, counted from when it was submitted; the turn "
                    "finished without it."
                )
            },
            status=tracing.STATUS_TIMEOUT,
        )


# ---------------------------------------------------------- model resolution


def model_choice(func: Callable[_P, _R]) -> Callable[_P, _R]:
    """Record which model a tool call runs on, and why (``resolve_model``).

    For ``BaseTool.resolve_llm(self, ctx, config_key)``. The source of the
    choice is worked out from what came back: the tool's injected client
    itself, or a client built for this call.
    """
    signature = inspect.signature(func)

    @functools.wraps(func)
    def wrapper(*args: _P.args, **kwargs: _P.kwargs) -> _R:
        client = func(*args, **kwargs)
        if tracing.is_active():
            _note_model(_arguments(signature, args, kwargs), client)
        return client

    return wrapper


def _model_source(ctx: Any, *, built: bool) -> str:
    """``injected`` / ``planner_model`` / ``config_override`` / ``default``."""
    if not built:
        return "injected"
    if not ctx.model:
        return "default"
    return "config_override" if ctx.config_key else "planner_model"


# What ``ToolContext.model`` holds: the planner's pick when it made one, else
# the tool's default, which the orchestrator fills in for every step.
_STEP_MODEL = (
    "step's model (the planner's pick, or the tool's default when it picked "
    "none)"
)


def _model_reason(
    source: str, ctx: Any, *, key: str, own_key: str, has_injected: bool
) -> str:
    """One sentence saying why this client was used."""
    if source == "injected":
        if ctx.model:
            return (
                f"The {_STEP_MODEL} is the one the tool's injected client "
                "already runs, so that client is reused."
            )
        return (
            "No model was set for this step, so the tool's injected client "
            "is used as is."
        )
    if source == "config_override":
        return (
            f"This turn resolves through {key} instead of the tool's own "
            f"{own_key}, so a client was built from {key} for the "
            f"{_STEP_MODEL}."
        )
    if source == "planner_model":
        held = (
            "is not the one the tool's injected client runs"
            if has_injected
            else "is set and the tool has no injected client"
        )
        return (
            f"The {_STEP_MODEL} {held}, so a client was built for it from "
            f"{key}."
        )
    return (
        "No model was set for this step and no injected client is "
        f"available, so one was built from {key}."
    )


@_quiet
def _note_model(given: Mapping[str, Any], client: Any) -> None:
    """Record the ``resolve_model`` decision of one ``resolve_llm`` call."""
    tool, ctx, own_key = given["self"], given["ctx"], given["config_key"]
    injected = getattr(tool, "_llm", None)
    # An injected client keeps the key it was built with (the tool's own):
    # a turn-level key only applies when a client is constructed.
    built = injected is None or client is not injected
    key = (ctx.config_key or own_key) if built else own_key
    source = _model_source(ctx, built=built)
    tracing.event(
        tracing.KIND_DECISION,
        "resolve_model",
        output={
            "config_key": key,
            "model": _model_name(client),
            "source": source,
        },
        meta={
            "reason": _model_reason(
                source,
                ctx,
                key=key,
                own_key=own_key,
                has_injected=injected is not None,
            ),
            "tool_config_key": own_key,
            "turn_config_key": ctx.config_key,
            "turn_config_key_ignored": bool(ctx.config_key) and not built,
            "turn_model": ctx.model,
            "injected_model": _model_name(injected),
        },
    )
