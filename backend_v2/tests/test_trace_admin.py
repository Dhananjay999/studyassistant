"""Admin API for AI traces and the prompt catalog.

Three layers, each against the real code:

* ``TraceRepository`` over a fake Supabase client that records every
  query-builder call and answers with canned rows;
* ``aeva.tracing.catalog``, checked against the source it describes, so the
  hand-written usage registry and flow cannot drift from the code;
* the trace blueprint (``aeva.admin.trace_controller``), registered next to
  the admin one: URL rules, auth, permissions (403, never 401) and
  validation.
"""

import json
import re
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import jwt
import pytest
from flask import Flask, jsonify
from flask_smorest import Api

from aeva import tracing
from aeva.admin import admin_controller, trace_controller
from aeva.admin.schema import admin_schema
from aeva.admin.schema.trace_schema import (
    PromptCatalogQuery,
    PromptCatalogQuerySchema,
    TraceListQuery,
    TraceListQuerySchema,
    TracePurgeSchema,
)
from aeva.admin.trace_repository import TraceRepository
from aeva.common.errors import CustomError
from aeva.containers import build_tool_registry
from aeva.llm import prompts
from aeva.llm.prompts.builder import PromptBuilder, PromptError, PromptTemplate
from aeva.orchestration.assistant_orchestrator import AssistantOrchestrator
from aeva.orchestration.models import AssistantContext
from aeva.tracing import catalog, store

BACKEND = Path(__file__).resolve().parents[1]

TRACE_ID = "11111111-1111-4111-8111-111111111111"
SESSION_ID = "22222222-2222-4222-8222-222222222222"
USER_ID = "33333333-3333-4333-8333-333333333333"

ID_COLUMNS = [
    "id",
    "session_id",
    "user_id",
    "assistant_message_id",
    "user_message_id",
    "run_id",
]


# --------------------------------------------------------------- the fake


class ApiError(Exception):
    """Stand-in for ``postgrest.exceptions.APIError``: ``code``, ``message``."""

    def __init__(self, code, message="boom"):
        super().__init__(message)
        self.code = code
        self.message = message


# What PostgREST 12 answers when the embedded ``owner:profiles(...)`` select
# hits a table that does not exist.
NO_RELATIONSHIP = (
    "Could not find a relationship between 'ai_traces' and 'profiles' in "
    "the schema cache"
)


class FakeQuery:
    """Records the builder calls made on one table / rpc query."""

    def __init__(self, client, kind, name, params=None):
        self.client = client
        self.kind = kind
        self.name = name
        self.params = params
        self.calls = []

    def _record(self, method, *args, **kwargs):
        self.calls.append((method, args, kwargs))
        return self

    def select(self, *args, **kwargs):
        return self._record("select", *args, **kwargs)

    def insert(self, *args, **kwargs):
        return self._record("insert", *args, **kwargs)

    def eq(self, *args, **kwargs):
        return self._record("eq", *args, **kwargs)

    def or_(self, *args, **kwargs):
        return self._record("or_", *args, **kwargs)

    def ilike(self, *args, **kwargs):
        return self._record("ilike", *args, **kwargs)

    def contains(self, *args, **kwargs):
        return self._record("contains", *args, **kwargs)

    def order(self, *args, **kwargs):
        return self._record("order", *args, **kwargs)

    def range(self, *args, **kwargs):
        return self._record("range", *args, **kwargs)

    def limit(self, *args, **kwargs):
        return self._record("limit", *args, **kwargs)

    def execute(self):
        self.client.executed.append(self)
        return self.client.respond(self)

    # -- helpers for assertions
    def args(self, method):
        """Positional args of every call to ``method``, in order."""
        return [a for m, a, _ in self.calls if m == method]

    def one(self, method):
        """The single call to ``method`` as ``(args, kwargs)``."""
        found = [(a, k) for m, a, k in self.calls if m == method]
        assert len(found) == 1, (method, self.calls)
        return found[0]


class FakeClient:
    """A Supabase client whose answers come from ``responder(query)``."""

    def __init__(self, responder=None):
        self.responder = responder or (lambda _q: result([]))
        self.queries = []
        self.executed = []

    def table(self, name):
        query = FakeQuery(self, "table", name)
        self.queries.append(query)
        return query

    def rpc(self, name, params):
        query = FakeQuery(self, "rpc", name, params)
        self.queries.append(query)
        return query

    def respond(self, query):
        return self.responder(query)

    def ran(self, name):
        """Executed queries against one table / rpc."""
        return [q for q in self.executed if q.name == name]


def result(data, count=None):
    return SimpleNamespace(data=data, count=count)


def repo_for(responder=None):
    client = FakeClient(responder)
    return TraceRepository(supabase=SimpleNamespace(client=client)), client


def trace_row(**over):
    row = {
        "id": TRACE_ID,
        "kind": "chat_turn",
        "user_id": USER_ID,
        "session_id": SESSION_ID,
        "status": "completed",
        "query": "what is osmosis?",
        "tools": ["media_llm"],
        "prompt_names": ["plan_turn", "media_llm"],
        "created_at": "2026-09-30T10:00:00+00:00",
        "owner": {"id": USER_ID, "email": "a@b.c", "full_name": "Asha"},
    }
    row.update(over)
    return row


def list_query(**over):
    return TraceListQuery(**over)


# --------------------------------------------------------- trace list


class TestListTraces:
    def test_default_page_selects_summary_columns_newest_first(self):
        repo, client = repo_for(lambda _q: result([trace_row()], count=41))
        data = repo.list_traces(list_query())["data"]

        (query,) = client.executed
        assert (query.kind, query.name) == ("table", "ai_traces")
        (columns,), kwargs = query.one("select")
        assert kwargs == {"count": "exact"}
        assert "owner:profiles(id, email, full_name)" in columns
        selected = [c.strip() for c in columns.split(",")]
        for column in (*ID_COLUMNS, "query", "tools", "prompt_names"):
            assert column in selected
        assert "meta" not in selected
        assert "*" not in columns
        assert query.one("order") == (("created_at",), {"desc": True})
        assert query.one("range") == ((0, 24), {})
        # No filter was applied.
        for method in ("eq", "or_", "ilike", "contains"):
            assert query.args(method) == []

        assert data["total"] == 41
        assert data["page"] == 1
        assert data["page_size"] == 25
        assert data["available"] is True
        (item,) = data["items"]
        assert "owner" not in item
        assert item["owner_id"] == USER_ID
        assert item["owner_email"] == "a@b.c"
        assert item["owner_name"] == "Asha"

    def test_owner_is_flattened_to_nulls_when_the_profile_is_gone(self):
        repo, _ = repo_for(lambda _q: result([trace_row(owner=None)], 1))
        (item,) = repo.list_traces(list_query())["data"]["items"]
        assert item["owner_id"] is None
        assert item["owner_email"] is None
        assert item["owner_name"] is None

    @pytest.mark.parametrize(
        ("page", "size", "expected"),
        [(1, 25, (0, 24)), (3, 10, (20, 29)), (2, 100, (100, 199))],
    )
    def test_pagination_math(self, page, size, expected):
        repo, client = repo_for(lambda _q: result([], count=500))
        data = repo.list_traces(list_query(page=page, page_size=size))["data"]
        assert client.executed[-1].one("range") == (expected, {})
        assert (data["page"], data["page_size"]) == (page, size)
        assert data["total"] == 500

    def test_first_page_is_one_counted_query(self):
        repo, client = repo_for(lambda _q: result([trace_row()], count=41))
        repo.list_traces(list_query(page_size=10))
        (query,) = client.executed
        assert query.one("select")[1] == {"count": "exact"}
        assert query.one("range") == ((0, 9), {})

    def test_later_page_counts_first_then_reads_the_rows_uncounted(self):
        # A counted range past the last row is an error in PostgREST (and a
        # malformed one in 13.0.x), so such a range is never requested.
        def responder(query):
            if query.args("limit"):
                return result([{"id": TRACE_ID}], count=41)
            return result([trace_row()], count=None)

        repo, client = repo_for(responder)
        filters = {"session_id": SESSION_ID, "status": "error", "q": "osmosis"}
        data = repo.list_traces(list_query(page=2, **filters))["data"]
        assert data["total"] == 41
        assert [item["id"] for item in data["items"]] == [TRACE_ID]
        assert data["items"][0]["owner_email"] == "a@b.c"

        count_query, page_query = client.executed
        assert count_query.name == page_query.name == "ai_traces"
        # One narrow row from the top: always in range.
        assert count_query.one("select") == (("id",), {"count": "exact"})
        assert count_query.one("limit") == ((1,), {})
        assert count_query.args("range") == []
        assert count_query.args("order") == []
        # The rows: same filters, no count.
        (columns,), kwargs = page_query.one("select")
        assert kwargs == {}
        assert "owner:profiles(id, email, full_name)" in columns
        assert page_query.one("range") == ((25, 49), {})
        assert page_query.one("order") == (("created_at",), {"desc": True})
        for method in ("eq", "ilike", "or_", "contains"):
            assert count_query.args(method) == page_query.args(method)
        assert page_query.args("eq") == [
            ("session_id", SESSION_ID),
            ("status", "error"),
        ]

    def test_exact_filters(self):
        repo, client = repo_for()
        repo.list_traces(
            list_query(
                user_id=USER_ID.upper(),
                session_id=SESSION_ID,
                status="error",
                plan_source="planner+media_guard",
            )
        )
        assert client.executed[0].args("eq") == [
            # Ids are sent in canonical form.
            ("user_id", USER_ID),
            ("session_id", SESSION_ID),
            ("status", "error"),
            ("plan_source", "planner+media_guard"),
        ]

    def test_tool_and_prompt_use_array_containment(self):
        repo, client = repo_for()
        repo.list_traces(list_query(tool="media_llm", prompt="plan_turn"))
        assert client.executed[0].args("contains") == [
            ("tools", ["media_llm"]),
            ("prompt_names", ["plan_turn"]),
        ]

    @pytest.mark.parametrize(
        "needle", [TRACE_ID, f"  {TRACE_ID.upper()}  ", TRACE_ID.replace("-", "")]
    )
    def test_uuid_search_matches_every_id_column(self, needle):
        repo, client = repo_for()
        repo.list_traces(list_query(q=needle))
        (query,) = client.ran("ai_traces")
        ((clause,),) = query.args("or_")
        assert clause.split(",") == [f"{c}.eq.{TRACE_ID}" for c in ID_COLUMNS]
        assert query.args("ilike") == []

    def test_a_message_id_also_finds_the_trace_stamped_on_the_message(self):
        """A clarification question's id is not on the trace row itself."""
        stamped = "22222222-2222-4222-8222-222222222222"

        def responder(query):
            if query.name == "messages":
                return result([{"metadata": {"trace_id": stamped}}])
            return result([], count=0)

        repo, client = repo_for(responder)
        repo.list_traces(list_query(q=TRACE_ID))
        (lookup,) = client.ran("messages")
        assert lookup.args("eq") == [("id", TRACE_ID)]
        (query,) = client.ran("ai_traces")
        ((clause,),) = query.args("or_")
        assert clause.split(",") == [
            *[f"{c}.eq.{TRACE_ID}" for c in ID_COLUMNS],
            f"id.eq.{stamped}",
        ]

    @pytest.mark.parametrize(
        "metadata", [None, {}, {"trace_id": "not-a-uuid"}, "text"]
    )
    def test_message_without_a_usable_stamp_adds_nothing(self, metadata):
        def responder(query):
            if query.name == "messages":
                return result([{"metadata": metadata}])
            return result([], count=0)

        repo, client = repo_for(responder)
        repo.list_traces(list_query(q=TRACE_ID))
        (query,) = client.ran("ai_traces")
        ((clause,),) = query.args("or_")
        assert clause.split(",") == [f"{c}.eq.{TRACE_ID}" for c in ID_COLUMNS]

    def test_failed_message_lookup_does_not_break_the_search(self):
        def responder(query):
            if query.name == "messages":
                raise RuntimeError("messages unavailable")
            return result([], count=0)

        repo, _client = repo_for(responder)
        data = repo.list_traces(list_query(q=TRACE_ID))["data"]
        assert data["available"] is True
        assert data["items"] == []

    def test_text_search_is_a_sanitised_ilike_on_the_message(self):
        repo, client = repo_for()
        repo.list_traces(list_query(q="  100% osmosis, (again)  "))
        query = client.executed[0]
        assert query.args("ilike") == [
            ("query", "%100\\% osmosis, (again)%")
        ]
        assert query.args("or_") == []

    @pytest.mark.parametrize(
        ("term", "pattern"),
        [
            # ``_`` and ``%`` match themselves once escaped.
            ("snake_case", "%snake\\_case%"),
            ("50% off", "%50\\% off%"),
            ("%", "%\\%%"),
            # The escape character itself is escaped first.
            ("back\\slash", "%back\\\\slash%"),
            ("trailing\\", "%trailing\\\\%"),
            # ``*`` is PostgREST's alias for ``%`` and cannot be escaped:
            # it is narrowed to "any one character".
            ("a*b", "%a_b%"),
            ("50%_*", "%50\\%\\__%"),
        ],
    )
    def test_text_search_cannot_add_wildcards(self, term, pattern):
        repo, client = repo_for()
        repo.list_traces(list_query(q=term))
        assert client.executed[0].args("ilike") == [("query", pattern)]

    @pytest.mark.parametrize("term", ["", "   ", "\t\n"])
    def test_empty_search_term_adds_no_filter(self, term):
        repo, client = repo_for()
        repo.list_traces(list_query(q=term))
        assert client.executed[0].args("ilike") == []
        assert client.executed[0].args("or_") == []

    @pytest.mark.parametrize(
        "filters",
        [
            {"user_id": "not-a-uuid"},
            {"session_id": "123"},
            {"session_id": f"{SESSION_ID},id.neq.x"},
            {"tool": "general,web_search"},
            {"tool": "x}"},
            {"prompt": 'plan"turn'},
        ],
    )
    def test_filter_that_cannot_match_returns_an_empty_page(self, filters):
        repo, client = repo_for(lambda _q: result([trace_row()], 1))
        data = repo.list_traces(list_query(page=2, **filters))["data"]
        # Answered without a round trip: nothing malformed reaches PostgREST.
        assert client.executed == []
        assert data == {
            "items": [],
            "total": 0,
            "page": 2,
            "page_size": 25,
            "available": True,
        }

    @pytest.mark.parametrize("code", ["PGRST205", "42P01"])
    def test_missing_tables_report_unavailable(self, code):
        def responder(_q):
            raise ApiError(code, "Could not find the table 'ai_traces'")

        repo, _ = repo_for(responder)
        data = repo.list_traces(list_query())["data"]
        assert data["available"] is False
        assert data["items"] == []
        assert data["total"] == 0

    def test_missing_table_detected_from_a_codeless_error(self):
        def responder(_q):
            raise RuntimeError("{'code': 'PGRST205', 'message': '...'}")

        repo, _ = repo_for(responder)
        assert repo.list_traces(list_query())["data"]["available"] is False

    @pytest.mark.parametrize("page", [3, 9, 99])
    def test_page_past_the_end_is_empty_with_the_real_total(self, page):
        repo, client = repo_for(lambda _q: result([{"id": TRACE_ID}], count=34))
        data = repo.list_traces(list_query(page=page, status="error"))["data"]
        assert data == {
            "items": [],
            "total": 34,
            "page": page,
            "page_size": 25,
            "available": True,
        }
        # Answered from the count alone: no range was requested at all.
        (count_query,) = client.executed
        assert count_query.args("range") == []
        assert count_query.args("eq") == [("status", "error")]

    def test_last_page_is_still_read(self):
        def responder(query):
            if query.args("limit"):
                return result([{"id": TRACE_ID}], count=26)
            return result([trace_row()])

        repo, client = repo_for(responder)
        data = repo.list_traces(list_query(page=2))["data"]
        assert (len(data["items"]), data["total"]) == (1, 26)
        assert client.executed[1].one("range") == ((25, 49), {})

    def test_page_past_the_end_of_an_empty_list(self):
        repo, client = repo_for(lambda _q: result([], count=None))
        data = repo.list_traces(list_query(page=2))["data"]
        assert (data["items"], data["total"]) == ([], 0)
        assert len(client.executed) == 1

    @pytest.mark.parametrize(
        "code",
        [
            # PostgREST 12 / 14.
            "PGRST103",
            # PostgREST 13.0.x: a 416 whose body postgrest-py cannot parse;
            # it reports the HTTP status (an int) as the code.
            416,
            "416",
        ],
    )
    def test_an_out_of_range_answer_is_an_empty_page_anyway(self, code):
        # Not expected of an uncounted range; handled all the same (the
        # rows can also vanish between the count and the read).
        def responder(query):
            if query.args("range"):
                raise ApiError(code, "Requested range not satisfiable")
            return result([{"id": TRACE_ID}], count=34)

        repo, client = repo_for(responder)
        data = repo.list_traces(list_query(page=2))["data"]
        assert (data["items"], data["total"]) == ([], 34)
        assert data["available"] is True
        # No further request followed the refused one.
        assert len(client.executed) == 2

    def test_a_failing_count_is_not_swallowed(self):
        def responder(_q):
            raise ApiError("57014", "statement timeout")

        repo, client = repo_for(responder)
        with pytest.raises(ApiError) as err:
            repo.list_traces(list_query(page=9))
        assert err.value.code == "57014"
        assert len(client.executed) == 1

    @pytest.mark.parametrize(
        "exc",
        [
            # Only a real ``.code`` counts: "416" and "PGRST103" inside an
            # error text (a row id, a port, a quoted message) mean nothing.
            RuntimeError("upstream 416 PGRST103"),
            ApiError("57014", "canceling statement 416 PGRST103"),
            ApiError("", "416"),
        ],
    )
    def test_out_of_range_is_matched_on_the_code_only(self, exc):
        def responder(query):
            if query.args("range"):
                raise exc
            return result([{"id": TRACE_ID}], count=34)

        repo, _ = repo_for(responder)
        with pytest.raises(type(exc)):
            repo.list_traces(list_query(page=2))

    def test_missing_tables_on_a_later_page_report_unavailable(self):
        def responder(_q):
            raise ApiError("PGRST205")

        repo, client = repo_for(responder)
        data = repo.list_traces(list_query(page=4))["data"]
        assert data["available"] is False
        assert (data["items"], data["total"], data["page"]) == ([], 0, 4)
        assert len(client.executed) == 1

    def test_missing_table_behind_the_owner_embed_is_unavailable(self):
        # PostgREST 12.x resolves the embed first.
        def responder(_q):
            raise ApiError("PGRST200", NO_RELATIONSHIP)

        repo, _ = repo_for(responder)
        data = repo.list_traces(list_query())["data"]
        assert data["available"] is False
        assert data["items"] == []

    def test_an_unrelated_missing_relationship_is_a_real_error(self):
        def responder(_q):
            raise ApiError(
                "PGRST200",
                "Could not find a relationship between 'quizzes' and "
                "'profiles' in the schema cache",
            )

        repo, _ = repo_for(responder)
        with pytest.raises(ApiError):
            repo.list_traces(list_query())

    def test_a_missing_code_inside_a_coded_error_text_is_not_trusted(self):
        def responder(_q):
            raise ApiError("57014", "while reading 42P01 PGRST205")

        repo, _ = repo_for(responder)
        with pytest.raises(ApiError):
            repo.list_traces(list_query())

    def test_other_failures_are_not_swallowed(self):
        def responder(_q):
            raise ApiError("57014", "statement timeout")

        repo, _ = repo_for(responder)
        with pytest.raises(ApiError):
            repo.list_traces(list_query())


# ---------------------------------------------------------- one trace


def span_rows(total):
    return [
        {"id": str(uuid.UUID(int=i + 1)), "trace_id": TRACE_ID, "seq": i}
        for i in range(total)
    ]


def detail_responder(spans, *, trace=None, row_cap=None, with_count=True):
    """Serve one trace row and page through ``spans`` like PostgREST."""
    found = [trace_row(meta={"is_debug_user": True})] if trace is None else trace

    def responder(query):
        if query.name == "ai_traces":
            return result(list(found))
        (start, end), _ = query.one("range")
        size = end - start + 1
        if row_cap is not None:
            size = min(size, row_cap)
        return result(
            spans[start : start + size],
            count=len(spans) if with_count else None,
        )

    return responder


class TestGetTrace:
    def test_returns_full_trace_with_owner_and_spans(self):
        spans = span_rows(3)
        repo, client = repo_for(detail_responder(spans))
        data = repo.get_trace(TRACE_ID.upper())["data"]

        trace_query = client.ran("ai_traces")[0]
        ((columns,), _) = trace_query.one("select")
        assert columns.startswith("*")
        assert "owner:profiles(id, email, full_name)" in columns
        assert trace_query.args("eq") == [("id", TRACE_ID)]

        assert data["trace"]["meta"] == {"is_debug_user": True}
        assert data["trace"]["owner_email"] == "a@b.c"
        assert "owner" not in data["trace"]
        assert data["spans"] == spans

        (span_query,) = client.ran("ai_trace_spans")
        assert span_query.args("eq") == [("trace_id", TRACE_ID)]
        assert span_query.one("order") == (("seq",), {})
        assert span_query.one("select") == (("*",), {"count": "exact"})

    def test_all_spans_are_fetched_across_pages(self):
        spans = span_rows(450)
        repo, client = repo_for(detail_responder(spans))
        data = repo.get_trace(TRACE_ID)["data"]
        assert [s["seq"] for s in data["spans"]] == list(range(450))
        span_queries = client.ran("ai_trace_spans")
        ranges = [q.one("range")[0] for q in span_queries]
        assert ranges == [(0, 199), (200, 399), (400, 599)]
        # Only the first page (always in range) is counted.
        assert [q.one("select")[1] for q in span_queries] == [
            {"count": "exact"},
            {},
            {},
        ]

    def test_a_server_row_cap_does_not_truncate_the_trace(self):
        # PostgREST returns fewer rows than asked for (max-rows): a short
        # page must not be mistaken for the last one.
        spans = span_rows(450)
        repo, client = repo_for(detail_responder(spans, row_cap=100))
        data = repo.get_trace(TRACE_ID)["data"]
        assert len(data["spans"]) == 450
        assert len(client.ran("ai_trace_spans")) == 5

    def test_pages_until_empty_when_no_count_is_returned(self):
        spans = span_rows(250)
        repo, client = repo_for(detail_responder(spans, with_count=False))
        data = repo.get_trace(TRACE_ID)["data"]
        assert len(data["spans"]) == 250
        # 200 + 50 + one empty page that ends the loop.
        assert len(client.ran("ai_trace_spans")) == 3

    def test_trace_without_spans(self):
        repo, client = repo_for(detail_responder([]))
        assert repo.get_trace(TRACE_ID)["data"]["spans"] == []
        assert len(client.ran("ai_trace_spans")) == 1

    @pytest.mark.parametrize(
        "bad", ["nope", "123", "", f"{TRACE_ID}x", "purge", "id.eq.1"]
    )
    def test_non_uuid_id_is_not_found_without_a_query(self, bad):
        repo, client = repo_for(detail_responder(span_rows(1)))
        with pytest.raises(CustomError) as err:
            repo.get_trace(bad)
        assert err.value.code == "NOT_FOUND"
        assert err.value.status == 404
        assert client.executed == []

    def test_unknown_trace_is_not_found(self):
        repo, client = repo_for(detail_responder([], trace=[]))
        with pytest.raises(CustomError) as err:
            repo.get_trace(TRACE_ID)
        assert err.value.code == "NOT_FOUND"
        assert client.ran("ai_trace_spans") == []

    @pytest.mark.parametrize(
        ("code", "message"),
        [("PGRST205", "boom"), ("42P01", "boom"), ("PGRST200", NO_RELATIONSHIP)],
    )
    def test_missing_tables_are_not_found(self, code, message):
        def responder(_q):
            raise ApiError(code, message)

        repo, _ = repo_for(responder)
        with pytest.raises(CustomError) as err:
            repo.get_trace(TRACE_ID)
        assert err.value.code == "NOT_FOUND"

    def test_other_failures_are_not_swallowed(self):
        def responder(_q):
            raise ApiError("57014")

        repo, _ = repo_for(responder)
        with pytest.raises(ApiError):
            repo.get_trace(TRACE_ID)


class TestSessionTraces:
    def test_summary_rows_newest_first_capped_at_200(self):
        rows = [trace_row(), trace_row(id=str(uuid.UUID(int=7)))]
        repo, client = repo_for(lambda _q: result(rows))
        data = repo.session_traces(SESSION_ID)["data"]

        (query,) = client.executed
        assert query.name == "ai_traces"
        ((columns,), _) = query.one("select")
        assert "meta" not in [c.strip() for c in columns.split(",")]
        assert query.args("eq") == [("session_id", SESSION_ID)]
        assert query.one("order") == (("created_at",), {"desc": True})
        assert query.one("limit") == ((200,), {})
        assert [t["id"] for t in data["traces"]] == [r["id"] for r in rows]
        assert data["traces"][0]["owner_name"] == "Asha"
        assert data["available"] is True
        assert set(data) == {"traces", "available"}

    def test_a_session_without_traces_is_empty_but_available(self):
        repo, _ = repo_for(lambda _q: result([]))
        assert repo.session_traces(SESSION_ID)["data"] == {
            "traces": [],
            "available": True,
        }

    def test_malformed_session_id_is_an_empty_list(self):
        repo, client = repo_for(lambda _q: result([trace_row()]))
        assert repo.session_traces("abc")["data"] == {
            "traces": [],
            "available": True,
        }
        assert client.executed == []

    @pytest.mark.parametrize(
        ("code", "message"),
        [("42P01", "boom"), ("PGRST205", "boom"), ("PGRST200", NO_RELATIONSHIP)],
    )
    def test_missing_tables_are_an_empty_unavailable_list(self, code, message):
        def responder(_q):
            raise ApiError(code, message)

        repo, _ = repo_for(responder)
        assert repo.session_traces(SESSION_ID)["data"] == {
            "traces": [],
            "available": False,
        }

    def test_other_failures_are_not_swallowed(self):
        def responder(_q):
            raise ApiError("57014")

        repo, _ = repo_for(responder)
        with pytest.raises(ApiError):
            repo.session_traces(SESSION_ID)


# ------------------------------------------------------------- purge


class TestPurge:
    @pytest.mark.parametrize(
        "payload", [12, "12", [12], [{"purge_ai_traces": 12}]]
    )
    def test_calls_the_rpc_and_audits(self, payload):
        def responder(query):
            return result(payload if query.kind == "rpc" else [])

        repo, client = repo_for(responder)
        data = repo.purge_traces("root", 30)["data"]
        assert data == {"removed": 12, "days": 30}

        (rpc,) = [q for q in client.executed if q.kind == "rpc"]
        assert (rpc.name, rpc.params) == ("purge_ai_traces", {"p_days": 30})

        (audit,) = client.ran("admin_audit_log")
        ((entry,), _) = audit.one("insert")
        assert entry["admin_username"] == "root"
        assert entry["action"] == "traces.purge"
        assert entry["detail"] == {"days": 30, "removed": 12}
        # The purge ran before it was recorded.
        assert client.executed.index(rpc) < client.executed.index(audit)

    def test_audit_failure_does_not_fail_the_purge(self):
        def responder(query):
            if query.name == "admin_audit_log":
                raise ApiError("42P01")
            return result(3)

        repo, _ = repo_for(responder)
        assert repo.purge_traces("root", 7)["data"]["removed"] == 3

    def test_missing_function_removes_nothing_and_is_not_audited(self):
        def responder(query):
            if query.kind == "rpc":
                raise ApiError("PGRST202", "Could not find the function")
            return result([])

        repo, client = repo_for(responder)
        data = repo.purge_traces("root", 30)["data"]
        assert data == {"removed": 0, "days": 30, "available": False}
        assert client.ran("admin_audit_log") == []

    def test_a_failed_purge_raises_and_is_not_audited(self):
        def responder(query):
            if query.kind == "rpc":
                raise ApiError("57014", "statement timeout")
            return result([])

        repo, client = repo_for(responder)
        with pytest.raises(ApiError):
            repo.purge_traces("root", 30)
        assert client.ran("admin_audit_log") == []


# ------------------------------------------------ prompt catalog (API)


USAGE_ROWS = [
    {
        "prompt_name": "plan_turn",
        "prompt_hash": "old000000000",
        "uses": 4,
        "traces": 4,
        "first_used": "2026-09-20T08:00:00+00:00",
        "last_used": "2026-09-24T09:30:00.5+00:00",
    },
    {
        "prompt_name": "plan_turn",
        "prompt_hash": "new000000000",
        "uses": 10,
        "traces": 9,
        "first_used": "2026-09-25T08:00:00+00:00",
        "last_used": "2026-09-30T09:30:00+00:00",
    },
    {
        "prompt_name": "deleted_template",
        "prompt_hash": "gone00000000",
        "uses": 1,
        "traces": 1,
        "first_used": None,
        "last_used": None,
    },
]
VERSION_ROWS = [
    {
        "name": "plan_turn",
        "hash": "new000000000",
        "git_sha": "abc123",
        "first_seen_at": "2026-09-25T08:00:00+00:00",
    }
]


DEPLOYED_PLAN_HASH = tracing.template_hash(prompts.PLAN_TURN_TEMPLATE)
GENERAL_HASH = tracing.template_hash(prompts.GENERAL_ANSWER_TEMPLATE)


def stats_responder(query):
    if query.kind == "rpc":
        return result(list(USAGE_ROWS))
    return result(list(VERSION_ROWS))


class TestPromptCatalogEndpoint:
    def test_static_catalog_is_merged_with_usage(self):
        repo, client = repo_for(stats_responder)
        data = repo.prompt_catalog(14)["data"]

        (rpc,) = [q for q in client.executed if q.kind == "rpc"]
        assert (rpc.name, rpc.params) == ("ai_prompt_usage", {"p_days": 14})
        (versions,) = client.ran("ai_prompt_versions")
        # Names and hashes only: the template text is fetched on demand.
        assert versions.one("select") == (
            ("name, hash, git_sha, first_seen_at",),
            {},
        )

        assert data["stats_days"] == 14
        assert data["stats_available"] is True
        assert data["versions"] == VERSION_ROWS
        assert set(data) == {
            "templates",
            "blocks",
            "flow",
            "versions",
            "stats_days",
            "stats_available",
        }

        by_name = {t["name"]: t for t in data["templates"]}
        assert by_name["plan_turn"]["stats"] == {
            "uses": 14,
            "traces": 13,
            "last_used": "2026-09-30T09:30:00+00:00",
            "versions": [
                {
                    "hash": "new000000000",
                    "uses": 10,
                    "traces": 9,
                    "first_used": "2026-09-25T08:00:00+00:00",
                    "last_used": "2026-09-30T09:30:00+00:00",
                },
                {
                    "hash": "old000000000",
                    "uses": 4,
                    "traces": 4,
                    "first_used": "2026-09-20T08:00:00+00:00",
                    "last_used": "2026-09-24T09:30:00.5+00:00",
                },
            ],
        }
        # A template nobody used still has a complete, zeroed stats block.
        assert by_name["rag_rerank"]["stats"] == {
            "uses": 0,
            "traces": 0,
            "last_used": None,
            "versions": [],
        }
        assert "deleted_template" not in by_name

    def test_without_the_trace_tables_stats_are_zeroed(self):
        def responder(_q):
            raise ApiError("PGRST202", "Could not find the function")

        repo, _ = repo_for(responder)
        data = repo.prompt_catalog()["data"]
        assert data["stats_available"] is False
        assert data["stats_days"] == 7
        assert data["versions"] == []
        assert data["templates"]
        assert data["blocks"]
        assert data["flow"]["stages"]
        for template in data["templates"]:
            assert template["stats"] == {
                "uses": 0,
                "traces": 0,
                "last_used": None,
                "versions": [],
            }

    def test_any_stats_failure_still_serves_the_static_map(self):
        def responder(query):
            if query.kind == "rpc":
                return result(list(USAGE_ROWS))
            raise ConnectionError("supabase is down")

        repo, _ = repo_for(responder)
        data = repo.prompt_catalog()["data"]
        assert data["stats_available"] is False
        assert data["templates"][0]["stats"]["uses"] == 0

    def test_response_is_json_serialisable(self):
        repo, _ = repo_for(stats_responder)
        assert json.loads(json.dumps(repo.prompt_catalog()))["data"]["flow"]

    def test_prompt_version_returns_the_stored_text(self):
        row = {
            **VERSION_ROWS[0],
            "system_template": "You route.",
            "user_template": "{USER_MESSAGE}",
            "defaults": {},
        }
        repo, client = repo_for(lambda _q: result([row]))
        assert repo.prompt_version("plan_turn", "new000000000")["data"] == row
        (query,) = client.executed
        assert query.name == "ai_prompt_versions"
        assert query.one("select") == (("*",), {})
        assert query.args("eq") == [
            ("name", "plan_turn"),
            ("hash", "new000000000"),
        ]

    def test_unknown_prompt_version_is_not_found(self):
        repo, _ = repo_for(lambda _q: result([]))
        with pytest.raises(CustomError) as err:
            repo.prompt_version("plan_turn", "nope")
        assert err.value.code == "NOT_FOUND"
        with pytest.raises(CustomError) as err:
            repo.prompt_version("no_such_template", DEPLOYED_PLAN_HASH)
        assert err.value.code == "NOT_FOUND"

    def test_prompt_version_without_the_table_is_not_found(self):
        def responder(_q):
            raise ApiError("PGRST205")

        repo, _ = repo_for(responder)
        with pytest.raises(CustomError) as err:
            repo.prompt_version("plan_turn", "new000000000")
        assert err.value.code == "NOT_FOUND"

    @pytest.mark.parametrize("stored", ["no row yet", "no table yet"])
    def test_deployed_version_is_served_before_any_trace_stored_it(
        self, stored
    ):
        def responder(_q):
            if stored == "no table yet":
                raise ApiError("PGRST205")
            return result([])

        repo, client = repo_for(responder)
        data = repo.prompt_version("plan_turn", DEPLOYED_PLAN_HASH)["data"]
        template = prompts.PLAN_TURN_TEMPLATE
        assert data == {
            "name": "plan_turn",
            "hash": DEPLOYED_PLAN_HASH,
            "system_template": template.system,
            "user_template": template.user,
            "defaults": dict(template.defaults),
            "git_sha": None,
            "first_seen_at": None,
        }
        # The stored row was looked for first.
        assert client.executed[0].args("eq") == [
            ("name", "plan_turn"),
            ("hash", DEPLOYED_PLAN_HASH),
        ]

    def test_a_stored_row_wins_over_the_deployed_text(self):
        row = {
            "name": "plan_turn",
            "hash": DEPLOYED_PLAN_HASH,
            "system_template": "as stored",
            "user_template": "",
            "defaults": {},
            "git_sha": "abc123",
            "first_seen_at": "2026-09-25T08:00:00+00:00",
        }
        repo, _ = repo_for(lambda _q: result([row]))
        data = repo.prompt_version("plan_turn", DEPLOYED_PLAN_HASH)["data"]
        assert data == row

    def test_a_failed_version_read_is_not_swallowed(self):
        def responder(_q):
            raise ApiError("57014")

        repo, _ = repo_for(responder)
        with pytest.raises(ApiError):
            repo.prompt_version("plan_turn", DEPLOYED_PLAN_HASH)


# ------------------------------------------- the static catalog itself


def exported_templates():
    """Every PromptTemplate the prompts package exports, by constant."""
    return {
        constant: value
        for constant, value in vars(prompts).items()
        if isinstance(value, PromptTemplate)
    }


def source_lines(shown):
    """Split a catalog ``backend_v2/path:line`` into (lines, index)."""
    path, line = shown.rsplit(":", 1)
    assert path.startswith("backend_v2/")
    file = BACKEND / path.removeprefix("backend_v2/")
    assert file.is_file(), shown
    return file.read_text(encoding="utf-8").splitlines(), int(line) - 1


def build_call_re(constant):
    return re.compile(
        r"PromptBuilder\.build\(\s*(?:prompts\.)?" + constant + r"\b"
    )


@pytest.fixture(scope="module")
def built():
    return catalog.build_catalog()


@pytest.fixture(scope="module")
def tool_names():
    registry = build_tool_registry(
        *(MagicMock() for _ in range(7)), supabase=MagicMock()
    )
    return {definition.name for definition in registry.list_definitions()}


class TestCatalogTemplates:
    def test_templates_are_discovered_not_listed(self, built):
        exported = exported_templates()
        assert {t["name"] for t in built["templates"]} == {
            t.name for t in exported.values()
        }
        assert {t["constant"] for t in built["templates"]} == set(exported)
        assert len(built["templates"]) == len(exported)

    def test_a_new_template_shows_up_without_editing_the_catalog(
        self, monkeypatch
    ):
        extra = PromptTemplate(
            name="brand_new", system="s", user="{QUESTION}{NOTE}",
            optional=("NOTE",),
        )
        monkeypatch.setattr(
            prompts, "BRAND_NEW_TEMPLATE", extra, raising=False
        )
        found = catalog.discover_templates()
        assert found["brand_new"] == ("BRAND_NEW_TEMPLATE", extra)
        # Registered templates keep pipeline order; the stranger goes last.
        assert list(found)[-1] == "brand_new"
        assert next(iter(found)) == "plan_turn"
        entry = catalog._template_dict("BRAND_NEW_TEMPLATE", extra)
        assert entry["usage"]["stage"] == catalog.STAGE_UNREGISTERED
        assert entry["usage"]["live"] is False
        assert entry["placeholders"]["required"] == ["QUESTION"]

    def test_every_template_has_a_usage_entry_and_vice_versa(self):
        names = {t.name for t in exported_templates().values()}
        assert set(catalog.PROMPT_USAGE) == names

    def test_template_fields_match_the_template(self, built):
        by_constant = exported_templates()
        for entry in built["templates"]:
            template = by_constant[entry["constant"]]
            assert entry["hash"] == tracing.template_hash(template)
            assert entry["system"] == template.system
            assert entry["user"] == template.user
            assert entry["defaults"] == dict(template.defaults)
            assert entry["uses_history"] is template.uses_history
            assert entry["uses_attachments"] is template.uses_attachments
            assert entry["placeholders"]["optional"] == list(
                template.optional
            )
            assert entry["placeholders"]["markers"] == list(template.markers)
            assert entry["placeholders"]["blocks"] == list(template.defaults)
            assert set(entry["usage"]) == {
                "stage",
                "tool",
                "call_site",
                "llm_method",
                "config_key",
                "live",
                "description",
                "upstream",
                "downstream",
            }
            assert entry["usage"]["description"]

    def test_template_source_points_at_its_declaration(self, built):
        for entry in built["templates"]:
            lines, index = source_lines(entry["source"])
            assert lines[index].startswith(f"{entry['constant']} = ")

    def test_required_placeholders_are_exactly_what_build_needs(self, built):
        by_constant = exported_templates()
        for entry in built["templates"]:
            template = by_constant[entry["constant"]]
            required = entry["placeholders"]["required"]
            assert len(required) == len(set(required))
            values = dict.fromkeys(required, "x")
            # Sufficient: the template renders with these alone...
            PromptBuilder.build(template, **values)
            # ...and necessary: dropping any one of them fails the build.
            for name in required:
                rest = {k: v for k, v in values.items() if k != name}
                with pytest.raises(PromptError):
                    PromptBuilder.build(template, **rest)

    def test_placeholders_inside_default_blocks_are_included(self, built):
        by_name = {t["name"]: t for t in built["templates"]}
        analysis = by_name["quiz_analysis"]
        # {QUIZ_DATA} appears only inside the shared QUIZ_RESULTS block.
        assert "{QUIZ_DATA}" not in analysis["system"] + analysis["user"]
        assert "{QUIZ_DATA}" in analysis["defaults"]["QUIZ_RESULTS"]
        assert analysis["placeholders"]["required"] == [
            "QUIZ_DATA",
            "STUDENT_ANSWERS",
            "EVALUATION",
        ]
        plan = by_name["plan_turn"]["placeholders"]
        assert plan["optional"] == ["CLARIFICATION_HINT"]
        assert plan["markers"] == ["CONVERSATION_CONTEXT"]
        assert "CONVERSATION_CONTEXT" not in plan["required"]

    def test_build_catalog_returns_an_independent_copy(self):
        first = catalog.build_catalog()
        first["templates"][0]["stats"] = {"uses": 99}
        first["flow"]["stages"].clear()
        second = catalog.build_catalog()
        assert "stats" not in second["templates"][0]
        assert second["flow"]["stages"]


class TestCatalogBlocks:
    def test_every_default_block_is_listed_once_with_its_users(self, built):
        expected: dict[tuple[str, str], list[str]] = {}
        for entry in built["templates"]:
            for name, text in entry["defaults"].items():
                expected.setdefault((name, text), []).append(entry["name"])
        listed = {(b["name"], b["text"]): b for b in built["blocks"]}
        assert len(listed) == len(built["blocks"])
        assert set(listed) == set(expected)
        for key, block in listed.items():
            assert block["used_by"] == expected[key]
            assert block["chars"] == len(block["text"])

    def test_blast_radius_of_the_shared_blocks(self, built):
        users = {b["name"]: set(b["used_by"]) for b in built["blocks"]}
        assert users["TEACHING"] == {"general_answer", "web_search", "media_llm"}
        assert users["ANSWER_META"] == {
            "general_answer",
            "web_search",
            "media_llm",
            "product_info",
        }
        assert {"quiz_generation", "flashcard_generation"} <= users[
            "SYSTEM_PROMPT"
        ]
        # The planner and retrieval prompts embed no shared block.
        everyone = set().union(*users.values())
        assert everyone.isdisjoint(
            {"plan_turn", "rag_query_rewrite", "rag_rerank"}
        )

    def test_block_names_are_unique_keys(self, built):
        # The Admin UI indexes blocks by name.
        names = [b["name"] for b in built["blocks"]]
        assert len(names) == len(set(names))
        assert names[0] == "SYSTEM_PROMPT"  # widest blast radius first

    def test_same_placeholder_with_different_text_is_disambiguated(self):
        def template(name, text):
            return PromptTemplate(
                name=name, system="{RULES}", user="", defaults={"RULES": text}
            )

        blocks = catalog._blocks(
            [template("a", "one"), template("b", "one"), template("c", "two")]
        )
        assert [(b["name"], b["text"], b["used_by"]) for b in blocks] == [
            ("RULES", "one", ["a", "b"]),
            ("RULES#2", "two", ["c"]),
        ]
        # Text written only in a test has no definition to point at.
        assert {b["source"] for b in blocks} == {None}

    def test_block_source_is_where_the_text_is_written(self, built):
        for block in built["blocks"]:
            assert block["source"], block["name"]
            lines, index = source_lines(block["source"])
            # A real definition (NAME = "..."), not an alias of another name.
            assert re.match(r'[A-Z_]+ = f?["(]', lines[index]), block
        sources = {b["name"]: b["source"] for b in built["blocks"]}
        assert "/prompts/system.py:" in sources["SYSTEM_PROMPT"]
        assert "/prompts/teaching.py:" in sources["TEACHING"]
        assert "/prompts/response_meta.py:" in sources["ANSWER_META"]


class TestCatalogUsage:
    def test_stage_and_tool_refer_to_things_that_exist(
        self, built, tool_names
    ):
        stages = {s["id"] for s in built["flow"]["stages"]}
        for entry in built["templates"]:
            usage = entry["usage"]
            assert usage["stage"] in stages, entry["name"]
            assert usage["tool"] is None or usage["tool"] in tool_names

    def test_call_site_is_a_real_build_call_for_that_template(self, built):
        for entry in built["templates"]:
            usage = catalog.PROMPT_USAGE[entry["name"]]
            shown = entry["usage"]["call_site"]
            if usage.site is None:
                assert shown is None
                continue
            path, function = usage.site
            file = BACKEND / path
            assert file.is_file(), path
            source = file.read_text(encoding="utf-8")
            pattern = build_call_re(entry["constant"])
            assert pattern.search(source), (entry["name"], path)

            # The resolved line is that call, inside the named function.
            assert shown.startswith(f"backend_v2/{path}:"), shown
            lines, index = source_lines(shown)
            assert "PromptBuilder.build(" in lines[index]
            assert pattern.search("\n".join(lines[index : index + 3]))
            enclosing = next(
                line
                for line in reversed(lines[:index])
                if re.match(r"\s*(async )?def ", line)
            )
            assert re.search(rf"def {function}\(", enclosing), shown

    def test_live_flag_matches_the_code(self, built):
        sources = [
            file.read_text(encoding="utf-8")
            for file in (BACKEND / "aeva").rglob("*.py")
        ]
        for entry in built["templates"]:
            pattern = build_call_re(entry["constant"])
            rendered = any(pattern.search(source) for source in sources)
            assert entry["usage"]["live"] is rendered, entry["name"]
            assert (entry["usage"]["call_site"] is not None) is rendered

    def test_llm_method_and_config_key_appear_at_the_call_site(self, built):
        for entry in built["templates"]:
            usage = catalog.PROMPT_USAGE[entry["name"]]
            if usage.site is None:
                assert usage.llm_method is None
                assert usage.config_key is None
                continue
            source = (BACKEND / usage.site[0]).read_text(encoding="utf-8")
            assert f".{usage.llm_method}(" in source, entry["name"]
            assert f'"{usage.config_key}"' in source, entry["name"]

    def test_upstream_and_downstream_name_real_flow_nodes(self, built):
        labels = {
            node["label"]
            for stage in built["flow"]["stages"]
            for node in stage["nodes"]
        }
        for entry in built["templates"]:
            usage = entry["usage"]
            steps = usage["upstream"] + usage["downstream"]
            assert len(steps) == len(set(steps)), entry["name"]
            for step in steps:
                assert step in labels, (entry["name"], step)
            if usage["live"] and usage["stage"] != "outside_chat":
                assert usage["upstream"], entry["name"]
                assert usage["downstream"], entry["name"]

    def test_before_and_after_tags_are_unambiguous_on_the_map(self, built):
        # The Admin map tags a node when a step name equals its label, id,
        # tool or prompt (case and punctuation ignored). Replay that rule:
        # no node may end up both before and after a prompt, and a prompt is
        # never listed as running before or after itself.
        def norm(value):
            return re.sub(r"[^a-z0-9]+", "", (value or "").lower())

        nodes = [
            node
            for stage in built["flow"]["stages"]
            for node in stage["nodes"]
        ]

        def tagged(steps):
            wanted = {norm(step) for step in steps}
            return {
                node["id"]
                for node in nodes
                if wanted
                & {
                    norm(node[key])
                    for key in ("label", "id", "tool", "prompt")
                    if node[key]
                }
            }

        for entry in built["templates"]:
            before = tagged(entry["usage"]["upstream"])
            after = tagged(entry["usage"]["downstream"])
            own = {n["id"] for n in nodes if n["prompt"] == entry["name"]}
            assert not before & after, (entry["name"], before & after)
            assert not own & (before | after), entry["name"]

    def test_the_planner_is_upstream_of_every_tool_prompt(self, built):
        by_name = {t["name"]: t["usage"] for t in built["templates"]}
        step_prompts = [
            (name, usage)
            for name, usage in by_name.items()
            if usage["stage"] in {"answer_tools", "generators"}
        ]
        assert len(step_prompts) == 7  # one per registered tool
        for name, usage in step_prompts:
            assert usage["tool"], name
            assert "Planner LLM" in usage["upstream"], name
        # The answer prompts feed the follow-up chip parser.
        for name in ("general_answer", "web_search", "product_info", "media_llm"):
            assert "Split the metadata trailer" in by_name[name]["downstream"]
            assert "ANSWER_META" in next(
                t for t in built["templates"] if t["name"] == name
            )["placeholders"]["blocks"]

    def test_dead_template_is_flagged(self, built):
        by_name = {t["name"]: t for t in built["templates"]}
        assert by_name["quiz_feedback"]["usage"]["live"] is False
        assert by_name["plan_turn"]["usage"]["live"] is True
        assert by_name["plan_turn"]["usage"]["tool"] is None
        assert by_name["general_answer"]["usage"]["tool"] == "general"


class TestCatalogFlow:
    KINDS = frozenset(
        {
            "entry",
            "context",
            "rule",
            "llm",
            "outcome",
            "tool",
            "retrieval",
            "persist",
        }
    )

    @staticmethod
    def nodes(built):
        return [n for s in built["flow"]["stages"] for n in s["nodes"]]

    def test_stages_run_top_to_bottom(self, built):
        assert [s["id"] for s in built["flow"]["stages"]] == [
            "entry",
            "context",
            "routing",
            "post_planner",
            "outcome",
            "normalize",
            "answer_tools",
            "retrieval",
            "generators",
            "finish",
            "persist",
            "outside_chat",
        ]
        for stage in built["flow"]["stages"]:
            assert stage["title"]
            assert stage["description"]
            assert stage["nodes"]

    def test_node_shape_and_unique_ids(self, built):
        nodes = self.nodes(built)
        ids = [n["id"] for n in nodes]
        assert len(ids) == len(set(ids))
        for node in nodes:
            assert set(node) == {
                "id",
                "label",
                "description",
                "kind",
                "prompt",
                "tool",
                "condition",
                "code",
            }
            assert node["kind"] in self.KINDS, node["id"]
            assert node["label"]
            assert node["description"]
            assert node["condition"], node["id"]

    def test_routing_cascade_order(self, built):
        stages = {s["id"]: s for s in built["flow"]["stages"]}
        assert [n["id"] for n in stages["routing"]["nodes"]] == [
            "forced_plan",
            "media_choice",
            "continuation",
            "fast_path",
            "plan_turn",
        ]
        assert [n["id"] for n in stages["post_planner"]["nodes"]] == [
            "clarify_blocked",
            "clarify_skipped",
            "web_upgrade",
            "media_guard",
        ]
        assert [n["id"] for n in stages["outcome"]["nodes"]] == [
            "quiz_setup",
            "clarification",
            "run_tools",
        ]
        # Only the last routing branch calls an LLM.
        prompts_used = [n["prompt"] for n in stages["routing"]["nodes"]]
        assert prompts_used == [None, None, None, None, "plan_turn"]

    def test_prompts_and_tools_refer_to_things_that_exist(
        self, built, tool_names
    ):
        templates = {t["name"] for t in built["templates"]}
        for node in self.nodes(built):
            assert node["prompt"] is None or node["prompt"] in templates
            assert node["tool"] is None or node["tool"] in tool_names

    def test_every_registered_tool_has_a_node(self, built, tool_names):
        assert tool_names == {
            "general",
            "product_info",
            "web_search",
            "media_llm",
            "quiz_generator",
            "flashcard_generator",
            "image_generator",
        }
        nodes = self.nodes(built)
        assert tool_names <= {n["tool"] for n in nodes}
        # The node that runs a tool is named after it.
        ids = {n["id"] for n in nodes if n["kind"] == "tool"}
        assert tool_names <= ids

    def test_live_templates_are_rendered_by_exactly_the_flow(self, built):
        in_flow = {n["prompt"] for n in self.nodes(built) if n["prompt"]}
        live = {t["name"] for t in built["templates"] if t["usage"]["live"]}
        assert in_flow == live

    def test_a_prompt_node_sits_in_its_template_usage_stage(self, built):
        usage = {t["name"]: t["usage"] for t in built["templates"]}
        for stage in built["flow"]["stages"]:
            for node in stage["nodes"]:
                if node["prompt"]:
                    assert usage[node["prompt"]]["stage"] == stage["id"]
                    if node["tool"]:
                        assert usage[node["prompt"]]["tool"] == node["tool"]

    def test_every_code_reference_resolves_to_that_symbol(self, built):
        declared = {
            node.id: node.code for stage in catalog.FLOW for node in stage.nodes
        }
        for node in self.nodes(built):
            path, symbol = declared[node["id"]]
            assert node["code"], f"{node['id']}: {path} {symbol} not found"
            assert node["code"].startswith(f"backend_v2/{path}:")
            lines, index = source_lines(node["code"])
            name = symbol.rsplit(".", 1)[-1]
            assert re.match(
                rf"\s*(async def|def|class) {name}\b", lines[index]
            ), node["code"]

    def test_unknown_symbols_and_files_resolve_to_none(self):
        assert catalog.symbol_ref("aeva/tracing/recorder.py", "nope") is None
        assert catalog.symbol_ref("aeva/does_not_exist.py", "x") is None
        assert catalog.build_calls("aeva/does_not_exist.py", "X") == []


class TestDeployedVersion:
    def test_every_deployed_template_resolves_by_its_catalog_hash(self, built):
        for entry in built["templates"]:
            row = catalog.deployed_version(entry["name"], entry["hash"])
            assert row is not None, entry["name"]
            assert row["name"] == entry["name"]
            assert row["hash"] == entry["hash"]
            assert row["system_template"] == entry["system"]
            assert row["user_template"] == entry["user"]
            assert row["defaults"] == entry["defaults"]
            assert row["git_sha"] is None
            assert row["first_seen_at"] is None

    def test_row_has_the_columns_a_stored_version_has(self, monkeypatch):
        # What the recorder writes to ai_prompt_versions for the same
        # template, plus the column the database fills in.
        saved = {}
        monkeypatch.setattr(
            store,
            "persist",
            lambda trace, spans, versions: saved.update(rows=versions) or True,
        )
        monkeypatch.setattr(store, "_unavailable_until", 0.0)
        monkeypatch.setenv("AI_TRACE_ENABLED", "true")
        monkeypatch.setenv("AI_TRACE_SCOPE", "all")
        monkeypatch.setenv("AI_TRACE_SAMPLE_RATE", "1")
        template = prompts.RERANK_TEMPLATE
        required = catalog.placeholders(template)["required"]
        try:
            assert tracing.start_turn(
                user_id=USER_ID, message="hi", endpoint="stream"
            )
            PromptBuilder.build(template, **dict.fromkeys(required, "x"))
        finally:
            tracing.finish_turn()
        (stored,) = saved["rows"]
        deployed = catalog.deployed_version(stored["name"], stored["hash"])
        assert deployed is not None
        assert set(deployed) == set(stored) | {"first_seen_at"}
        for column in ("name", "hash", "system_template", "user_template"):
            assert deployed[column] == stored[column]
        assert deployed["defaults"] == stored["defaults"]

    def test_other_hashes_and_names_are_unknown(self):
        assert catalog.deployed_version("plan_turn", "old000000000") is None
        assert catalog.deployed_version("plan_turn", "") is None
        assert catalog.deployed_version("nope", DEPLOYED_PLAN_HASH) is None

    def test_the_row_is_a_fresh_dict(self):
        first = catalog.deployed_version("general_answer", GENERAL_HASH)
        first["defaults"].clear()
        second = catalog.deployed_version("general_answer", GENERAL_HASH)
        assert second["defaults"]


def flow_node(node_id):
    return next(
        node for stage in catalog.FLOW for node in stage.nodes if node.id == node_id
    )


def chat_ctx(message, media_ids=None):
    return AssistantContext(
        user_id="u1", session_id="s1", message=message, media_ids=media_ids
    )


class TestCatalogFacts:
    """The hand-written conditions, held against the code they describe."""

    def test_fast_path_needs_both_clarification_checks(self):
        condition = flow_node("fast_path").condition
        assert "_clarification_unnecessary()" in condition
        assert "_has_unresolved_reference()" in condition
        orch = AssistantOrchestrator(
            llm=MagicMock(), registry=MagicMock(), supabase=MagicMock()
        )
        # Four words of pleasantries ride the fast path...
        short = "hi thanks ok cool"
        plan = orch._fast_path_plan(chat_ctx(short), short, [])
        assert plan is not None
        assert plan["steps"][0]["tool"] == "general"
        assert plan["model_config_key"] == "LLM_FAST_MODEL"
        # ...five that are not phrased as a question go to the planner...
        longer = "hello hi thanks ok cool"
        assert orch._fast_path_plan(chat_ctx(longer), longer, []) is None
        # ...unless they are phrased as one.
        asked = "hello hi thanks ok cool?"
        assert orch._fast_path_plan(chat_ctx(asked), asked, []) is not None

    def test_over_clarification_guard_covers_the_quiz_branch(self):
        condition = flow_node("clarify_skipped").condition
        assert "quiz or test request without files" in condition
        assert "more than 3 words" in condition
        assert "follows earlier conversation" in condition
        unnecessary = AssistantOrchestrator._clarification_unnecessary
        history = [{"role": "user", "content": "explain osmosis"}]
        # No subject to infer: asking stands.
        assert unnecessary("quiz me", chat_ctx("quiz me"), []) is False
        assert unnecessary("test me now", chat_ctx("test me now"), []) is False
        # More than 3 words, or earlier conversation: asking is skipped.
        wordy = "quiz me on cell biology"
        assert unnecessary(wordy, chat_ctx(wordy), []) is True
        assert unnecessary("quiz me", chat_ctx("quiz me"), history) is True
        # With files a quiz or flashcard request is always asked about.
        with_files = chat_ctx(wordy, ["m1"])
        assert unnecessary(wordy, with_files, history) is False
        cards = "make flashcards on cell biology"
        assert unnecessary(cards, chat_ctx(cards, ["m1"]), history) is False
        assert unnecessary(cards, chat_ctx(cards), []) is True

    def test_trace_flush_says_when_and_for_whom(self, built):
        stages = {s["id"]: s for s in built["flow"]["stages"]}
        persist = stages["persist"]
        flush = next(n for n in persist["nodes"] if n["id"] == "trace_flush")
        for text in (persist["description"], flush["condition"]):
            assert "after the last frame on the streaming routes" in text.lower()
            assert "after the response was sent on the JSON routes" in text
        assert "AI_TRACE_SCOPE=debug_users" in flush["condition"]
        assert "Developer Mode users" in flush["condition"]

    def test_functions_named_in_the_flow_exist_in_the_referenced_file(self):
        named = re.compile(r"\b(_[a-z][a-z0-9_]*)\(\)")
        checked = 0
        for stage in catalog.FLOW:
            for node in stage.nodes:
                text = f"{node.description} {node.condition}"
                source = (BACKEND / node.code[0]).read_text(encoding="utf-8")
                for name in named.findall(text):
                    checked += 1
                    assert re.search(rf"def {name}\(", source), (node.id, name)
        assert checked >= 2

    def test_settings_named_in_the_flow_exist_in_the_code(self):
        setting = re.compile(r"\b(?:AI|AGENT|LLM|CHAT)_[A-Z][A-Z0-9_]+\b")
        source = "\n".join(
            file.read_text(encoding="utf-8")
            for file in (BACKEND / "aeva").rglob("*.py")
            if file.name != "catalog.py"
        )
        names = set()
        for stage in catalog.FLOW:
            texts = [stage.description]
            for node in stage.nodes:
                texts += [node.description, node.condition or ""]
            names.update(setting.findall(" ".join(texts)))
        assert {"AI_TRACE_SCOPE", "AGENT_MAX_PARALLEL", "LLM_FAST_MODEL"} <= names
        for name in names:
            assert f'"{name}"' in source, name

    def test_context_loading_points_at_the_function_that_does_it(self):
        source = (BACKEND / catalog._ORCHESTRATOR).read_text(encoding="utf-8")
        body = source.split("    def _setup_and_plan(", 1)[1].split("\n    def ", 1)[0]
        for node_id, call in (
            ("load_session", "self.supabase.get_session("),
            ("load_profile", "self.supabase.get_profile("),
            ("user_message", "self.supabase.add_message("),
        ):
            assert flow_node(node_id).code == (
                catalog._ORCHESTRATOR,
                "AssistantOrchestrator._setup_and_plan",
            )
            assert call in body, node_id


# ------------------------------------------------------ the blueprint


EXPECTED_RULES = {
    "/admin/traces": {"GET"},
    "/admin/traces/<trace_id>": {"GET"},
    "/admin/traces/purge": {"POST"},
    "/admin/sessions/<session_id>/traces": {"GET"},
    "/admin/prompts": {"GET"},
    "/admin/prompts/<name>/versions/<digest>": {"GET"},
}
SECRET = "unit-test-secret-that-is-long-enough-for-hs256"  # noqa: S105


@pytest.fixture(scope="module")
def app():
    flask_app = Flask(__name__)
    flask_app.config.update(
        TESTING=True,
        API_TITLE="test",
        API_VERSION="1",
        OPENAPI_VERSION="3.0.2",
        ADMIN_USERNAME="root",
        ADMIN_PASSWORD="pw",  # noqa: S106
        ADMIN_JWT_SECRET=SECRET,
        ADMIN_PERMISSIONS="*",
    )

    @flask_app.errorhandler(CustomError)
    def handle(error):  # mirrors aeva.app's handler
        return jsonify({"msg": error.message, "code": error.code}), error.status

    # Both blueprints, as ``aeva.app`` registers them: same ``/admin`` prefix.
    api = Api(flask_app)
    api.register_blueprint(admin_controller.blueprint)
    api.register_blueprint(trace_controller.blueprint)
    return flask_app


def _rules_of(blueprint):
    """URL rules one blueprint contributes, on an app of its own."""
    flask_app = Flask(blueprint.name)
    flask_app.config.update(
        API_TITLE="t", API_VERSION="1", OPENAPI_VERSION="3.0.2"
    )
    Api(flask_app).register_blueprint(blueprint)
    return [
        rule
        for rule in flask_app.url_map.iter_rules()
        if rule.rule.startswith("/admin")
    ]


def token(perms):
    return jwt.encode(
        {"sub": "root", "role": "admin", "perms": perms, "exp": 4102444800},
        SECRET,
        algorithm="HS256",
    )


def auth(perms=("*",)):
    return {"Authorization": f"Bearer {token(list(perms))}"}


@pytest.fixture
def api(app, monkeypatch):
    """Test client wired to a TraceRepository over the fake client."""

    def responder(query):
        if query.kind == "rpc":
            return result(5 if query.name == "purge_ai_traces" else [])
        if query.name == "ai_traces":
            return result([trace_row()], count=120)
        return result([], count=0)

    repo, client = repo_for(responder)
    monkeypatch.setattr(trace_controller, "trace_repo", repo)
    return app.test_client(), client


class TestRoutes:
    def test_routes_are_registered_with_the_expected_rules(self, app):
        rules = {
            rule.rule: set(rule.methods) - {"HEAD", "OPTIONS"}
            for rule in app.url_map.iter_rules()
        }
        for rule, methods in EXPECTED_RULES.items():
            assert rules.get(rule) == methods, rule

    def test_trace_repository_is_the_default_backend(self):
        # (The api fixture swaps it; this is the module's own instance.)
        assert isinstance(trace_controller.trace_repo, TraceRepository)

    def test_the_admin_panel_files_carry_nothing_of_the_feature(self):
        # The routes and schemas live in their own modules; the admin
        # controller and its schema module are as they were.
        assert not hasattr(admin_controller, "trace_repo")
        for name in ("TraceListQuery", "TracePurgeSchema"):
            assert not hasattr(admin_schema, name)
        trace_rules = {
            rule.rule
            for rule in _rules_of(trace_controller.blueprint)
        }
        assert trace_rules == set(EXPECTED_RULES)
        assert not trace_rules & {
            rule.rule for rule in _rules_of(admin_controller.blueprint)
        }

    def test_app_registers_the_trace_blueprint(self):
        # ``aeva.app`` cannot be imported here (sentry_sdk), so read it.
        source = (BACKEND / "aeva" / "app.py").read_text(encoding="utf-8")
        assert (
            "from aeva.admin.trace_controller import blueprint as "
            "admin_trace_bp"
        ) in source
        assert "api.register_blueprint(admin_trace_bp)" in source

    def test_existing_admin_routes_still_answer(self, api, monkeypatch):
        client, _ = api
        monkeypatch.setattr(
            admin_controller.repo,
            "get_session",
            lambda session_id: {"msg": "ok", "data": {"id": session_id}},
        )
        response = client.get(f"/admin/sessions/{SESSION_ID}", headers=auth())
        assert response.status_code == 200
        assert response.get_json()["data"] == {"id": SESSION_ID}

    @pytest.mark.parametrize(
        ("method", "url"),
        [
            ("get", "/admin/traces"),
            ("get", f"/admin/traces/{TRACE_ID}"),
            ("get", f"/admin/sessions/{SESSION_ID}/traces"),
            ("get", "/admin/prompts"),
            ("get", "/admin/prompts/plan_turn/versions/abc"),
            ("post", "/admin/traces/purge"),
        ],
    )
    def test_every_route_requires_an_admin_token(self, api, method, url):
        client, fake = api
        response = getattr(client, method)(url, json={"days": 30})
        assert response.status_code == 401
        assert response.get_json()["code"] == "ADMIN_UNAUTHORIZED"
        assert fake.executed == []

    @pytest.mark.parametrize(
        "url",
        [
            "/admin/traces",
            f"/admin/traces/{TRACE_ID}",
            f"/admin/sessions/{SESSION_ID}/traces",
            "/admin/prompts",
            "/admin/prompts/plan_turn/versions/abc",
        ],
    )
    def test_reads_need_view_debug_data(self, api, url):
        client, fake = api
        allowed = client.get(url, headers=auth(["VIEW_DEBUG_DATA"]))
        # (The fake stores no prompt version: that one read is a 404.)
        assert allowed.status_code == (404 if "/versions/" in url else 200)
        assert fake.executed

    @pytest.mark.parametrize(
        "url",
        [
            "/admin/traces",
            f"/admin/traces/{TRACE_ID}",
            "/admin/prompts",
            f"/admin/prompts/plan_turn/versions/{DEPLOYED_PLAN_HASH}",
        ],
    )
    def test_a_missing_permission_is_403_not_a_logout(self, api, url):
        # The admin UI treats any 401 as an expired session.
        client, fake = api
        denied = client.get(url, headers=auth(["VIEW_USERS", "DELETE_DATA"]))
        assert denied.status_code == 403
        body = denied.get_json()
        assert body["code"] == "ADMIN_FORBIDDEN"
        assert "VIEW_DEBUG_DATA" in body["msg"]
        assert "permission to view AI traces and prompts" in body["msg"]
        assert fake.executed == []

    def test_session_traces_without_permission_are_empty_not_an_error(
        self, api
    ):
        # The session dialog asks for these on its own for every admin.
        client, fake = api
        url = f"/admin/sessions/{SESSION_ID}/traces"
        response = client.get(url, headers=auth(["VIEW_CHATS"]))
        assert response.status_code == 200
        assert response.get_json()["data"] == {
            "traces": [],
            "available": False,
        }
        assert fake.executed == []
        allowed = client.get(url, headers=auth(["VIEW_DEBUG_DATA"])).get_json()
        assert allowed["data"]["available"] is True
        assert allowed["data"]["traces"][0]["id"] == TRACE_ID

    def test_a_bad_token_is_still_401(self, api):
        client, fake = api
        response = client.get(
            "/admin/traces", headers={"Authorization": "Bearer nope"}
        )
        assert response.status_code == 401
        assert response.get_json()["code"] == "ADMIN_UNAUTHORIZED"
        assert fake.executed == []

    def test_permission_check_follows_admin_auth(self, api):
        # Tokens minted before the permission system carry no grants and
        # keep full access, exactly as ``check_permission`` decides.
        client, _ = api
        legacy = {"Authorization": f"Bearer {token([])}"}
        assert client.get("/admin/traces", headers=legacy).status_code == 200

    def test_list_parses_the_query_string_the_ui_sends(self, api):
        client, fake = api
        response = client.get(
            "/admin/traces",
            query_string={
                "page": "2",
                "page_size": "50",
                "q": TRACE_ID,
                "status": "error",
                "tool": "media_llm",
                "prompt": "plan_turn",
                "plan_source": "planner+media_guard",
                "session_id": SESSION_ID,
                "user_id": USER_ID,
            },
            headers=auth(),
        )
        assert response.status_code == 200
        body = response.get_json()
        assert set(body) == {"msg", "data"}
        assert set(body["data"]) == {
            "items",
            "total",
            "page",
            "page_size",
            "available",
        }
        assert body["data"]["page"] == 2
        assert body["data"]["total"] == 120
        assert body["data"]["items"][0]["owner_email"] == "a@b.c"
        query = fake.executed[-1]
        assert query.one("range") == ((50, 99), {})
        assert ("plan_source", "planner+media_guard") in query.args("eq")
        assert ("tools", ["media_llm"]) in query.args("contains")
        assert len(query.args("or_")) == 1

    def test_list_defaults(self, api):
        client, fake = api
        assert client.get("/admin/traces", headers=auth()).status_code == 200
        assert fake.executed[0].one("range") == ((0, 24), {})

    @pytest.mark.parametrize(
        "params", [{"page": "0"}, {"page_size": "101"}, {"page_size": "0"}]
    )
    def test_list_rejects_out_of_range_paging(self, api, params):
        client, fake = api
        response = client.get(
            "/admin/traces", query_string=params, headers=auth()
        )
        assert response.status_code == 422
        assert fake.executed == []

    def test_malformed_ids_are_clean_responses_not_500s(self, api):
        client, _ = api
        listed = client.get(
            "/admin/traces?session_id=oops&user_id=1", headers=auth()
        )
        assert listed.status_code == 200
        assert listed.get_json()["data"]["items"] == []
        detail = client.get("/admin/traces/oops", headers=auth())
        assert detail.status_code == 404
        assert detail.get_json()["code"] == "NOT_FOUND"
        session = client.get("/admin/sessions/oops/traces", headers=auth())
        assert session.status_code == 200
        assert session.get_json()["data"] == {"traces": [], "available": True}

    def test_trace_detail_shape(self, api):
        client, _ = api
        response = client.get(f"/admin/traces/{TRACE_ID}", headers=auth())
        assert response.status_code == 200
        data = response.get_json()["data"]
        assert set(data) == {"trace", "spans"}
        assert data["trace"]["id"] == TRACE_ID

    def test_purge_needs_delete_data_and_audits(self, api):
        client, fake = api
        denied = client.post(
            "/admin/traces/purge",
            json={"days": 30},
            headers=auth(["VIEW_DEBUG_DATA"]),
        )
        assert denied.status_code == 403
        assert denied.get_json()["code"] == "ADMIN_FORBIDDEN"
        assert "DELETE_DATA" in denied.get_json()["msg"]
        assert "permission to delete AI traces" in denied.get_json()["msg"]
        assert fake.executed == []

        response = client.post(
            "/admin/traces/purge",
            json={"days": 30},
            headers=auth(["DELETE_DATA"]),
        )
        assert response.status_code == 200
        assert response.get_json()["data"] == {"removed": 5, "days": 30}
        ((entry,), _) = fake.ran("admin_audit_log")[0].one("insert")
        assert entry["admin_username"] == "root"
        assert entry["action"] == "traces.purge"

    @pytest.mark.parametrize(
        "body", [{}, {"days": 0}, {"days": 3651}, {"days": "soon"}]
    )
    def test_purge_validates_days(self, api, body):
        client, fake = api
        response = client.post(
            "/admin/traces/purge", json=body, headers=auth()
        )
        assert response.status_code == 422
        assert fake.executed == []

    def test_purge_accepts_the_bounds(self):
        schema = TracePurgeSchema()
        assert schema.load({"days": 1}).days == 1
        assert schema.load({"days": 3650}).days == 3650

    def test_prompt_catalog_days(self, api):
        client, fake = api
        response = client.get("/admin/prompts?days=30", headers=auth())
        assert response.status_code == 200
        data = response.get_json()["data"]
        assert data["stats_days"] == 30
        assert data["stats_available"] is True
        assert fake.executed[0].params == {"p_days": 30}
        default = client.get("/admin/prompts", headers=auth())
        assert default.get_json()["data"]["stats_days"] == 7
        assert client.get(
            "/admin/prompts?days=0", headers=auth()
        ).status_code == 422

    def test_prompt_version_route_passes_name_and_hash(self, api):
        client, fake = api
        response = client.get(
            "/admin/prompts/plan_turn/versions/abc123", headers=auth()
        )
        # The fake has no such row, and it is not the deployed version.
        assert response.status_code == 404
        assert response.get_json()["code"] == "NOT_FOUND"
        assert fake.executed[0].args("eq") == [
            ("name", "plan_turn"),
            ("hash", "abc123"),
        ]

    def test_prompt_version_route_serves_the_deployed_text(self, api):
        client, _ = api
        response = client.get(
            f"/admin/prompts/plan_turn/versions/{DEPLOYED_PLAN_HASH}",
            headers=auth(),
        )
        assert response.status_code == 200
        data = response.get_json()["data"]
        assert data["system_template"] == prompts.PLAN_TURN_TEMPLATE.system
        assert data["first_seen_at"] is None
        assert data["git_sha"] is None

    def test_query_schema_defaults(self):
        assert TraceListQuerySchema().load({}) == TraceListQuery()
        loaded = TraceListQuerySchema().load({"q": "x", "page_size": "100"})
        assert loaded == TraceListQuery(q="x", page_size=100)
        assert PromptCatalogQuerySchema().load({}) == PromptCatalogQuery()
        assert PromptCatalogQuerySchema().load({"days": "30"}).days == 30
