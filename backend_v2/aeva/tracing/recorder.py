"""In-memory recorder for one AI turn, and the ambient API around it.

How a turn is traced
--------------------
``start_turn`` creates a :class:`TraceRecorder` and binds it to the current
thread through a ``ContextVar``. While it is bound, the instrumented choke
points (``PromptBuilder.build``, the ``LLMClient`` methods, the orchestrator's
routing cascade, ``AgentRunner``, retrieval) add *spans* to it. Nothing is
written to the database during the turn. ``finish_turn`` — called by the
controller after the last SSE frame was handed to the client — unbinds the
recorder and persists the whole trace in one batch (see ``store``).

Rules this module keeps
-----------------------
* **Never raise into the turn.** Every public function swallows its own
  failures; a tracing bug can lose a trace, never an answer.
* **No database I/O before the answer.** Recording only copies values into
  memory.
* **No state on shared objects.** Tools, LLM clients and the retrieval service
  are process-wide singletons, so the recorder travels in a ``ContextVar``.
  Worker threads do not inherit it: capture a handle with :func:`capture` on
  the submitting thread and re-bind it with :func:`bound` inside the worker.
"""

import contextvars
import functools
import hashlib
import logging
import os
import random
import re
import threading
import time
import uuid
from collections.abc import Callable, Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, ParamSpec, TypeVar

from aeva.tracing import store
from aeva.tracing.sanitize import (
    Sanitizer,
    cap_field,
    clean_text,
    redact_secrets,
)

logger = logging.getLogger(__name__)

# Span kinds (the ``kind`` column; the Admin tree picks an icon per kind).
KIND_TURN = "turn"
KIND_CONTEXT = "context"
KIND_ROUTER = "router"
KIND_DECISION = "decision"
KIND_TOOL = "tool"
KIND_PROMPT = "prompt"
KIND_LLM = "llm"
KIND_EMBEDDING = "embedding"
KIND_RETRIEVAL = "retrieval"
KIND_PERSIST = "persist"

# Span statuses.
STATUS_RUNNING = "running"
STATUS_OK = "ok"
STATUS_ERROR = "error"
STATUS_ABORTED = "aborted"
STATUS_TIMEOUT = "timeout"
STATUS_SKIPPED = "skipped"
# A span still open when the trace was written (abandoned worker thread).
STATUS_UNFINISHED = "unfinished"

# Trace statuses.
TRACE_COMPLETED = "completed"
# Answered and saved, but a step failed or timed out along the way.
TRACE_PARTIAL = "partial"
TRACE_CLARIFICATION = "clarification"
TRACE_QUIZ_SETUP = "quiz_setup"
TRACE_ERROR = "error"
TRACE_ABORTED = "aborted"

# Trace-level values that are real columns; anything else passed to
# ``annotate`` lands in the trace's ``meta`` JSON.
_TRACE_COLUMNS = frozenset(
    {
        "session_id",
        "run_id",
        "user_message_id",
        "assistant_message_id",
        "status",
        "error",
        "plan_source",
        "plan_action",
    }
)

# Trace columns typed UUID in the database.
_UUID_COLUMNS = frozenset(
    {
        "session_id",
        "run_id",
        "user_message_id",
        "assistant_message_id",
    }
)

# Span columns a caller may set besides kind / name / input / output / meta.
_SPAN_COLUMNS = frozenset({"provider", "model", "prompt_name", "prompt_hash"})

# Prompt placeholder values are also visible, in full, inside the LLM call
# that used them; the prompt span keeps a shorter copy of each.
_PROMPT_VALUE_CHARS = 8_000
_QUERY_CHARS = 2_000
_ERROR_CHARS = 2_000
# A whole span field (input or output) larger than this is stored as a preview.
_FIELD_TOTAL_FACTOR = 6

# Bound on parent-chain walks (spans never nest anywhere near this deep).
_MAX_NESTING = 64
# Provider-added prompt text kept per LLM call (there are one or two today).
_MAX_ADDITIONS = 8

_UNSET: Any = object()


@dataclass(frozen=True)
class TraceSettings:
    """Resolved tracing configuration for one turn."""

    enabled: bool = True
    # "all" traces every turn; "debug_users" keeps only Developer Mode users.
    scope: str = "all"
    sample_rate: float = 1.0
    max_field_chars: int = 60_000
    max_spans: int = 400


def load_settings() -> TraceSettings:
    """Read tracing config from the Flask app, else the environment."""
    try:
        from flask import current_app

        cfg: Mapping[str, Any] = current_app.config
    except Exception:  # noqa: BLE001 — no app context: fall back to env.
        cfg = {}

    def pick(key: str, default: str) -> str:
        value = cfg.get(key)
        if value is None:
            value = os.environ.get(key, default)
        return str(value)

    try:
        scope = pick("AI_TRACE_SCOPE", "all").strip().lower()
        if scope not in {"all", "debug_users"}:
            # Fail closed: a mistyped scope must not trace every user.
            logger.warning(
                "Unknown AI_TRACE_SCOPE %r; tracing Developer Mode users only",
                scope,
            )
            scope = "debug_users"
        return TraceSettings(
            enabled=pick("AI_TRACE_ENABLED", "true").strip().lower() == "true",
            scope=scope,
            sample_rate=float(pick("AI_TRACE_SAMPLE_RATE", "1")),
            max_field_chars=int(pick("AI_TRACE_MAX_FIELD_CHARS", "60000")),
            max_spans=int(pick("AI_TRACE_MAX_SPANS", "400")),
        )
    except (TypeError, ValueError):
        logger.warning("Invalid AI_TRACE_* config; tracing disabled")
        return TraceSettings(enabled=False)


@dataclass
class Span:
    """One recorded step. Becomes one ``ai_trace_spans`` row."""

    id: str
    parent_id: str | None
    seq: int
    kind: str
    name: str
    start_ms: int
    started: float
    status: str = STATUS_RUNNING
    duration_ms: int | None = None
    provider: str | None = None
    model: str | None = None
    prompt_name: str | None = None
    prompt_hash: str | None = None
    input: Any = None
    output: Any = None
    meta: dict[str, Any] = field(default_factory=dict)
    error: str | None = None


@dataclass(frozen=True)
class PromptRef:
    """Which template produced a rendered prompt (links prompt → LLM call)."""

    name: str
    hash: str
    span_id: str


def template_hash(template: Any) -> str:
    """Short content hash of a ``PromptTemplate``: its de facto version.

    Covers the system and user channels and every default block, so editing
    the template *or* a shared block it embeds (``SYSTEM_PROMPT``, the
    teaching protocol, the answer-meta trailer) changes the hash.
    """
    digest = hashlib.sha256()
    digest.update(str(getattr(template, "system", "")).encode("utf-8"))
    digest.update(b"\x00")
    digest.update(str(getattr(template, "user", "")).encode("utf-8"))
    defaults = getattr(template, "defaults", None) or {}
    for name in sorted(defaults):
        digest.update(b"\x00")
        digest.update(str(name).encode("utf-8"))
        digest.update(b"=")
        digest.update(str(defaults[name]).encode("utf-8"))
    return digest.hexdigest()[:12]


def _prompt_key(system_prompt: str | None, user_message: str | None) -> str:
    """Lookup key for a rendered prompt (both channels)."""
    digest = hashlib.sha1(usedforsecurity=False)
    digest.update((system_prompt or "").encode("utf-8", "replace"))
    digest.update(b"\x00")
    digest.update((user_message or "").encode("utf-8", "replace"))
    return digest.hexdigest()


class TraceRecorder:
    """Thread-safe, in-memory record of one turn."""

    def __init__(
        self,
        *,
        kind: str,
        user_id: str | None,
        message: str,
        endpoint: str,
        settings: TraceSettings,
    ) -> None:
        self.id = str(uuid.uuid4())
        self.kind = kind
        self.user_id = _uuid_or_none(user_id)
        self.endpoint = endpoint
        self.settings = settings
        self.started_at = datetime.now(UTC)
        self.query = clean_text(message or "")[:_QUERY_CHARS]
        self.closed = False
        self.fields: dict[str, Any] = {}
        self.meta: dict[str, Any] = {}
        self.root_id: str | None = None
        self._t0 = time.perf_counter()
        self._lock = threading.Lock()
        self._spans: list[Span] = []
        self._by_id: dict[str, Span] = {}
        self._dropped = 0
        self._prompts: dict[str, PromptRef] = {}
        self._templates: dict[tuple[str, str], Any] = {}
        # Scratch space for instrumentation code (see ``state()``).
        self.state: dict[str, Any] = {}

    # ---------------------------------------------------------------- spans

    def sanitizer(self, max_chars: int | None = None) -> Sanitizer:
        """Build a sanitizer with this trace's per-string budget."""
        return Sanitizer(max_chars or self.settings.max_field_chars)

    def open_span(
        self,
        kind: str,
        name: str,
        parent_id: str | None,
    ) -> Span | None:
        """Register a new running span; ``None`` once the trace is full."""
        now = time.perf_counter()
        with self._lock:
            if self.closed:
                return None
            if len(self._spans) >= self.settings.max_spans:
                self._dropped += 1
                return None
            span = Span(
                id=str(uuid.uuid4()),
                parent_id=parent_id,
                seq=len(self._spans),
                kind=kind,
                name=clean_text(str(name))[:200],
                start_ms=int((now - self._t0) * 1000),
                started=now,
            )
            self._spans.append(span)
            self._by_id[span.id] = span
        return span

    def get_span(self, span_id: str | None) -> Span | None:
        """Look a span up by id."""
        if span_id is None:
            return None
        return self._by_id.get(span_id)

    def snapshot(self) -> list[Span]:
        """Spans recorded so far, in creation order."""
        with self._lock:
            return list(self._spans)

    def within(self, span_id: str | None, ancestor_id: str) -> bool:
        """Whether ``span_id`` is ``ancestor_id`` or nested under it."""
        for _ in range(_MAX_NESTING):
            if span_id is None:
                return False
            if span_id == ancestor_id:
                return True
            span = self._by_id.get(span_id)
            span_id = span.parent_id if span is not None else None
        return False

    def close_span(
        self,
        span: Span,
        status: str | None = None,
        error: BaseException | str | None = None,
    ) -> None:
        """Stamp a span's duration and terminal status (first close wins)."""
        if self.closed or span.duration_ms is not None:
            return
        span.duration_ms = int((time.perf_counter() - span.started) * 1000)
        if error is not None:
            span.error = _error_text(error)
        if status is not None:
            span.status = status
        elif span.status == STATUS_RUNNING:
            span.status = STATUS_OK

    def update_span(  # noqa: C901
        self,
        span: Span,
        *,
        input: Any = _UNSET,  # noqa: A002 — mirrors the column name.
        output: Any = _UNSET,
        meta: Mapping[str, Any] | None = None,
        status: str | None = None,
        error: BaseException | str | None = None,
        name: str | None = None,
        columns: Mapping[str, Any] | None = None,
    ) -> None:
        """Attach (sanitised copies of) data to a span."""
        if self.closed:
            return
        cleaner = self.sanitizer()
        if input is not _UNSET:
            span.input = cleaner.value(input)
        if output is not _UNSET:
            span.output = cleaner.value(output)
        if meta:
            span.meta.update(cleaner.value(dict(meta)))
        if cleaner.truncated:
            span.meta["truncated"] = True
        if status is not None:
            span.status = status
        if error is not None:
            span.error = _error_text(error)
        if name:
            span.name = clean_text(str(name))[:200]
        for key, value in (columns or {}).items():
            if key in _SPAN_COLUMNS and value is not None:
                setattr(span, key, clean_text(str(value))[:200])

    # -------------------------------------------------------------- prompts

    def register_prompt(
        self,
        template: Any,
        ref: PromptRef,
        system_prompt: str,
        user_message: str,
    ) -> None:
        """Remember a rendered prompt so the LLM call can name its template."""
        with self._lock:
            self._prompts[_prompt_key(system_prompt, user_message)] = ref
            # Image generation sends the user channel only.
            self._prompts[_prompt_key(None, user_message)] = ref
            self._templates[(ref.name, ref.hash)] = template

    def lookup_prompt(
        self, system_prompt: str | None, user_message: str | None
    ) -> PromptRef | None:
        """Find the template behind the text an LLM call is about to send."""
        with self._lock:
            return self._prompts.get(
                _prompt_key(system_prompt, user_message)
            ) or self._prompts.get(_prompt_key(None, user_message))

    # ------------------------------------------------------------- finalise

    def close(self) -> list[Span]:
        """Stop accepting spans and return what was recorded."""
        with self._lock:
            self.closed = True
            return list(self._spans)

    def rows(  # noqa: C901 — one flat pass over the spans.
        self,
    ) -> tuple[dict[str, Any], list[dict[str, Any]], list[Any]]:
        """Build ``(trace_row, span_rows, prompt_version_rows)``."""
        spans = self.close()
        total_ms = int((time.perf_counter() - self._t0) * 1000)
        field_cap = self.settings.max_field_chars * _FIELD_TOTAL_FACTOR
        span_rows: list[dict[str, Any]] = []
        tools: list[str] = []
        models: list[str] = []
        prompt_names: list[str] = []
        llm_calls = 0
        for span in spans:
            if span.duration_ms is None:
                # Still open: an abandoned worker (timed-out generator, late
                # rerank) or a generator that was never resumed.
                span.duration_ms = max(0, total_ms - span.start_ms)
                if span.status == STATUS_RUNNING:
                    span.status = STATUS_UNFINISHED
            span.input, cut_in = cap_field(span.input, field_cap)
            span.output, cut_out = cap_field(span.output, field_cap)
            if cut_in or cut_out:
                span.meta["truncated"] = True
            if span.kind == KIND_TOOL and span.name not in tools:
                tools.append(span.name)
            if span.kind == KIND_LLM:
                llm_calls += 1
            if span.model and span.kind in {KIND_LLM, KIND_EMBEDDING}:
                label = span.model
                if label not in models:
                    models.append(label)
            if span.prompt_name and span.prompt_name not in prompt_names:
                prompt_names.append(span.prompt_name)
            span_rows.append(
                {
                    "id": span.id,
                    "trace_id": self.id,
                    "parent_id": span.parent_id,
                    "seq": span.seq,
                    "kind": span.kind,
                    "name": span.name,
                    "status": span.status,
                    "start_ms": span.start_ms,
                    "duration_ms": span.duration_ms,
                    "provider": span.provider,
                    "model": span.model,
                    "prompt_name": span.prompt_name,
                    "prompt_hash": span.prompt_hash,
                    "input": span.input,
                    "output": span.output,
                    "meta": dict(span.meta),
                    "error": span.error,
                }
            )
        meta = dict(self.meta)
        if self._dropped:
            meta["dropped_spans"] = self._dropped
        status = self.fields.get("status") or TRACE_COMPLETED
        trace_row = {
            "id": self.id,
            "kind": self.kind,
            "user_id": self.user_id,
            "session_id": self.fields.get("session_id"),
            "run_id": self.fields.get("run_id"),
            "user_message_id": self.fields.get("user_message_id"),
            "assistant_message_id": self.fields.get("assistant_message_id"),
            "endpoint": self.endpoint,
            "status": status,
            "error": self.fields.get("error"),
            "query": self.query,
            "plan_source": self.fields.get("plan_source"),
            "plan_action": self.fields.get("plan_action"),
            "tools": tools,
            "models": models,
            "prompt_names": prompt_names,
            "span_count": len(span_rows),
            "llm_calls": llm_calls,
            "duration_ms": total_ms,
            "started_at": self.started_at.isoformat(),
            "git_sha": _git_sha(),
            "meta": Sanitizer(_PROMPT_VALUE_CHARS).value(meta),
        }
        return trace_row, span_rows, self._prompt_version_rows()

    def _prompt_version_rows(self) -> list[dict[str, Any]]:
        """One row per distinct (template, content hash) this turn rendered."""
        with self._lock:
            templates = dict(self._templates)
        rows: list[dict[str, Any]] = []
        for (name, digest), template in templates.items():
            defaults = getattr(template, "defaults", None) or {}
            rows.append(
                {
                    "name": name,
                    "hash": digest,
                    "system_template": clean_text(
                        str(getattr(template, "system", ""))
                    ),
                    "user_template": clean_text(
                        str(getattr(template, "user", ""))
                    ),
                    "defaults": {
                        str(key): clean_text(str(value))
                        for key, value in defaults.items()
                    },
                    "git_sha": _git_sha(),
                }
            )
        return rows


def _uuid_or_none(value: Any) -> str | None:
    """Canonical UUID string, or ``None`` when ``value`` is not a UUID."""
    if value is None:
        return None
    try:
        return str(uuid.UUID(str(value)))
    except (TypeError, ValueError, AttributeError):
        return None


def _git_sha() -> str | None:
    """Deployed commit, when the platform exposes it."""
    sha = os.environ.get("VERCEL_GIT_COMMIT_SHA", "").strip()
    return sha[:12] or None


def _error_text(error: BaseException | str) -> str:
    """``TypeName: message`` for an exception, else the string itself."""
    try:
        if isinstance(error, BaseException):
            text = f"{type(error).__name__}: {error}"
        else:
            text = str(error)
    except Exception:  # noqa: BLE001 — an exception whose str() raises.
        text = type(error).__name__
    # Vendor errors can quote the request, key included.
    return redact_secrets(clean_text(text))[:_ERROR_CHARS]


# ----------------------------------------------------------------- binding

# (recorder, current span id) for the running thread; ``None`` = not tracing.
Binding = tuple[TraceRecorder, str | None]
_BINDING: contextvars.ContextVar[Binding | None] = contextvars.ContextVar(
    "aeva_trace_binding", default=None
)


class SpanHandle:
    """What ``span()`` yields: lets the caller attach output, meta, status."""

    __slots__ = ("_previous", "_recorder", "_span")

    def __init__(
        self,
        recorder: TraceRecorder | None,
        span: Span | None,
        previous: Any = _UNSET,
    ) -> None:
        self._recorder = recorder
        self._span = span
        # The position to go back to when a span opened by ``begin`` ends.
        self._previous = previous

    @property
    def id(self) -> str | None:
        """Span id, or ``None`` when tracing is off."""
        return self._span.id if self._span is not None else None

    @property
    def active(self) -> bool:
        """Whether this handle records anything."""
        return self._span is not None

    def set(
        self,
        *,
        input: Any = _UNSET,  # noqa: A002 — mirrors the column name.
        output: Any = _UNSET,
        meta: Mapping[str, Any] | None = None,
        status: str | None = None,
        error: BaseException | str | None = None,
        name: str | None = None,
        **columns: Any,
    ) -> None:
        """Attach data to the span. Never raises."""
        if self._recorder is None or self._span is None:
            return
        try:
            self._recorder.update_span(
                self._span,
                input=input,
                output=output,
                meta=meta,
                status=status,
                error=error,
                name=name,
                columns=columns,
            )
        except Exception:  # noqa: BLE001 — tracing must never break a turn.
            logger.debug("trace span update failed", exc_info=True)

    def end(
        self,
        *,
        output: Any = _UNSET,
        meta: Mapping[str, Any] | None = None,
        status: str | None = None,
        error: BaseException | str | None = None,
    ) -> None:
        """Close a span opened with :func:`begin`. Idempotent; never raises.

        The position that was current before ``begin`` becomes current again
        (unless the thread has since moved elsewhere).
        """
        if self._recorder is None or self._span is None:
            return
        if self._span.duration_ms is not None:
            return  # already ended: the first end wins
        self.set(output=output, meta=meta)
        previous = None if self._previous is _UNSET else self._previous
        _close(
            self,
            previous,
            opened=self._previous is not _UNSET,
            status=status,
            error=error,
        )
        if self._previous is _UNSET:
            # Not opened by ``begin``: close it without moving the position.
            try:
                self._recorder.close_span(self._span, status, error)
            except Exception:  # noqa: BLE001 — never break a turn.
                logger.debug("trace span end failed", exc_info=True)


_NOOP = SpanHandle(None, None)


def is_active() -> bool:
    """Whether the current thread is recording a trace."""
    return _BINDING.get() is not None


def trace_id() -> str | None:
    """Id of the trace being recorded on this thread, if any."""
    binding = _BINDING.get()
    return binding[0].id if binding is not None else None


def current() -> SpanHandle:
    """Handle for the span that is current on this thread (no-op if none)."""
    binding = _BINDING.get()
    if binding is None:
        return _NOOP
    recorder, span_id = binding
    span = recorder.get_span(span_id)
    return SpanHandle(recorder, span) if span is not None else _NOOP


def error_below(handle: SpanHandle) -> str | None:
    """Error text of the latest failed span nested under ``handle``.

    For a step whose own failure was absorbed by its caller (so no exception
    reached its span): the full message lives on the child that raised.
    """
    recorder, parent = handle._recorder, handle._span  # noqa: SLF001
    if recorder is None or parent is None:
        return None
    try:
        for item in reversed(recorder.snapshot()):
            if (
                item.error
                and item.id != parent.id
                and recorder.within(item.id, parent.id)
            ):
                return item.error
    except Exception:  # noqa: BLE001 — tracing must never break a turn.
        logger.debug("trace error lookup failed", exc_info=True)
    return None


def root() -> SpanHandle:
    """Handle for the turn's root span, from anywhere in the turn."""
    binding = _BINDING.get()
    if binding is None:
        return _NOOP
    recorder = binding[0]
    span = recorder.get_span(recorder.root_id)
    return SpanHandle(recorder, span) if span is not None else _NOOP


def _open(
    kind: str,
    name: str,
    input: Any,  # noqa: A002 — mirrors the column name.
    meta: Mapping[str, Any] | None,
    columns: Mapping[str, Any],
) -> tuple[SpanHandle, Binding | None, bool]:
    """Open a span and make it current. Returns (handle, previous, opened)."""
    binding = _BINDING.get()
    if binding is None:
        return _NOOP, None, False
    try:
        recorder, parent_id = binding
        span = recorder.open_span(kind, name, parent_id)
        if span is None:
            return _NOOP, binding, False
        handle = SpanHandle(recorder, span)
        handle.set(input=input, meta=meta, **columns)
        _BINDING.set((recorder, span.id))
    except Exception:  # noqa: BLE001 — tracing must never break a turn.
        logger.debug("trace span open failed", exc_info=True)
        return _NOOP, binding, False
    return handle, binding, True


def _close(
    handle: SpanHandle,
    previous: Binding | None,
    *,
    opened: bool,
    status: str | None = None,
    error: BaseException | str | None = None,
) -> None:
    """Close a span and restore the previously current one."""
    if not opened:
        return
    recorder, span = handle._recorder, handle._span  # noqa: SLF001
    try:
        if recorder is not None and span is not None:
            recorder.close_span(span, status, error)
    except Exception:  # noqa: BLE001 — tracing must never break a turn.
        logger.debug("trace span close failed", exc_info=True)
    try:
        # Restore the previous position only when this span (or something
        # nested in it) is still the current one. A span closed out of order
        # — a generator finalised after its parent span ended, or after the
        # turn was flushed — must not re-bind the thread to a stale position.
        now = _BINDING.get()
        if (
            now is not None
            and recorder is not None
            and span is not None
            and now[0] is recorder
            and recorder.within(now[1], span.id)
        ):
            _BINDING.set(previous)
    except Exception:  # noqa: BLE001 — tracing must never break a turn.
        logger.debug("trace position restore failed", exc_info=True)


def begin(
    kind: str,
    name: str,
    *,
    input: Any = _UNSET,  # noqa: A002 — mirrors the column name.
    meta: Mapping[str, Any] | None = None,
    **columns: Any,
) -> SpanHandle:
    """Open a span without a ``with`` block; close it with ``handle.end()``.

    For instrumenting existing code without re-indenting it. Spans opened
    on this thread before ``end()`` nest under it. If the turn fails or is
    abandoned first, ``fail_turn`` / ``abort_turn`` close it, so a missing
    ``end()`` on an exception path is fine.
    """
    handle, previous, opened = _open(kind, name, input, meta, columns)
    if not opened:
        return _NOOP
    return SpanHandle(handle._recorder, handle._span, previous)  # noqa: SLF001


@contextmanager
def span(
    kind: str,
    name: str,
    *,
    input: Any = _UNSET,  # noqa: A002 — mirrors the column name.
    meta: Mapping[str, Any] | None = None,
    **columns: Any,
) -> Iterator[SpanHandle]:
    """Record a step that has a duration; spans opened inside nest under it.

    Safe to hold open across ``yield`` in a generator: a consumer that stops
    iterating (client disconnect) closes the span as ``aborted``. An exception
    from the body marks it ``error`` and propagates unchanged.
    """
    handle, previous, opened = _open(kind, name, input, meta, columns)
    try:
        yield handle
    except GeneratorExit:
        _close(handle, previous, opened=opened, status=STATUS_ABORTED)
        raise
    except BaseException as exc:
        _close(handle, previous, opened=opened, status=STATUS_ERROR, error=exc)
        raise
    else:
        _close(handle, previous, opened=opened)


def event(
    kind: str,
    name: str,
    *,
    input: Any = _UNSET,  # noqa: A002 — mirrors the column name.
    output: Any = _UNSET,
    meta: Mapping[str, Any] | None = None,
    status: str = STATUS_OK,
    error: BaseException | str | None = None,
    **columns: Any,
) -> str | None:
    """Record an instantaneous step (a decision, a rule that fired).

    Returns the new span's id, or ``None`` when tracing is off.
    """
    binding = _BINDING.get()
    if binding is None:
        return None
    try:
        recorder, parent_id = binding
        item = recorder.open_span(kind, name, parent_id)
        if item is None:
            return None
        recorder.update_span(
            item, input=input, output=output, meta=meta, columns=columns
        )
        recorder.close_span(item, status, error)
    except Exception:  # noqa: BLE001 — tracing must never break a turn.
        logger.debug("trace event failed", exc_info=True)
        return None
    return item.id


# ------------------------------------------------------------ thread hops


def capture() -> Binding | None:
    """Snapshot the current binding, to re-bind inside a worker thread."""
    return _BINDING.get()


@contextmanager
def bound(binding: Binding | None) -> Iterator[None]:
    """Bind a captured trace position on this thread for the block.

    ``ThreadPoolExecutor`` does not copy ``ContextVar`` values, so a worker
    must do this explicitly. Pool threads are reused, so the previous value
    is always restored. A ``None`` binding is a no-op.
    """
    if binding is None or binding[0].closed:
        yield
        return
    previous = _BINDING.get()
    _BINDING.set(binding)
    try:
        yield
    finally:
        _BINDING.set(previous)


_P = ParamSpec("_P")
_R = TypeVar("_R")


def carry(func: Callable[_P, _R]) -> Callable[_P, _R]:
    """Wrap ``func`` to run at the trace position that is current NOW.

    For work handed to another thread: ``pool.submit(tracing.carry(fn), x)``
    makes the spans ``fn`` records nest under the span that was current when
    it was submitted. Returns ``func`` itself when no trace is active.
    """
    binding = _BINDING.get()
    if binding is None:
        return func

    @functools.wraps(func)
    def runner(*args: _P.args, **kwargs: _P.kwargs) -> _R:
        with bound(binding):
            return func(*args, **kwargs)

    return runner


def state() -> dict[str, Any]:
    """Per-trace scratch dict for instrumentation code.

    Lets a service remember something between two points of a turn (e.g.
    the planner's raw plan, to compare after the rules ran) without putting
    state on shared objects. A throwaway dict when no trace is active.
    """
    binding = _BINDING.get()
    if binding is None:
        return {}
    return binding[0].state


# --------------------------------------------------------- turn lifecycle


def start_turn(
    *,
    user_id: str | None,
    message: str,
    endpoint: str,
    kind: str = "chat_turn",
    input: Any = _UNSET,  # noqa: A002 — mirrors the column name.
    meta: Mapping[str, Any] | None = None,
) -> str | None:
    """Begin recording a turn on this thread. Returns the trace id.

    Returns ``None`` (and records nothing, at no cost) when tracing is off,
    the turn was not sampled, or the trace tables are unavailable.
    """
    try:
        # A binding left behind by a turn that never finished is dropped, not
        # flushed: it belongs to a request this thread is no longer serving.
        _BINDING.set(None)
        settings = load_settings()
        if not settings.enabled or not store.available():
            return None
        if settings.sample_rate < 1 and (
            random.random() >= settings.sample_rate  # noqa: S311
        ):
            return None
        recorder = TraceRecorder(
            kind=kind,
            user_id=user_id,
            message=message,
            endpoint=endpoint,
            settings=settings,
        )
        root = recorder.open_span(KIND_TURN, kind, None)
        if root is None:
            return None
        recorder.root_id = root.id
        recorder.update_span(root, input=input, meta=meta)
        _BINDING.set((recorder, root.id))
    except Exception:  # noqa: BLE001 — tracing must never break a turn.
        logger.debug("trace start failed", exc_info=True)
        _BINDING.set(None)
        return None
    return recorder.id


def annotate(**values: Any) -> None:
    """Set trace-level facts (ids, status, plan source; the rest → meta)."""
    binding = _BINDING.get()
    if binding is None:
        return
    try:
        recorder = binding[0]
        if recorder.closed:
            return
        for key, value in values.items():
            if key in _UUID_COLUMNS:
                # These columns are UUIDs (one has a foreign key): a value
                # that is not one would fail the whole trace insert.
                recorder.fields[key] = _uuid_or_none(value)
            elif key in _TRACE_COLUMNS:
                recorder.fields[key] = (
                    None if value is None else clean_text(str(value))
                )
            else:
                recorder.meta[key] = value
        if (
            "is_debug_user" in values
            and not values["is_debug_user"]
            and recorder.settings.scope == "debug_users"
        ):
            # This turn will not be kept: stop recording now, so nothing
            # (e.g. a message's trace_id) points at a trace never stored.
            discard_turn()
    except Exception:  # noqa: BLE001 — tracing must never break a turn.
        logger.debug("trace annotate failed", exc_info=True)


def _close_open_chain(
    status: str, error: BaseException | str | None = None
) -> None:
    """Close every span still open between the current one and the root.

    Spans opened with ``begin`` have no ``with`` block to close them when
    the turn ends early; the root itself is closed by ``finish_turn``.
    """
    binding = _BINDING.get()
    if binding is None:
        return
    try:
        recorder, span_id = binding
        for _ in range(_MAX_NESTING):
            item = recorder.get_span(span_id)
            if item is None or item.id == recorder.root_id:
                break
            recorder.close_span(item, status, error)
            span_id = item.parent_id
        _BINDING.set((recorder, recorder.root_id))
    except Exception:  # noqa: BLE001 — tracing must never break a turn.
        logger.debug("trace chain close failed", exc_info=True)


def fail_turn(error: BaseException) -> None:
    """Mark the turn as failed with ``error``; closes spans left open."""
    if _BINDING.get() is None:
        return
    annotate(status=TRACE_ERROR, error=_error_text(error))
    _close_open_chain(STATUS_ERROR, error)


def abort_turn() -> None:
    """Mark the turn as abandoned by the client (stream closed early)."""
    binding = _BINDING.get()
    if binding is None:
        return
    # A turn that already reached a terminal state keeps it.
    if binding[0].fields.get("status") in {None, ""}:
        annotate(status=TRACE_ABORTED)
    _close_open_chain(STATUS_ABORTED)


def discard_turn() -> None:
    """Stop recording and throw the trace away."""
    binding = _BINDING.get()
    _BINDING.set(None)
    if binding is not None:
        binding[0].close()


def finish_turn(output: Any = _UNSET) -> str | None:
    """Stop recording and persist the trace. Returns the trace id if saved.

    Call this only after the answer was delivered: it is the one place that
    talks to the database. Idempotent; never raises.
    """
    binding = _BINDING.get()
    _BINDING.set(None)
    if binding is None:
        return None
    recorder = binding[0]
    try:
        if recorder.closed:
            return None
        settings = recorder.settings
        if settings.scope == "debug_users" and not recorder.meta.get(
            "is_debug_user"
        ):
            recorder.close()
            return None
        root = recorder.get_span(recorder.root_id)
        if root is not None:
            status = recorder.fields.get("status") or TRACE_COMPLETED
            root_status = {
                TRACE_ERROR: STATUS_ERROR,
                TRACE_ABORTED: STATUS_ABORTED,
            }.get(status, STATUS_OK)
            if output is not _UNSET:
                recorder.update_span(root, output=output)
            recorder.update_span(root, meta={"outcome": status})
            recorder.close_span(root, root_status, recorder.fields.get("error"))
        trace_row, span_rows, prompt_rows = recorder.rows()
        saved = store.persist(trace_row, span_rows, prompt_rows)
    except Exception:  # noqa: BLE001 — tracing must never break a turn.
        logger.warning("trace flush failed", exc_info=True)
        return None
    return recorder.id if saved else None


# ------------------------------------------------ prompt + LLM call helpers


# Same token the prompt builder substitutes: ``{UPPER_SNAKE}``.
_PLACEHOLDER_RE = re.compile(r"\{([A-Z_][A-Z0-9_]*)\}")
_MAX_SEGMENTS = 80
# Same bound as the builder: a block may embed blocks, but not forever.
_MAX_BLOCK_DEPTH = 10


class _Expander:
    """Re-run a template's substitution, recording where each part lands.

    Mirrors ``PromptBuilder``: a caller value wins over a default and is
    injected verbatim; a default block is expanded recursively (it may embed
    values or other blocks); optional and marker names resolve to nothing.
    """

    def __init__(self, template: Any, values: Mapping[str, Any]) -> None:
        self.values = values
        self.defaults = getattr(template, "defaults", None) or {}
        self.optional = set(getattr(template, "optional", ()) or ())
        self.markers = set(getattr(template, "markers", ()) or ())

    def _resolve(
        self, name: str, token: str, base: int, depth: int
    ) -> tuple[str, str, list[dict[str, Any]] | None]:
        """``(kind, text, inner parts)`` for one placeholder."""
        if name in self.values:
            return "value", str(self.values[name]), None
        if name in self.defaults and depth < _MAX_BLOCK_DEPTH:
            inner, piece = self.expand(
                str(self.defaults[name]), base, depth + 1
            )
            nested = any(part["kind"] != "text" for part in inner)
            return "block", piece, inner if nested else None
        if name in self.markers:
            return "marker", "", None
        if name in self.optional:
            return "optional", "", None
        return "unknown", token, None

    def expand(
        self, text: str, base: int, depth: int
    ) -> tuple[list[dict[str, Any]], str]:
        """Parts of ``text`` (offsets start at ``base``) and its rendering."""
        parts: list[dict[str, Any]] = []
        pieces: list[str] = []
        length = 0
        found: list[tuple[str | None, str, int]] = []
        position = 0
        for match in _PLACEHOLDER_RE.finditer(text):
            if match.start() > position:
                found.append((None, text[position : match.start()], 0))
            found.append((match.group(1), match.group(0), 0))
            position = match.end()
        if position < len(text):
            found.append((None, text[position:], 0))

        for name, token, _ in found:
            start = base + length
            inner: list[dict[str, Any]] | None = None
            if name is None:
                kind, piece = "text", token
            else:
                kind, piece, inner = self._resolve(name, token, start, depth)
            entry: dict[str, Any] = {"kind": kind}
            if name is not None:
                entry["name"] = name
            entry.update(chars=len(piece), start=start, end=start + len(piece))
            if inner:
                entry["parts"] = inner
            parts.append(entry)
            pieces.append(piece)
            length += len(piece)
        return parts, "".join(pieces)


def _prompt_segments(
    template: Any,
    values: Mapping[str, Any],
    system_prompt: str,
    user_message: str,
) -> list[dict[str, Any]]:
    """How a prompt was assembled: every part, in order, per channel.

    One entry per stretch of the template's own text and per placeholder,
    saying what filled it: ``value`` (runtime data from the caller — the user
    message, the profile-derived block, a mode/skill block chosen for this
    turn), ``block`` (shared static text; ``parts`` lists what it embeds when
    it has placeholders of its own), ``optional`` (left out this turn) or
    ``marker`` (history travels separately). ``chars`` is what the part
    contributed, so an empty conditional part shows as 0.

    ``start`` / ``end`` are offsets into the rendered channel, so the Admin
    view can show each part's exact text by slicing the prompt stored on the
    LLM call instead of storing every part twice. They are kept only when the
    expansion reproduces the builder's output exactly.
    """
    expander = _Expander(template, values)
    segments: list[dict[str, Any]] = []
    rendered = {"system": system_prompt, "user": user_message}
    for channel in ("system", "user"):
        parts, text = expander.expand(
            str(getattr(template, channel, "") or ""), 0, 0
        )
        exact = text == rendered[channel]
        for part in parts:
            if not exact:
                _drop_offsets(part)
            segments.append({"channel": channel, **part})
    return segments[:_MAX_SEGMENTS]


def _drop_offsets(part: dict[str, Any]) -> None:
    """Remove offsets that would not match the rendered prompt."""
    part.pop("start", None)
    part.pop("end", None)
    for inner in part.get("parts") or []:
        _drop_offsets(inner)


def record_prompt(
    template: Any, values: Mapping[str, str], rendered: Any
) -> None:
    """Record one ``PromptBuilder.build`` call as a ``prompt`` span.

    Stores the template's name and content hash (its version), which shared
    blocks it embeds, and the runtime value of every placeholder. The
    rendered text itself is kept on the LLM call that sends it; the two are
    linked through the recorder so the call can name its template.
    """
    binding = _BINDING.get()
    if binding is None:
        return
    try:
        recorder, parent_id = binding
        name = str(getattr(template, "name", "prompt"))
        digest = template_hash(template)
        system_prompt = str(getattr(rendered, "system_prompt", "") or "")
        user_message = str(getattr(rendered, "user_message", "") or "")
        item = recorder.open_span(KIND_PROMPT, name, parent_id)
        if item is None:
            return
        cleaner = recorder.sanitizer(_PROMPT_VALUE_CHARS)
        item.input = {"values": cleaner.value(dict(values))}
        item.output = {
            "system_chars": len(system_prompt),
            "user_chars": len(user_message),
        }
        item.meta = {
            "segments": _prompt_segments(
                template, values, system_prompt, user_message
            ),
            "blocks": sorted(getattr(template, "defaults", None) or {}),
            "optional": list(getattr(template, "optional", ()) or ()),
            "supplied": sorted(values),
            "uses_history": bool(getattr(template, "uses_history", False)),
            "uses_attachments": bool(
                getattr(template, "uses_attachments", False)
            ),
        }
        if cleaner.truncated:
            item.meta["truncated"] = True
        item.prompt_name = name
        item.prompt_hash = digest
        recorder.close_span(item, STATUS_OK)
        recorder.register_prompt(
            template,
            PromptRef(name=name, hash=digest, span_id=item.id),
            system_prompt,
            user_message,
        )
    except Exception:  # noqa: BLE001 — tracing must never break a turn.
        logger.debug("trace prompt record failed", exc_info=True)


def _attachment_meta(
    attachments: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """Mime type and size of each attachment — never the bytes."""
    out: list[dict[str, Any]] = []
    for item in attachments or []:
        data = item.get("data") if isinstance(item, dict) else None
        size = len(data) if isinstance(data, bytes | bytearray) else None
        mime = item.get("mime_type") if isinstance(item, dict) else None
        out.append({"mime_type": mime, "bytes": size})
    return out


@contextmanager
def llm_call(
    *,
    method: str,
    label: str,
    provider: str,
    model: str,
    config_key: str | None = None,
    user_message: str = "",
    system_prompt: str | None = None,
    history: list[dict[str, Any]] | None = None,
    attachments: list[dict[str, Any]] | None = None,
    response_schema: dict[str, Any] | None = None,
    use_search: bool = False,
    extra: Mapping[str, Any] | None = None,
) -> Iterator[SpanHandle]:
    """Record one ``LLMClient`` call: its full input, then its output.

    The caller sets the output on the yielded handle once it has it.
    The span is named after the prompt template that produced the text when
    one is known, else after ``label``. ``system_prompt`` must be the prompt
    actually sent (``None`` only when the call sends none).
    """
    if _BINDING.get() is None:
        yield _NOOP
        return
    name = label
    columns: dict[str, Any] = {"provider": provider, "model": model}
    meta: dict[str, Any] = {
        "method": method,
        "label": label,
        "config_key": config_key,
    }
    payload: dict[str, Any] = {}
    try:
        binding = _BINDING.get()
        ref = (
            binding[0].lookup_prompt(system_prompt, user_message)
            if binding is not None
            else None
        )
        if ref is not None:
            name = ref.name
            columns["prompt_name"] = ref.name
            columns["prompt_hash"] = ref.hash
            meta["prompt_span_id"] = ref.span_id
        turns = [
            {
                "role": turn.get("role"),
                "content": turn.get("content"),
            }
            for turn in (history or [])
            if isinstance(turn, dict)
        ]
        payload = {
            "system_prompt": system_prompt,
            "history": turns,
            "user_message": user_message,
        }
        if attachments:
            payload["attachments"] = _attachment_meta(attachments)
        if response_schema is not None:
            payload["response_schema"] = response_schema
        if use_search:
            payload["use_search"] = True
        if extra:
            payload.update(extra)
        meta["input_chars"] = (
            len(system_prompt or "")
            + len(user_message or "")
            + sum(len(str(t.get("content") or "")) for t in turns)
        )
        meta["history_turns"] = len(turns)
    except Exception:  # noqa: BLE001 — tracing must never break a turn.
        logger.debug("trace llm input failed", exc_info=True)
    with span(KIND_LLM, name, input=payload, meta=meta, **columns) as handle:
        yield handle


def _int_or_none(value: Any) -> int | None:
    """Accept only real ints (rejects bools and mock attributes)."""
    if isinstance(value, int) and not isinstance(value, bool):
        return int(value)
    return None


def note_llm_response(response: Any) -> None:
    """Best-effort token usage / finish reason from a vendor SDK response.

    Called by providers, on the thread making the call, while the LLM span is
    current. Understands the OpenAI (chat + responses) and Gemini response
    shapes; anything else is ignored. Never raises.
    """
    binding = _BINDING.get()
    if binding is None or response is None:
        return
    try:
        recorder, span_id = binding
        item = recorder.get_span(span_id)
        if item is None or item.kind not in {KIND_LLM, KIND_EMBEDDING}:
            return
        usage: dict[str, int] = {}
        raw = getattr(response, "usage", None)
        gemini = getattr(response, "usage_metadata", None)
        pairs = (
            (raw, "prompt_tokens", "input_tokens"),
            (raw, "input_tokens", "input_tokens"),
            (raw, "completion_tokens", "output_tokens"),
            (raw, "output_tokens", "output_tokens"),
            (raw, "total_tokens", "total_tokens"),
            (gemini, "prompt_token_count", "input_tokens"),
            (gemini, "candidates_token_count", "output_tokens"),
            (gemini, "total_token_count", "total_tokens"),
        )
        for source, attr, key in pairs:
            if source is None:
                continue
            number = _int_or_none(getattr(source, attr, None))
            if number is not None:
                usage[key] = number
        meta: dict[str, Any] = {}
        if usage:
            meta["usage"] = usage
        finish = _finish_reason(response)
        if finish:
            meta["finish_reason"] = finish
        if meta:
            recorder.update_span(item, meta=meta)
    except Exception:  # noqa: BLE001 — tracing must never break a turn.
        logger.debug("trace usage capture failed", exc_info=True)


def note_prompt_addition(channel: str, text: str, reason: str) -> None:
    """Record text a provider added to a prompt after ``LLMClient`` saw it.

    Some vendors' adapters change what is sent: a JSON-schema hint appended
    to the system prompt, a note about attachments the vendor cannot read.
    That text is part of what the model received but of no template, so the
    provider reports it here, on the thread making the call, and it is kept
    on the current LLM span as ``meta.provider_additions``. Never raises.
    """
    binding = _BINDING.get()
    if binding is None or not text:
        return
    try:
        recorder, span_id = binding
        item = recorder.get_span(span_id)
        if item is None or item.kind != KIND_LLM or recorder.closed:
            return
        cleaner = recorder.sanitizer(_PROMPT_VALUE_CHARS)
        additions = list(item.meta.get("provider_additions") or [])
        if len(additions) >= _MAX_ADDITIONS:
            return
        additions.append(
            {
                "channel": channel,
                "reason": reason,
                "chars": len(text),
                "text": cleaner.text(str(text)),
            }
        )
        item.meta["provider_additions"] = additions
    except Exception:  # noqa: BLE001 — tracing must never break a turn.
        logger.debug("trace prompt addition failed", exc_info=True)


def _finish_reason(response: Any) -> str | None:
    """Finish reason of the first choice / candidate, when it is a string."""
    for attr in ("choices", "candidates"):
        items = getattr(response, attr, None)
        if not isinstance(items, list | tuple) or not items:
            continue
        reason = getattr(items[0], "finish_reason", None)
        if isinstance(reason, str):
            return reason
        name = getattr(reason, "name", None)
        if isinstance(name, str):
            return name
    return None
