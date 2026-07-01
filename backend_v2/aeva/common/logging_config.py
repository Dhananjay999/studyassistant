"""Central logging setup + small helpers for consistent, readable logs.

Nothing in the app prints unless the root logger has a handler and level, so
``setup_logging`` is called once from the app factory. It wires a single stdout
handler with a uniform format, drives the app level from ``LOG_LEVEL`` and the
outbound-HTTP level (LLM APIs + Supabase REST/storage, which all go through
httpx) from ``LOG_HTTP_LEVEL``. Set ``LOG_LEVEL=DEBUG`` to see prompts,
payloads, and request bodies; keep it at ``INFO`` for a clean lifecycle trace.
"""

import logging
import os
import sys

_FORMAT = "%(asctime)s %(levelname)-7s [%(name)s] %(message)s"
_DATEFMT = "%Y-%m-%d %H:%M:%S"

_CONFIGURED = False


def setup_logging() -> None:
    """Configure the root logger once (idempotent)."""
    global _CONFIGURED  # noqa: PLW0603 - one-time process-wide setup flag
    if _CONFIGURED:
        return

    level = os.environ.get("LOG_LEVEL", "INFO").upper()
    http_level = os.environ.get("LOG_HTTP_LEVEL", "INFO").upper()

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(_FORMAT, datefmt=_DATEFMT))

    root = logging.getLogger()
    # Replace any pre-existing handlers so lines are not duplicated.
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)

    # Outbound HTTP: httpx logs one line per request ("HTTP Request: POST ...
    # 200 OK"), which is our free view of every LLM API and Supabase REST call.
    logging.getLogger("httpx").setLevel(http_level)
    # httpcore/hpack are extremely chatty at DEBUG and add no value; pin them.
    logging.getLogger("httpcore").setLevel("WARNING")
    logging.getLogger("hpack").setLevel("WARNING")

    _CONFIGURED = True
    logging.getLogger(__name__).info(
        "Logging configured | level=%s | http=%s", level, http_level
    )


def preview(value: object, limit: int = 300) -> str:
    """Single-line, length-capped preview of a value for DEBUG logs."""
    text = value if isinstance(value, str) else repr(value)
    text = " ".join(text.split())
    if len(text) > limit:
        return f"{text[:limit]}… (+{len(text) - limit} chars)"
    return text


def log_full_llm_requests() -> bool:
    """Whether to log the full, untruncated request for every LLM call.

    Driven by ``LOG_LLM_REQUESTS`` (default off) so the verbose full-prompt
    dump — system prompt, history, attachments, and the final user message —
    can be turned on independently of ``LOG_LEVEL``. When off, callers fall
    back to a capped :func:`preview` at DEBUG.
    """
    return os.environ.get("LOG_LLM_REQUESTS", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
