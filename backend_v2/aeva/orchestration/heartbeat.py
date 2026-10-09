"""SSE keep-alive: ``ping`` frames while a streaming turn is silent.

A tool can block for tens of seconds before its first token (web search
takes ~5 s to the first token; a long answer or a slow retrieval adds more).
Mobile browsers and proxies drop an SSE connection that stays silent for
too long, and the client then reports a failure even though the backend
finishes and persists the answer.

:func:`keep_alive` wraps the turn's frame generator: a worker thread drives
the wrapped generator and hands its frames to the request thread, which
yields them in order and, whenever none arrived for ``interval_s``, yields a
``ping`` frame instead. The generator's return value and any exception are
passed through unchanged, so callers use ``yield from keep_alive(...)``
exactly as they used the bare generator.

The worker runs in a copy of the request thread's context (``contextvars``),
which is what carries Flask's application context and the trace position
across the thread boundary.
"""

import contextvars
import logging
import queue
import threading
from collections.abc import Generator
from typing import Any, TypeVar

from aeva.llm.llm_client import LLMClient

logger = logging.getLogger(__name__)

PING_INTERVAL_S = 15.0

_T = TypeVar("_T")

_FRAME = "frame"
_DONE = "done"
_ERROR = "error"


def ping_frame() -> str:
    """Build the keep-alive frame: a typed frame with no content."""
    return LLMClient.format_sse_chunk("", extra={"type": "ping"})


def keep_alive(
    frames: Generator[str, None, _T],
    *,
    interval_s: float = PING_INTERVAL_S,
) -> Generator[str, None, _T]:
    """Yield ``frames`` as they come, with a ``ping`` after each silent gap.

    Returns what ``frames`` returns; re-raises what ``frames`` raises. When
    the consumer stops early (client gone), the wrapped generator is closed
    from the worker at its next frame so its cleanup still runs.
    """
    events: queue.Queue[tuple[str, Any]] = queue.Queue()
    stop = threading.Event()
    context = contextvars.copy_context()

    def drive() -> None:
        try:
            while True:
                try:
                    frame = next(frames)
                except StopIteration as done:
                    events.put((_DONE, done.value))
                    return
                if stop.is_set():
                    frames.close()
                    return
                events.put((_FRAME, frame))
        except BaseException as exc:  # noqa: BLE001  (re-raised by the caller)
            events.put((_ERROR, exc))

    worker = threading.Thread(
        target=context.run,
        args=(drive,),
        name="sse-keep-alive",
        daemon=True,
    )
    worker.start()
    try:
        while True:
            try:
                kind, payload = events.get(timeout=interval_s)
            except queue.Empty:
                logger.debug("Stream silent for %.0fs; ping", interval_s)
                yield ping_frame()
                continue
            if kind == _FRAME:
                yield payload
            elif kind == _DONE:
                return payload
            else:
                raise payload
    finally:
        stop.set()
