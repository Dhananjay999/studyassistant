"""Persist a finished trace to Supabase — best-effort, after the answer.

The only database I/O tracing ever does. It runs once per turn, from
``finish_turn``, after the final SSE frame was handed to the client, on the
request thread (its Supabase client is already warm; a background thread
would not reliably survive the response on serverless).

Failures are logged and dropped. If the trace tables do not exist yet
(migration 024 not applied), tracing switches itself off for a while so turns
do not each pay for a doomed round trip.
"""

import json
import logging
import time
from typing import Any

logger = logging.getLogger(__name__)

TRACES_TABLE = "ai_traces"
SPANS_TABLE = "ai_trace_spans"
PROMPT_VERSIONS_TABLE = "ai_prompt_versions"

# Span rows are inserted in batches bounded by row count and payload size.
_BATCH_ROWS = 40
_BATCH_CHARS = 900_000

# Once a flush has taken this long, no further batch is started: a slow
# database must not keep the request (and the serverless instance) occupied.
_BUDGET_S = 8.0

# How long tracing stays off after the tables were found missing.
_BACKOFF_S = 600.0
_unavailable_until = 0.0

# (name, hash) pairs this process already wrote to ``ai_prompt_versions``.
_known_prompt_versions: set[tuple[str, str]] = set()

# PostgREST / Postgres codes for "that table does not exist". Older PostgREST
# versions answer an insert into an unknown table with a bare HTTP 404.
_MISSING_TABLE_CODES = {"PGRST205", "42P01"}
_NOT_FOUND = "404"


def available() -> bool:
    """Whether trace storage is believed to exist (see the backoff above)."""
    return time.monotonic() >= _unavailable_until


def _is_missing_table(exc: Exception) -> bool:
    """Whether ``exc`` says the trace tables have not been created."""
    code = str(getattr(exc, "code", "") or "")
    if code in _MISSING_TABLE_CODES or code == _NOT_FOUND:
        return True
    text = str(exc)
    return any(code in text for code in _MISSING_TABLE_CODES)


def _batches(rows: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    """Split span rows so no single insert is oversized."""
    out: list[list[dict[str, Any]]] = []
    batch: list[dict[str, Any]] = []
    size = 0
    for row in rows:
        row_size = len(json.dumps(row, ensure_ascii=False, default=str))
        if batch and (
            len(batch) >= _BATCH_ROWS or size + row_size > _BATCH_CHARS
        ):
            out.append(batch)
            batch, size = [], 0
        batch.append(row)
        size += row_size
    if batch:
        out.append(batch)
    return out


def persist(
    trace_row: dict[str, Any],
    span_rows: list[dict[str, Any]],
    prompt_rows: list[dict[str, Any]],
) -> bool:
    """Write one trace. Returns whether the trace row was saved."""
    global _unavailable_until  # noqa: PLW0603 — process-wide backoff.
    started = time.monotonic()
    try:
        from postgrest.types import ReturnMethod

        from aeva.supabase.supabase_service import SupabaseService

        client = SupabaseService().client
        # ``minimal``: do not have the rows echoed back in the response.
        client.table(TRACES_TABLE).insert(
            trace_row, returning=ReturnMethod.minimal
        ).execute()
    except Exception as exc:  # noqa: BLE001 — best-effort by design.
        if _is_missing_table(exc):
            _unavailable_until = time.monotonic() + _BACKOFF_S
            logger.warning(
                "AI trace tables not found (apply migration "
                "024_ai_execution_traces.sql); tracing paused for %.0fs",
                _BACKOFF_S,
            )
        else:
            logger.warning("AI trace write failed", exc_info=True)
        return False

    try:
        for batch in _batches(span_rows):
            if time.monotonic() - started > _BUDGET_S:
                # The database is slow: stop here rather than hold the
                # request open. The trace keeps the spans written so far.
                logger.warning(
                    "AI trace %s: time budget spent, remaining spans dropped",
                    trace_row.get("id"),
                )
                return True
            client.table(SPANS_TABLE).insert(
                batch, returning=ReturnMethod.minimal
            ).execute()
    except Exception:  # noqa: BLE001 — best-effort by design.
        logger.warning(
            "AI trace %s saved without all of its spans",
            trace_row.get("id"),
            exc_info=True,
        )

    if time.monotonic() - started <= _BUDGET_S:
        _save_prompt_versions(client, prompt_rows)
    return True


def _save_prompt_versions(client: Any, rows: list[dict[str, Any]]) -> None:
    """Record template versions this process has not written before."""
    fresh = [
        row
        for row in rows
        if (row["name"], row["hash"]) not in _known_prompt_versions
    ]
    if not fresh:
        return
    try:
        from postgrest.types import ReturnMethod

        client.table(PROMPT_VERSIONS_TABLE).upsert(
            fresh,
            on_conflict="name,hash",
            ignore_duplicates=True,
            returning=ReturnMethod.minimal,
        ).execute()
    except Exception:  # noqa: BLE001 — best-effort by design.
        logger.warning("AI prompt version write failed", exc_info=True)
        return
    for row in fresh:
        _known_prompt_versions.add((row["name"], row["hash"]))
