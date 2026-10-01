"""Admin reads over the AI execution traces, and the prompt catalog.

Backs Admin → Traces (list, search by any id, one trace with its span tree,
the traces of a session, retention purge) and Admin → Prompt map (the static
catalog from ``aeva.tracing.catalog`` plus usage counts from the traces).

The trace tables come from migration ``024_ai_execution_traces.sql``. Until
it is applied every read here degrades instead of failing: lists come back
empty with ``available: false``, a single trace is ``NOT_FOUND``, and the
prompt map loads without usage statistics (the text of the deployed
templates is still served, from the code).

Extends :class:`AdminRepository` for its service-role client, owner
flattening and audit trail.
"""

import logging
import re
import uuid
from datetime import UTC, datetime
from typing import Any

from aeva.admin.admin_repository import AdminRepository
from aeva.common.errors import ERROR_CODES, CustomError
from aeva.common.schema import success_response
from aeva.tracing import catalog
from aeva.tracing.store import (
    PROMPT_VERSIONS_TABLE,
    SPANS_TABLE,
    TRACES_TABLE,
)

logger = logging.getLogger(__name__)

# Everything the list needs; ``meta`` (large) is only sent with one trace.
_SUMMARY_COLUMNS = (
    "id, kind, user_id, session_id, run_id, user_message_id, "
    "assistant_message_id, endpoint, status, error, query, plan_source, "
    "plan_action, tools, models, prompt_names, span_count, llm_calls, "
    "duration_ms, started_at, git_sha, created_at"
)
# ai_traces.user_id references profiles, so the owner can be embedded.
_OWNER = "owner:profiles(id, email, full_name)"

# "Search a flow by any id": a UUID in the search box is matched against
# every id a trace carries.
_ID_COLUMNS = (
    "id",
    "session_id",
    "user_id",
    "assistant_message_id",
    "user_message_id",
    "run_id",
)

# Tool and prompt names are identifiers. Anything else cannot match a row
# and would break the array literal of the containment filter.
_NAME_RE = re.compile(r"[A-Za-z0-9_.:+-]{1,120}")

_VERSION_COLUMNS = "name, hash, git_sha, first_seen_at"
_VERSION_LIMIT = 1000
_SESSION_TRACE_LIMIT = 200

# Spans carry full prompts and outputs, so they are fetched in modest pages.
_SPAN_PAGE = 200
_MAX_SPAN_PAGES = 100

# PostgREST / Postgres codes for "that table or function does not exist"
# (migration 024 not applied).
_MISSING_CODES = frozenset({"PGRST205", "42P01", "PGRST202", "42883"})
# PostgREST 12 resolves the ``owner:profiles(...)`` embed before it looks for
# the table, so there a missing ``ai_traces`` surfaces as "Could not find a
# relationship between 'ai_traces' and 'profiles'".
_NO_RELATIONSHIP_CODE = "PGRST200"
# A counted range that starts past the last row. PostgREST 12 and 14 answer
# PGRST103. 13.0.x answers HTTP 416 with a wrong Content-Length: postgrest-py
# cannot parse the body and reports the status as the code, and the rest of
# the body is left on the connection, where it breaks the next request.
_OUT_OF_RANGE_CODES = frozenset({"PGRST103", "416"})


def _as_uuid(value: object) -> str | None:
    """Canonical form of a UUID string, or ``None`` when it is not one."""
    try:
        return str(uuid.UUID(str(value).strip()))
    except (ValueError, AttributeError, TypeError):
        return None


def _code(exc: Exception) -> str:
    """Return the code a Supabase error carries ('' when it has none)."""
    code = getattr(exc, "code", None)
    return "" if code is None else str(code)


def _is_missing(exc: Exception) -> bool:
    """Whether ``exc`` says the trace tables / functions do not exist."""
    code = _code(exc)
    if code == _NO_RELATIONSHIP_CODE:
        text = f"{getattr(exc, 'message', '') or ''} {exc}"
        return TRACES_TABLE in text
    if code:
        return code in _MISSING_CODES
    # An error without a code (a wrapped or re-raised one): read its text.
    text = str(exc)
    return any(item in text for item in _MISSING_CODES)


def _is_out_of_range(exc: Exception) -> bool:
    """Whether ``exc`` says the requested page starts past the last row.

    Matched on the error's real code only: "416" is far too common a
    substring to look for in an error text.
    """
    return _code(exc) in _OUT_OF_RANGE_CODES


def _like_pattern(term: str) -> str | None:
    r"""``term`` as an ``ilike`` pattern that matches the text as typed.

    ``\``, ``%`` and ``_`` are escaped, so they match themselves instead of
    acting as wildcards. ``*`` cannot be escaped (PostgREST rewrites every
    ``*`` to ``%`` before the database sees the pattern), so it becomes
    ``_``: any one character, the star included. ``None`` for an empty term.
    """
    text = term.strip()
    if not text:
        return None
    for char in ("\\", "%", "_"):
        text = text.replace(char, f"\\{char}")
    return f"%{text.replace('*', '_')}%"


def _timestamp(value: object) -> datetime:
    """Parse an ISO timestamp for comparison (oldest possible when unset)."""
    try:
        parsed = datetime.fromisoformat(str(value))
    except ValueError:
        return datetime.min.replace(tzinfo=UTC)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _count(value: object) -> int:
    """Read a count column that may arrive as an int, a string or null."""
    if not isinstance(value, int | float | str):
        return 0
    try:
        return int(value)
    except (ValueError, OverflowError):
        return 0


def _prompt_stats(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Usage of one template: totals plus one entry per version (hash)."""
    versions = sorted(
        (
            {
                "hash": str(row.get("prompt_hash") or ""),
                "uses": _count(row.get("uses")),
                "traces": _count(row.get("traces")),
                "first_used": row.get("first_used"),
                "last_used": row.get("last_used"),
            }
            for row in rows
        ),
        key=lambda item: _timestamp(item["last_used"]),
        reverse=True,
    )
    return {
        "uses": sum(item["uses"] for item in versions),
        "traces": sum(item["traces"] for item in versions),
        "last_used": versions[0]["last_used"] if versions else None,
        "versions": versions,
    }


class TraceRepository(AdminRepository):
    """Read (and purge) AI execution traces; serve the prompt catalog."""

    # ------------------------------------------------------------------
    # Trace list
    # ------------------------------------------------------------------

    def list_traces(self, query: Any) -> dict[str, Any]:
        """Paginated, filterable trace list, newest first.

        ``q`` that is a UUID is matched against every id a trace carries;
        any other text is searched in the user's message. A filter that
        cannot match a row (a malformed id, a name with stray characters)
        returns an empty page without querying.
        """
        page: dict[str, Any] = {
            "items": [],
            "total": 0,
            "page": query.page,
            "page_size": query.page_size,
            "available": True,
        }
        try:
            found = self._page(query)
        except Exception as exc:
            if not _is_missing(exc):
                raise
            logger.info("AI trace tables not found (migration 024)")
            return success_response(
                "Traces unavailable", {**page, "available": False}
            )
        if found is not None:
            page["items"], page["total"] = found
        return success_response("Traces loaded", page)

    def _page(self, query: Any) -> tuple[list[dict[str, Any]], int] | None:
        """Rows of the requested page and the total number of matches.

        ``None`` when the filters cannot match a row. A page past the last
        row (a stale link, or the list shrank after a purge) is empty and
        still reports the total, so the UI can step back to the last page.

        PostgREST rejects a *counted* range that starts past the last row,
        and 13.0.x does it with a malformed response (see
        ``_OUT_OF_RANGE_CODES``) that would fail whatever request used the
        shared client next. Such a range is therefore never requested: only
        the first page, which is always in range, is fetched together with
        its count. Later pages ask for the count on its own first and for
        the rows, uncounted, only when the page exists.
        """
        offset = (query.page - 1) * query.page_size
        first_page = offset == 0
        total = 0
        if not first_page:
            known = self._total(query)
            if known is None:
                return None
            if offset >= known:
                return [], known
            total = known
        base = self._filtered(
            query, f"{_SUMMARY_COLUMNS}, {_OWNER}", counted=first_page
        )
        if base is None:
            return None
        try:
            res = (
                base.order("created_at", desc=True)
                .range(offset, offset + query.page_size - 1)
                .execute()
            )
        except Exception as exc:
            if first_page or not _is_out_of_range(exc):
                raise
            # Not expected of an uncounted range; the total is known anyway.
            return [], total
        rows = [self._flatten_owner(r) for r in (res.data or [])]
        return rows, _count(res.count) if first_page else total

    def _total(self, query: Any) -> int | None:
        """Exact number of traces matching ``query``'s filters.

        ``None`` when the filters cannot match a row. One narrow row from
        the top is always in range, whatever page was asked for.
        """
        base = self._filtered(query, "id", counted=True)
        if base is None:
            return None
        return _count(base.limit(1).execute().count)

    def _filtered(
        self, query: Any, columns: str, *, counted: bool
    ) -> Any | None:
        """Build the filtered trace query; ``None`` when nothing can match."""
        table = self.client.table(TRACES_TABLE)
        base = (
            table.select(columns, count="exact")
            if counted
            else table.select(columns)
        )
        for column in ("user_id", "session_id"):
            raw = getattr(query, column)
            if raw:
                key = _as_uuid(raw)
                if key is None:
                    return None
                base = base.eq(column, key)
        for column in ("status", "plan_source"):
            value = getattr(query, column)
            if value:
                base = base.eq(column, value)
        for column, name in (
            ("tools", query.tool),
            ("prompt_names", query.prompt),
        ):
            if name:
                if not _NAME_RE.fullmatch(name):
                    return None
                base = base.contains(column, [name])
        return self._search(base, query.q)

    def _trace_of_message(self, message_id: str) -> str | None:
        """Trace id stamped on a chat message (``metadata.trace_id``)."""
        try:
            rows = (
                self.client.table("messages")
                .select("metadata")
                .eq("id", message_id)
                .limit(1)
                .execute()
                .data
                or []
            )
        except Exception:  # noqa: BLE001 — an extra match, never required.
            logger.debug("Message lookup for trace search failed")
            return None
        metadata = rows[0].get("metadata") if rows else None
        if not isinstance(metadata, dict):
            return None
        return _as_uuid(metadata.get("trace_id"))

    def _search(self, base: Any, q: str) -> Any:
        """Apply the free-text / any-id search term to a trace query."""
        term = (q or "").strip()
        if not term:
            return base
        needle = _as_uuid(term)
        if needle is not None:
            clauses = [f"{column}.eq.{needle}" for column in _ID_COLUMNS]
            # A chat message carries its turn's trace id in its metadata,
            # so any message id finds its trace (a clarification question's
            # id is not on the trace row itself).
            stamped = self._trace_of_message(needle)
            if stamped is not None:
                clauses.append(f"id.eq.{stamped}")
            return base.or_(",".join(clauses))
        # One column, so a plain ilike filter (not an ``or`` clause) is
        # enough and commas or brackets in the text are safe.
        pattern = _like_pattern(term)
        if pattern is None:
            return base
        return base.ilike("query", pattern)

    # ------------------------------------------------------------------
    # One trace
    # ------------------------------------------------------------------

    def get_trace(self, trace_id: str) -> dict[str, Any]:
        """One trace (with ``meta`` and its owner) plus all of its spans."""
        key = _as_uuid(trace_id)
        if key is None:
            raise CustomError(ERROR_CODES["NOT_FOUND"])
        try:
            rows = (
                self.client.table(TRACES_TABLE)
                .select(f"*, {_OWNER}")
                .eq("id", key)
                .limit(1)
                .execute()
                .data
                or []
            )
        except Exception as exc:
            if _is_missing(exc):
                raise CustomError(ERROR_CODES["NOT_FOUND"]) from exc
            raise
        if not rows:
            raise CustomError(ERROR_CODES["NOT_FOUND"])
        return success_response(
            "Trace loaded",
            {
                "trace": self._flatten_owner(rows[0]),
                "spans": self._all_spans(key),
            },
        )

    def _all_spans(self, trace_id: str) -> list[dict[str, Any]]:
        """Every span of a trace in creation order.

        Pages until the exact count is reached (or a page comes back
        empty), so PostgREST's row cap cannot silently cut a long trace.
        Only the first page is counted, for the reason given in ``_page``.
        """
        spans: list[dict[str, Any]] = []
        total: int | None = None
        for _ in range(_MAX_SPAN_PAGES):
            table = self.client.table(SPANS_TABLE)
            first = not spans
            res = (
                (
                    table.select("*", count="exact")
                    if first
                    else table.select("*")
                )
                .eq("trace_id", trace_id)
                .order("seq")
                .range(len(spans), len(spans) + _SPAN_PAGE - 1)
                .execute()
            )
            batch = res.data or []
            spans.extend(batch)
            if first:
                total = res.count
            if not batch or (total is not None and len(spans) >= total):
                return spans
        logger.warning(
            "Trace %s has more than %d spans; the rest were not loaded",
            trace_id,
            len(spans),
        )
        return spans

    def session_traces(self, session_id: str) -> dict[str, Any]:
        """Traces recorded for one session, newest first (summary rows).

        ``available`` tells "this session has no traces" (``True``) from
        "there is no trace storage to look in" (``False``).
        """
        key = _as_uuid(session_id)
        rows: list[dict[str, Any]] = []
        available = True
        if key is not None:
            try:
                rows = (
                    self.client.table(TRACES_TABLE)
                    .select(f"{_SUMMARY_COLUMNS}, {_OWNER}")
                    .eq("session_id", key)
                    .order("created_at", desc=True)
                    .limit(_SESSION_TRACE_LIMIT)
                    .execute()
                    .data
                    or []
                )
            except Exception as exc:
                if not _is_missing(exc):
                    raise
                logger.info("AI trace tables not found (migration 024)")
                available = False
        return success_response(
            "Session traces",
            {
                "traces": [self._flatten_owner(r) for r in rows],
                "available": available,
            },
        )

    # ------------------------------------------------------------------
    # Retention
    # ------------------------------------------------------------------

    def purge_traces(self, admin: str, days: int) -> dict[str, Any]:
        """Delete traces older than ``days`` days (audited)."""
        try:
            res = self.client.rpc("purge_ai_traces", {"p_days": days}).execute()
        except Exception as exc:
            if not _is_missing(exc):
                raise
            # No trace storage yet, so there is nothing to remove.
            logger.info("AI trace tables not found (migration 024)")
            return success_response(
                "Traces unavailable",
                {"removed": 0, "days": days, "available": False},
            )
        data = res.data
        if isinstance(data, list):
            data = data[0] if data else 0
        if isinstance(data, dict):
            data = next(iter(data.values()), 0)
        removed = _count(data)
        self._audit(
            admin,
            "traces.purge",
            resource=TRACES_TABLE,
            detail={"days": days, "removed": removed},
        )
        return success_response(
            "Traces purged", {"removed": removed, "days": days}
        )

    # ------------------------------------------------------------------
    # Prompt catalog
    # ------------------------------------------------------------------

    def prompt_catalog(self, days: int = 7) -> dict[str, Any]:
        """Return the static prompt map with the last ``days`` days of usage."""
        data = catalog.build_catalog()
        usage, versions, available = self._prompt_usage(days)
        for template in data["templates"]:
            template["stats"] = _prompt_stats(usage.get(template["name"], []))
        data["versions"] = versions
        data["stats_days"] = days
        data["stats_available"] = available
        return success_response("Prompt catalog", data)

    def _prompt_usage(
        self, days: int
    ) -> tuple[dict[str, list[dict[str, Any]]], list[dict[str, Any]], bool]:
        """Return ``(usage rows by prompt name, stored versions, available)``.

        The catalog itself needs no database, so any failure here (missing
        migration, outage) only drops the statistics.
        """
        try:
            rows = (
                self.client.rpc("ai_prompt_usage", {"p_days": days})
                .execute()
                .data
                or []
            )
            versions = (
                self.client.table(PROMPT_VERSIONS_TABLE)
                .select(_VERSION_COLUMNS)
                .order("first_seen_at", desc=True)
                .limit(_VERSION_LIMIT)
                .execute()
                .data
                or []
            )
        except Exception as exc:  # noqa: BLE001 — stats are optional here.
            if _is_missing(exc):
                logger.info("AI trace tables not found (migration 024)")
            else:
                logger.warning("Prompt usage unavailable", exc_info=True)
            return {}, [], False
        usage: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            if isinstance(row, dict) and row.get("prompt_name"):
                usage.setdefault(str(row["prompt_name"]), []).append(row)
        return usage, versions, True

    def prompt_version(self, name: str, digest: str) -> dict[str, Any]:
        """One version of a template, with its full text.

        A version is stored the first time a traced turn renders it. The
        deployed template may not have been rendered yet (a fresh deploy, a
        rarely used prompt, tracing off, migration 024 not applied): its
        text is then served from the code, with ``first_seen_at`` and
        ``git_sha`` null because no trace has recorded it.
        """
        rows: list[dict[str, Any]] = []
        try:
            rows = (
                self.client.table(PROMPT_VERSIONS_TABLE)
                .select("*")
                .eq("name", name)
                .eq("hash", digest)
                .limit(1)
                .execute()
                .data
                or []
            )
        except Exception as exc:
            if not _is_missing(exc):
                raise
            logger.info("AI trace tables not found (migration 024)")
        version = rows[0] if rows else catalog.deployed_version(name, digest)
        if version is None:
            raise CustomError(ERROR_CODES["NOT_FOUND"])
        return success_response("Prompt version", version)
