"""Tracing service for the LLM choke point: ``LLMClient`` and its providers.

``LLMClient`` puts one ``trace_*`` decorator on each of its five call methods,
and the providers report what only they can see (token usage, text they
append to a prompt) through the ``note_*`` functions. What an ``llm`` or
``embedding`` span holds, and how it is worded, is decided here.

Rules every function in this module keeps:

* a plain pass-through when no turn is being traced;
* the wrapped call's arguments, result and exceptions are never altered;
* a fault in the bookkeeping is logged at DEBUG and dropped;
* bytes and vectors never enter a span: sizes and counts only.
"""

import functools
import inspect
import json
import logging
import time
from collections.abc import Callable, Generator
from dataclasses import dataclass
from typing import Any, ParamSpec, TypeVar

from aeva import tracing

logger = logging.getLogger(__name__)

_P = ParamSpec("_P")
_R = TypeVar("_R")
_Y = TypeVar("_Y")
_S = TypeVar("_S")
_T = TypeVar("_T")

# ``tracing.state()`` key: token totals of the embed calls now running,
# by span id (an embed call may make several vendor requests).
_EMBED_USAGE = "llm_trace.embed_usage"
# The embed task whose texts are recorded (a search query's few variants).
_QUERY_TASK = "RETRIEVAL_QUERY"

_SCHEMA_HINT_REASON = (
    "This provider has no native response schema, so the schema "
    "is appended to the system prompt as a JSON hint."
)
_DROPPED_ATTACHMENTS_REASON = (
    "Non-image attachments cannot be sent to this provider; "
    "they were dropped and this note was appended."
)


@dataclass(frozen=True)
class _Shape:
    """How one ``LLMClient`` method maps onto an ``llm`` span."""

    method: str
    # Span name when no prompt template is known and the call names none.
    label: str
    # Parameter that carries the user channel.
    message: str = "user_message"
    # False for a call that sends no system prompt at all.
    sends_system: bool = True
    # Extra parameters copied into the span input.
    extra: tuple[str, ...] = ()


_GENERATE = _Shape("generate", "generate")
_STRUCTURED = _Shape("generate_structured", "structured")
_STREAM = _Shape("generate_stream", "stream")
_IMAGE = _Shape(
    "generate_image",
    "image",
    message="prompt",
    sends_system=False,
    extra=("aspect",),
)


# ------------------------------------------------------------------ guards


def _safely(action: Callable[..., _R], *args: Any) -> _R | None:
    """Run one piece of bookkeeping; a failure costs the detail, not a call."""
    try:
        return action(*args)
    except Exception:  # noqa: BLE001 — tracing must never break a call.
        logger.debug("llm trace bookkeeping failed", exc_info=True)
        return None


def _read(obj: Any, name: str) -> Any:
    """``obj.<name>``, or ``None`` when it is missing or cannot be read."""
    try:
        return getattr(obj, name, None)
    except Exception:  # noqa: BLE001 — a property that raises.
        return None


def _signature(func: Callable[..., Any]) -> inspect.Signature | None:
    """Signature of a method being decorated, if it has a readable one."""
    try:
        return inspect.signature(func)
    except (TypeError, ValueError):
        return None


def _arguments(
    signature: inspect.Signature,
    args: tuple[Any, ...],
    kwargs: dict[str, Any],
) -> dict[str, Any] | None:
    """Map the call's arguments to parameter names, defaults filled in.

    ``None`` when they do not fit the signature: the call is then left to
    raise its own ``TypeError``, untraced.
    """
    try:
        bound = signature.bind(*args, **kwargs)
        bound.apply_defaults()
    except TypeError:
        return None
    return dict(bound.arguments)


def _listed(value: Any) -> Any:
    """``value`` when reading it cannot use it up, else ``None``.

    A one-shot iterator passed where a list is expected must reach the
    provider untouched, so it is left out of the span instead of read.
    """
    return value if isinstance(value, list | tuple) else None


# ---------------------------------------------------------------- payloads


def _default_system_prompt() -> str:
    """Return the prompt every provider sends when a call brings none."""
    # Imported on use: the LLM package imports this module.
    from aeva.llm import prompts

    return str(prompts.SYSTEM_PROMPT)


def _request(
    shape: _Shape, call: dict[str, Any]
) -> tuple[dict[str, Any], bool]:
    """``tracing.llm_call`` arguments for one call, and "prompt defaulted".

    The span holds the request as the provider will send it: a call without
    a system prompt gets the global one (every provider substitutes it),
    which the caller flags as ``system_prompt_defaulted``. The caller's own
    strings go through unaltered, so the recorder can match them against
    the prompt build that rendered them and name the template.
    """
    client = call.get("self")
    request: dict[str, Any] = {
        "method": shape.method,
        "label": shape.label,
        "provider": "",
        "model": "",
    }
    defaulted = False
    try:
        system_prompt = call.get("system_prompt")
        defaulted = shape.sends_system and not system_prompt
        sent: str | None = None
        if shape.sends_system:
            sent = system_prompt or _default_system_prompt()
        request.update(
            label=call.get("log_label") or shape.label,
            provider=_read(client, "_provider_name") or "",
            model=_read(client, "model") or "",
            config_key=_read(client, "_config_key"),
            user_message=call.get(shape.message, ""),
            system_prompt=sent,
            history=_listed(call.get("history")),
            attachments=_listed(call.get("attachments")),
            response_schema=call.get("response_schema"),
            use_search=bool(call.get("use_search", False)),
            extra={name: call.get(name) for name in shape.extra} or None,
        )
    except Exception:  # noqa: BLE001 — tracing must never break a call.
        logger.debug("llm trace request failed", exc_info=True)
    return request, defaulted


def _chars(value: object) -> int | None:
    """Size of a call's result: text length, else JSON length."""
    if isinstance(value, str):
        return len(value)
    try:
        return len(json.dumps(value, default=str, ensure_ascii=False))
    except (TypeError, ValueError):
        return None


def _sources(call: dict[str, Any]) -> list[Any]:
    """Return the grounding citations the provider captured for this call."""
    return _read(call.get("self"), "last_sources") or []


def _record_text(
    sp: tracing.SpanHandle, call: dict[str, Any], result: Any
) -> None:
    """Output of ``generate``: the raw text, plus citations after a search."""
    sp.set(output={"text": result}, meta={"output_chars": _chars(result)})
    if call.get("use_search"):
        sp.set(meta={"sources": _sources(call)})


def _record_json(
    sp: tracing.SpanHandle,
    call: dict[str, Any],  # noqa: ARG001 — same shape as the other recorders.
    result: Any,
) -> None:
    """Output of ``generate_structured``: the parsed JSON."""
    sp.set(output={"json": result}, meta={"output_chars": _chars(result)})


def _record_image(
    sp: tracing.SpanHandle,
    call: dict[str, Any],  # noqa: ARG001 — same shape as the other recorders.
    result: Any,
) -> None:
    """Output of ``generate_image``: size and type, never the bytes."""
    image, mime, caption = result
    sp.set(
        output={
            "image": {
                "bytes": len(image),
                "mime_type": mime,
                "caption": caption,
            }
        }
    )


def _embed_input(call: dict[str, Any]) -> dict[str, Any]:
    """Input of an embed call.

    Sizes only (indexing embeds a whole document's chunks), except for a
    search query, whose few variants are what retrieval actually ran on.
    """
    texts = _listed(call.get("texts"))
    task_type = call.get("task_type")
    payload: dict[str, Any] = {
        "task_type": task_type,
        "count": None,
        "total_chars": None,
        "dim": call.get("output_dimensionality"),
    }
    if texts is not None:
        payload["count"] = len(texts)
        payload["total_chars"] = sum(
            len(text) for text in texts if isinstance(text, str)
        )
        if task_type == _QUERY_TASK:
            payload["texts"] = list(texts)
    return payload


# ------------------------------------------------------ LLMClient decorators


def _traced_call(
    func: Callable[_P, _R],
    shape: _Shape,
    record: Callable[[tracing.SpanHandle, dict[str, Any], Any], None],
) -> Callable[_P, _R]:
    """Wrap a blocking ``LLMClient`` method in one ``llm`` span.

    The span is open for the whole call, so the provider's ``note_*``
    reports land on it; an exception from the call marks it ``error`` and
    propagates unchanged.
    """
    signature = _signature(func)
    if signature is None:
        return func

    @functools.wraps(func)
    def wrapper(*args: _P.args, **kwargs: _P.kwargs) -> _R:
        if not tracing.is_active():
            return func(*args, **kwargs)
        call = _arguments(signature, args, kwargs)
        if call is None:
            return func(*args, **kwargs)
        request, defaulted = _request(shape, call)
        with tracing.llm_call(**request) as sp:
            if defaulted:
                sp.set(meta={"system_prompt_defaulted": True})
            result = func(*args, **kwargs)
            if sp.active:
                _safely(record, sp, call, result)
        return result

    return wrapper


def trace_generate(func: Callable[_P, _R]) -> Callable[_P, _R]:
    """Record ``LLMClient.generate``: request, raw text, search citations."""
    return _traced_call(func, _GENERATE, _record_text)


def trace_structured(func: Callable[_P, _R]) -> Callable[_P, _R]:
    """Record ``LLMClient.generate_structured``: request, schema, JSON."""
    return _traced_call(func, _STRUCTURED, _record_json)


def trace_image(func: Callable[_P, _R]) -> Callable[_P, _R]:
    """Record ``LLMClient.generate_image``: prompt, image size and type.

    No system prompt travels with an image request, so none is recorded.
    """
    return _traced_call(func, _IMAGE, _record_image)


class _Tap(Generator[_Y, _S, _T]):
    """A generator seen through a counter: forwards everything, keeps a tally.

    ``yield from`` hands ``send`` / ``throw`` / ``close`` to the object it
    delegates to. Delegating to this instead of to the stream itself keeps
    those semantics (an exception thrown in by the consumer still reaches
    the stream's own handlers) while every chunk passes through ``_seen``.
    """

    __slots__ = ("_opened", "_stream", "chunks", "parts", "ttft_ms")

    def __init__(self, stream: Generator[_Y, _S, _T]) -> None:
        self._stream = stream
        self._opened = time.perf_counter()
        self.chunks = 0
        self.parts: list[_Y] = []
        # Time to the first chunk, from the moment the span opened.
        self.ttft_ms: int | None = None

    def _seen(self, chunk: _Y) -> _Y:
        """Count one chunk on its way to the consumer."""
        if self.ttft_ms is None:
            self.ttft_ms = int((time.perf_counter() - self._opened) * 1000)
        self.chunks += 1
        self.parts.append(chunk)
        return chunk

    def send(self, value: _S) -> _Y:
        """Advance the stream (``next`` is ``send(None)``)."""
        return self._seen(self._stream.send(value))

    def throw(self, typ: Any, val: Any = None, tb: Any = None) -> _Y:
        """Raise the consumer's exception inside the stream."""
        if val is None and tb is None:
            return self._seen(self._stream.throw(typ))
        return self._seen(self._stream.throw(typ, val, tb))

    def close(self) -> None:
        """Close the stream when the consumer stops iterating."""
        self._stream.close()


def _record_stream(
    sp: tracing.SpanHandle,
    call: dict[str, Any],
    tap: _Tap[Any, Any, Any],
    exhausted: bool,  # noqa: FBT001 — internal, always passed by position.
) -> None:
    """Output of a stream: the text that arrived, complete or partial."""
    text = "".join(
        part if isinstance(part, str) else str(part) for part in tap.parts
    )
    meta: dict[str, Any] = {"chunks": tap.chunks, "output_chars": len(text)}
    if tap.ttft_ms is not None:
        meta["ttft_ms"] = tap.ttft_ms
    if exhausted and call.get("use_search"):
        # Citations are complete only once the stream ran dry.
        meta["sources"] = _sources(call)
    sp.set(output={"text": text}, meta=meta)


def _traced_stream(
    stream: Generator[_Y, _S, _T], call: dict[str, Any]
) -> Generator[_Y, _S, _T]:
    """Yield the stream inside an ``llm`` span that opens on first use.

    A stream nobody consumes never called the model, so nothing is recorded
    for it. The ``finally`` is also reached when the provider raised (span
    ``error``) or the consumer stopped iterating, as on a client disconnect
    (span ``aborted``): the trace keeps whatever text had arrived by then.
    """
    request, defaulted = _request(_STREAM, call)
    with tracing.llm_call(**request) as sp:
        if not sp.active:
            return (yield from stream)
        if defaulted:
            sp.set(meta={"system_prompt_defaulted": True})
        tap = _Tap(stream)
        exhausted = False
        try:
            result = yield from tap
            exhausted = True
        finally:
            _safely(_record_stream, sp, call, tap, exhausted)
    return result


def trace_stream(
    func: Callable[_P, Generator[_Y, _S, _T]],
) -> Callable[_P, Generator[_Y, _S, _T]]:
    """Record ``LLMClient.generate_stream``: request, text, chunks, TTFT.

    The method runs as before and its generator is returned wrapped; with no
    turn being traced it is returned as it is.
    """
    signature = _signature(func)
    if signature is None:
        return func

    @functools.wraps(func)
    def wrapper(*args: _P.args, **kwargs: _P.kwargs) -> Generator[_Y, _S, _T]:
        stream = func(*args, **kwargs)
        if not tracing.is_active() or not inspect.isgenerator(stream):
            return stream
        call = _arguments(signature, args, kwargs)
        if call is None:
            return stream
        return _traced_stream(stream, call)

    return wrapper


def _open_usage(sp: tracing.SpanHandle) -> None:
    """Start the token tally of the embed call ``sp`` records."""
    if sp.id is not None:
        tracing.state().setdefault(_EMBED_USAGE, {})[sp.id] = {}


def _close_usage(sp: tracing.SpanHandle) -> None:
    """Drop the tally once the embed call returned or raised."""
    tracing.state().get(_EMBED_USAGE, {}).pop(sp.id, None)


def _record_vectors(sp: tracing.SpanHandle, vectors: Any) -> None:
    """Output of an embed call: a count, never the vectors."""
    sp.set(output={"vectors": len(vectors)})


def trace_embed(func: Callable[_P, _R]) -> Callable[_P, _R]:
    """Record ``LLMClient.embed`` as one ``embedding`` span."""
    signature = _signature(func)
    if signature is None:
        return func

    @functools.wraps(func)
    def wrapper(*args: _P.args, **kwargs: _P.kwargs) -> _R:
        if not tracing.is_active():
            return func(*args, **kwargs)
        call = _arguments(signature, args, kwargs)
        if call is None:
            return func(*args, **kwargs)
        client = call.get("self")
        with tracing.span(
            tracing.KIND_EMBEDDING,
            "embed",
            input=_safely(_embed_input, call),
            meta={
                "method": "embed",
                "config_key": _read(client, "_config_key"),
            },
            provider=_read(client, "_provider_name"),
            model=_read(client, "model"),
        ) as sp:
            _safely(_open_usage, sp)
            try:
                vectors = func(*args, **kwargs)
            finally:
                _safely(_close_usage, sp)
            if sp.active:
                _safely(_record_vectors, sp, vectors)
        return vectors

    return wrapper


# ------------------------------------------------------- provider reports
#
# Called by the vendor adapters, on the thread making the call, while the
# span opened by the decorators above is the current one.


def note_response(response: Any) -> None:
    """Token usage and finish reason of a vendor response (or stream chunk).

    A later report replaces an earlier one, which is right for a stream:
    its chunks carry running totals and the last one the finish reason.
    """
    tracing.note_llm_response(response)


def _add_embed_usage(response: Any) -> None:
    """Add one embeddings response's token counts to its call's total."""
    span = tracing.current()
    tally = tracing.state().get(_EMBED_USAGE, {}).get(span.id)
    if tally is None:
        return
    usage = getattr(response, "usage", None)
    for attr, key in (
        ("prompt_tokens", "input_tokens"),
        ("total_tokens", "total_tokens"),
    ):
        number = getattr(usage, attr, None)
        if isinstance(number, int) and not isinstance(number, bool):
            tally[key] = tally.get(key, 0) + number
    if tally:
        span.set(meta={"usage": dict(tally)})


def note_embed_response(response: Any) -> None:
    """Token usage of one embeddings request.

    Summed over the requests of the call: a long input is sent in batches,
    and one batch's count would misstate the total.
    """
    if tracing.is_active():
        _safely(_add_embed_usage, response)


def _add_schema_hint(schema_hint: str) -> None:
    """Record the hint as the provider joined it to the system prompt."""
    if schema_hint:
        tracing.note_prompt_addition(
            "system", f"\n\n{schema_hint}", _SCHEMA_HINT_REASON
        )


def note_schema_hint(schema_hint: str) -> None:
    """Record the JSON-schema hint a provider appended to the system prompt.

    It is part of what the model received but of no template, so it is kept
    on the call's span as ``meta.provider_additions``.
    """
    if tracing.is_active():
        _safely(_add_schema_hint, schema_hint)


def _add_attachment_note(user_message: str, sent_text: str) -> None:
    """Record what ``sent_text`` holds after the caller's own message."""
    if sent_text.startswith(user_message):
        tracing.note_prompt_addition(
            "user",
            sent_text[len(user_message) :],
            _DROPPED_ATTACHMENTS_REASON,
        )


def note_dropped_attachments(user_message: str, sent_text: str) -> None:
    """Record the note about dropped files a provider appended to the message.

    ``sent_text`` is the user message as sent; what follows the caller's
    own text is the addition, kept as ``meta.provider_additions``.
    """
    if tracing.is_active():
        _safely(_add_attachment_note, user_message, sent_text)
