"""Execution tracing of retrieval and generator grounding.

``aeva.media.retrieval`` and ``aeva.media.grounding`` only carry decorators
from ``aeva.tracing.services.retrieval_trace``. These tests run the real
pipeline with fake I/O and assert on the span rows a turn would store, that
the decorators are pure pass-throughs when no trace is recorded, and that a
fault in the bookkeeping never reaches the caller.
"""

import json
import threading
import time
from typing import Any
from unittest.mock import MagicMock, patch

import pytest
from flask import Flask

from aeva import tracing
from aeva.mcp.base import PriorResult, ToolContext
from aeva.media import retrieval as retrieval_module
from aeva.media.grounding import COVERAGE_QUERY, ground_generator
from aeva.media.retrieval import (
    RetrievalOptions,
    RetrievalResult,
    RetrievalService,
)
from aeva.media.retrieval_utils import Excerpt
from aeva.tracing import recorder, store
from aeva.tracing.services import retrieval_trace


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    """Each test starts unbound, with storage 'available'."""
    recorder._BINDING.set(None)
    monkeypatch.setattr(store, "_unavailable_until", 0.0)
    monkeypatch.setattr(store, "_known_prompt_versions", set())
    for key in (
        "AI_TRACE_ENABLED",
        "AI_TRACE_SCOPE",
        "AI_TRACE_SAMPLE_RATE",
        "AI_TRACE_MAX_FIELD_CHARS",
        "AI_TRACE_MAX_SPANS",
    ):
        monkeypatch.delenv(key, raising=False)
    yield
    recorder._BINDING.set(None)


@pytest.fixture
def saved(monkeypatch):
    """Capture what finish_turn would write instead of hitting Supabase."""
    box: dict = {}

    def fake_persist(trace_row, span_rows, prompt_rows):
        box["trace"] = trace_row
        box["spans"] = span_rows
        box["prompts"] = prompt_rows
        return True

    monkeypatch.setattr(store, "persist", fake_persist)
    return box


def _start() -> str | None:
    return tracing.start_turn(
        user_id="u1", message="explain osmosis", endpoint="stream"
    )


def _named(spans: list[dict], name: str, kind: str | None = None) -> list[dict]:
    return [
        s
        for s in spans
        if s["name"] == name and (kind is None or s["kind"] == kind)
    ]


def _one(spans: list[dict], name: str, kind: str | None = None) -> dict:
    found = _named(spans, name, kind)
    assert len(found) == 1, (name, [s["name"] for s in spans])
    return found[0]


def _slots() -> list[str]:
    """Scratch keys the service still holds in the running trace."""
    return [k for k in tracing.state() if k.startswith("retrieval_trace.")]


# ------------------------------------------------------------- retrieval


def _row(cid: str, media: str, index: int, sim: float, **extra: Any) -> dict:
    return {
        "id": cid,
        "media_id": media,
        "chunk_index": index,
        "content": f"SECRET TEXT {cid}",
        "page_number": index + 1,
        "section": "Sec",
        "similarity": sim,
        "rrf_score": 1 / (60 + index + 1),
        **extra,
    }


MEDIA = [{"id": "m1", "file_name": "n.pdf"}]
ROWS = [
    _row("a", "m1", 0, 0.9, vector_rank=1, text_rank=1),
    _row("b", "m1", 3, 0.8, vector_rank=2),
]


@pytest.fixture
def app() -> Flask:
    app = Flask(__name__)
    app.config.update(RAG_TOP_K=3, RAG_MULTI_QUERY=False, RAG_RERANK="none")
    return app


def _embedder() -> MagicMock:
    """Embedding client that, like the real one, records an embed span."""
    embed = MagicMock()

    def run(texts, **_k):
        tracing.event(tracing.KIND_EMBEDDING, "embed")
        return [[0.1, 0.2] for _ in texts]

    embed.embed.side_effect = run
    return embed


def _service(rows: list[dict], llm: Any = None) -> RetrievalService:
    supabase = MagicMock()
    supabase.search_chunks_hybrid.return_value = rows
    supabase.match_chunks.return_value = rows
    supabase.fetch_adjacent_chunks.return_value = []
    supabase.list_chunk_sections.return_value = [{"section": "Sec"}]
    return RetrievalService(
        supabase=supabase,
        embed_llm=_embedder(),
        rewrite_llm=llm or MagicMock(),
    )


class _FastLLM:
    """Stands in for the fast model behind both rewrite and rerank."""

    def __init__(
        self,
        *,
        rerank_delay: float = 0.0,
        scores: Any = None,
        fail: BaseException | None = None,
    ) -> None:
        self.rerank_delay = rerank_delay
        self.scores = scores
        self.fail = fail
        self.threads: dict[str, int] = {}
        self.finished = threading.Event()

    def generate_structured(self, _user, _schema, **kwargs: Any) -> dict:
        label = kwargs["log_label"]
        self.threads[label] = threading.get_ident()
        # What the real client does: one llm span on the calling thread.
        with tracing.span(tracing.KIND_LLM, f"llm.{label}"):
            if self.fail is not None:
                raise self.fail
            if label == "rag_rewrite":
                return {
                    "standalone_query": "explain osmosis simply",
                    "keywords": ["osmosis"],
                    "paraphrases": ["what is osmosis"],
                }
            time.sleep(self.rerank_delay)
            self.finished.set()
            if self.scores is not None:
                return {"scores": self.scores}
            return {
                "scores": [{"index": 1, "score": 9}, {"index": 0, "score": 2}]
            }


FULL = RetrievalOptions(
    top_k=2, multi_query=True, rerank="llm", rerank_timeout_s=2
)
RERANK_ONLY = RetrievalOptions(
    top_k=2, multi_query=False, rerank="llm", rerank_timeout_s=2
)
HISTORY = [{"role": "user", "content": "explain osmosis"}]


class TestRetrievalSpans:
    def _retrieve(self, app, service, saved, **kw) -> tuple[Any, list[dict]]:
        _start()
        with app.app_context(), tracing.span(tracing.KIND_TOOL, "media_llm"):
            result = service.retrieve("u1", "simpler please", MEDIA, **kw)
            assert _slots() == []
        tracing.finish_turn()
        return result, saved["spans"]

    def test_tree_with_rewrite_search_and_rerank(self, app, saved):
        llm = _FastLLM()
        result, spans = self._retrieve(
            app, _service(ROWS, llm), saved, history=HISTORY, options=FULL
        )
        tool = _one(spans, "media_llm", "tool")
        retrieve = _one(spans, "retrieve", "retrieval")
        rewrite = _one(spans, "rewrite", "retrieval")
        embed = _one(spans, "embed", "embedding")
        search = _one(spans, "search", "retrieval")
        rerank = _one(spans, "rerank", "retrieval")
        assert retrieve["parent_id"] == tool["id"]
        # The embedding is a sibling of the search, not part of it.
        for child in (rewrite, embed, search, rerank):
            assert child["parent_id"] == retrieve["id"]
            assert child["status"] == "ok"
        assert rewrite["seq"] < embed["seq"] < search["seq"] < rerank["seq"]

        assert retrieve["input"]["query"] == "simpler please"
        assert retrieve["input"]["media"] == [{"id": "m1", "name": "n.pdf"}]
        assert retrieve["input"]["options"]["rerank"] == "llm"
        assert retrieve["input"]["options"]["top_k"] == 2
        assert retrieve["input"]["history_turns"] == 1
        out = retrieve["output"]
        assert out["query_used"] == "explain osmosis simply"
        assert [c["id"] for c in out["chunks"]] == ["b", "a"]
        assert out["chunks"][1] == {
            "id": "a",
            "media_id": "m1",
            "chunk_index": 0,
            "score": out["chunks"][1]["score"],
            "origin": "both",
            "similarity": 0.9,
            "page_number": 1,
        }
        assert out["context_chars"] == len(result.context_text) > 0
        assert out["diagnostics"]["reranked"] is True
        assert out["diagnostics"]["rewritten"] is True
        assert out["coverage"] == []
        assert len(out["excerpts"]) == len(result.excerpts)
        assert "content" not in out["excerpts"][0]
        assert len(out["sources"]) == len(result.sources)
        assert all("snippet" not in source for source in out["sources"])
        # References only: neither the chunk text nor the query vectors.
        for row in (retrieve, rewrite, search, rerank):
            dumped = json.dumps(row)
            assert "SECRET TEXT" not in dumped
            assert "0.2]" not in dumped

        assert rewrite["input"] == {
            "query": "simpler please",
            "history_turns": 1,
            "needs_context": True,
            "multi_query": True,
        }
        assert rewrite["output"] == {
            "llm_called": True,
            "query": "explain osmosis simply",
            "rewritten": True,
            "keywords": ["osmosis"],
            "paraphrases": ["what is osmosis"],
            "standalone_used": True,
        }
        assert search["input"] == {
            "queries": ["explain osmosis simply", "what is osmosis"],
            "fts_query": result.diagnostics["fts_query"],
            "hybrid": True,
            "media_ids": ["m1"],
            "candidates_per_query": 24,
        }
        assert search["output"]["mode"] == "hybrid"
        assert search["output"]["fusion"] == "rrf"
        assert search["output"]["candidates"] == 2
        assert search["output"]["variants"] == [
            {"query": "explain osmosis simply", "mode": "hybrid", "rows": 2},
            {"query": "what is osmosis", "mode": "hybrid", "rows": 2},
        ]
        assert [r["id"] for r in search["output"]["ranking"]] == ["a", "b"]
        assert search["meta"]["hybrid_unavailable"] is False
        assert rerank["input"] == {
            "query": "explain osmosis simply",
            "candidates": ["a", "b"],
            "timeout_s": 2,
        }
        assert rerank["output"] == {
            "reranked": True,
            "timed_out": False,
            "order_before": ["a", "b"],
            "order_after": ["b", "a"],
            "scores": {"a": 2.0, "b": 9.0},
        }

    def test_options_read_from_config_are_on_the_retrieve_span(
        self, app, saved
    ):
        # No ``options`` argument: the pipeline reads them from the config,
        # and the span shows what it resolved.
        _result, spans = self._retrieve(app, _service(ROWS), saved)
        options = _one(spans, "retrieve", "retrieval")["input"]["options"]
        assert options["top_k"] == 3
        assert options["rerank"] == "none"
        assert options["multi_query"] is False

    def test_rerank_call_nests_across_its_own_thread(self, app, saved):
        llm = _FastLLM()
        _result, spans = self._retrieve(
            app, _service(ROWS, llm), saved, history=HISTORY, options=FULL
        )
        rewrite = _one(spans, "rewrite", "retrieval")
        rerank = _one(spans, "rerank", "retrieval")
        # The rerank call really ran on another thread than the request.
        assert llm.threads["rag_rewrite"] == threading.get_ident()
        assert llm.threads["rag_rerank"] != threading.get_ident()
        assert _one(spans, "llm.rag_rerank")["parent_id"] == rerank["id"]
        assert _one(spans, "llm.rag_rewrite")["parent_id"] == rewrite["id"]
        # Each prompt build sits next to the call that sends it.
        assert _one(spans, "rag_rerank", "prompt")["parent_id"] == rerank["id"]
        assert (
            _one(spans, "rag_query_rewrite", "prompt")["parent_id"]
            == rewrite["id"]
        )

    def test_rerank_timeout_status_and_late_call(self, app, saved):
        llm = _FastLLM(rerank_delay=0.3)
        opts = RetrievalOptions(
            top_k=2, multi_query=False, rerank="llm", rerank_timeout_s=0.05
        )
        _start()
        with app.app_context():
            result = _service(ROWS, llm).retrieve(
                "u1", "what is osmosis", MEDIA, options=opts
            )
        # The abandoned call finishes while the turn is still running.
        assert llm.finished.wait(2)
        time.sleep(0.05)
        tracing.finish_turn()
        spans = saved["spans"]
        rerank = _one(spans, "rerank", "retrieval")
        assert rerank["status"] == "timeout"
        assert rerank["error"] is None
        assert rerank["output"] == {
            "reranked": False,
            "timed_out": True,
            "order_before": ["a", "b"],
            "order_after": ["a", "b"],
            "scores": {},
        }
        assert [c.id for c in result.chunks] == ["a", "b"]
        assert result.diagnostics["rerank_timeout"] is True
        late = _one(spans, "llm.rag_rerank")
        assert late["parent_id"] == rerank["id"]
        assert late["status"] == "ok"

    def test_rerank_abandoned_past_the_flush_is_unfinished(self, app, saved):
        llm = _FastLLM(rerank_delay=0.4)
        opts = RetrievalOptions(
            top_k=2, multi_query=False, rerank="llm", rerank_timeout_s=0.05
        )
        _start()
        with app.app_context():
            _service(ROWS, llm).retrieve(
                "u1", "what is osmosis", MEDIA, options=opts
            )
        tracing.finish_turn()
        spans = saved["spans"]
        assert _one(spans, "rerank", "retrieval")["status"] == "timeout"
        assert _one(spans, "llm.rag_rerank")["status"] == "unfinished"
        # The late call must end quietly on its own thread.
        assert llm.finished.wait(2)

    def test_rerank_failure_is_an_error_without_raising(self, app, saved):
        llm = MagicMock()
        llm.generate_structured.side_effect = RuntimeError("rerank down")
        result, spans = self._retrieve(
            app, _service(ROWS, llm), saved, options=RERANK_ONLY
        )
        rerank = _one(spans, "rerank", "retrieval")
        assert rerank["status"] == "error"
        assert rerank["error"] == "RuntimeError: rerank down"
        assert rerank["output"]["reranked"] is False
        assert rerank["output"]["order_after"] == ["a", "b"]
        assert [c.id for c in result.chunks] == ["a", "b"]
        assert _one(spans, "retrieve", "retrieval")["status"] == "ok"

    def test_rerank_call_raising_its_own_timeout_keeps_the_error_text(
        self, app, saved
    ):
        # Retrieval cannot tell a TimeoutError raised by the call from the
        # pool giving up, so both are ``timeout``; the span names the error.
        llm = _FastLLM(fail=TimeoutError("upstream too slow"))
        result, spans = self._retrieve(
            app, _service(ROWS, llm), saved, options=RERANK_ONLY
        )
        rerank = _one(spans, "rerank", "retrieval")
        assert result.diagnostics["rerank_timeout"] is True
        assert rerank["status"] == "timeout"
        assert rerank["error"] == "TimeoutError: upstream too slow"
        assert rerank["output"]["timed_out"] is True

    def test_rerank_without_usable_scores_says_so(self, app, saved):
        llm = _FastLLM(scores=["x", {"index": 99, "score": 5}, {"index": None}])
        result, spans = self._retrieve(
            app, _service(ROWS, llm), saved, options=RERANK_ONLY
        )
        rerank = _one(spans, "rerank", "retrieval")
        assert rerank["status"] == "ok"
        assert rerank["output"] == {
            "reranked": False,
            "timed_out": False,
            "order_before": ["a", "b"],
            "order_after": ["a", "b"],
            "scores": {},
        }
        assert rerank["meta"]["reason"] == "the model returned no usable scores"
        assert result.diagnostics["reranked"] is False

    def test_rerank_scores_are_the_ones_the_pipeline_used(self, app, saved):
        # Unusable entries are dropped exactly as ``_rerank`` drops them.
        llm = _FastLLM(
            scores=[
                "x",
                {"index": "1", "score": "7"},
                {"index": 5, "score": 9},
                {"index": 0, "score": None},
            ]
        )
        result, spans = self._retrieve(
            app, _service(ROWS, llm), saved, options=RERANK_ONLY
        )
        rerank = _one(spans, "rerank", "retrieval")
        assert [c.id for c in result.chunks] == ["b", "a"]
        assert rerank["output"]["reranked"] is True
        assert rerank["output"]["order_after"] == ["b", "a"]
        assert rerank["output"]["scores"] == {"b": 7.0}

    def test_rewrite_failure_is_an_error_without_raising(self, app, saved):
        llm = _FastLLM(fail=RuntimeError("boom"))
        result, spans = self._retrieve(
            app, _service(ROWS, llm), saved, history=HISTORY
        )
        rewrite = _one(spans, "rewrite", "retrieval")
        assert rewrite["status"] == "error"
        # ``_rewrite`` swallows the exception, so the span points at the
        # LLM call inside it, which carries the real error.
        assert "rewrite call failed" in rewrite["error"]
        call = _one(spans, "llm.rag_rewrite")
        assert call["parent_id"] == rewrite["id"]
        assert call["error"] == "RuntimeError: boom"
        assert rewrite["output"] == {
            "llm_called": True,
            "fallback": True,
            "query": "simpler please",
        }
        assert result.query_used == "simpler please"
        assert _one(spans, "retrieve", "retrieval")["status"] == "ok"

    def test_paraphrases_only_keeps_the_students_words(self, app, saved):
        opts = RetrievalOptions(top_k=2, multi_query=True, rerank="none")
        result, spans = self._retrieve(
            app, _service(ROWS, _FastLLM()), saved, options=opts
        )
        rewrite = _one(spans, "rewrite", "retrieval")
        assert rewrite["input"]["needs_context"] is False
        assert rewrite["output"]["standalone_used"] is False
        assert rewrite["output"]["rewritten"] is False
        assert rewrite["output"]["query"] == "simpler please"
        assert rewrite["output"]["paraphrases"] == ["what is osmosis"]
        assert result.query_used == "simpler please"

    def test_stages_that_do_not_run_are_skipped(self, app, saved):
        service = _service(ROWS)
        result, spans = self._retrieve(app, service, saved)
        retrieve = _one(spans, "retrieve", "retrieval")
        rewrite = _one(spans, "rewrite", "retrieval")
        rerank = _one(spans, "rerank", "retrieval")
        assert rewrite["status"] == "skipped"
        assert rewrite["output"] == {
            "llm_called": False,
            "query": "simpler please",
        }
        assert rewrite["meta"]["reason"]
        assert rerank["status"] == "skipped"
        assert rerank["parent_id"] == retrieve["id"]
        assert rerank["output"] == {"reranked": False, "candidates": 2}
        assert rerank["meta"]["reason"] == "reranking is off for this call"
        service.rewrite_llm.generate_structured.assert_not_called()
        search = _one(spans, "search", "retrieval")
        assert search["output"]["fusion"] == "single"
        assert search["seq"] < rerank["seq"]
        assert result.diagnostics["reranked"] is False

    def test_rerank_skipped_for_a_single_chunk(self, app, saved):
        _result, spans = self._retrieve(
            app, _service(ROWS[:1]), saved, options=RERANK_ONLY
        )
        rerank = _one(spans, "rerank", "retrieval")
        assert rerank["status"] == "skipped"
        assert rerank["output"] == {"reranked": False, "candidates": 1}
        assert rerank["meta"]["reason"] == "fewer than two chunks to order"

    def test_vector_fallback_mode_is_recorded(self, app, saved):
        service = _service(ROWS)
        service.supabase.search_chunks_hybrid.side_effect = RuntimeError(
            "no rpc"
        )
        _result, spans = self._retrieve(app, service, saved)
        search = _one(spans, "search", "retrieval")
        assert search["output"]["mode"] == "vector_fallback"
        assert search["output"]["variants"][0]["mode"] == "vector_fallback"
        assert search["meta"]["hybrid_unavailable"] is True

    def test_search_failure_marks_search_and_retrieve_and_raises(
        self, app, saved
    ):
        service = _service(ROWS)
        service.supabase.search_chunks_hybrid.side_effect = RuntimeError(
            "no rpc"
        )
        service.supabase.match_chunks.side_effect = RuntimeError("db down")
        _start()
        with app.app_context(), pytest.raises(RuntimeError, match="db down"):
            service.retrieve("u1", "q", MEDIA)
        assert _slots() == []
        tracing.event(tracing.KIND_DECISION, "after")
        tracing.finish_turn()
        spans = saved["spans"]
        search = _one(spans, "search", "retrieval")
        assert search["status"] == "error"
        assert search["error"] == "RuntimeError: db down"
        assert _one(spans, "retrieve", "retrieval")["status"] == "error"
        assert _named(spans, "rerank") == []
        # The trace position is back at the root.
        assert _one(spans, "after")["parent_id"] == spans[0]["id"]

    def test_embedding_failure_raises_before_any_search_span(self, app, saved):
        service = _service(ROWS)
        service.embed_llm.embed.side_effect = ValueError("embed down")
        _start()
        with app.app_context(), pytest.raises(ValueError, match="embed down"):
            service.retrieve("u1", "q", MEDIA)
        tracing.event(tracing.KIND_DECISION, "after")
        tracing.finish_turn()
        spans = saved["spans"]
        assert _named(spans, "search") == []
        retrieve = _one(spans, "retrieve", "retrieval")
        assert retrieve["status"] == "error"
        assert retrieve["error"] == "ValueError: embed down"
        assert _one(spans, "after")["parent_id"] == spans[0]["id"]

    def test_search_without_any_vector_is_still_recorded(self, app, saved):
        service = _service(ROWS)
        service.embed_llm.embed.side_effect = lambda _texts, **_k: []
        result, spans = self._retrieve(app, service, saved)
        search = _one(spans, "search", "retrieval")
        assert result.is_empty()
        assert search["status"] == "ok"
        assert search["parent_id"] == _one(spans, "retrieve")["id"]
        assert search["input"]["queries"] == ["simpler please"]
        assert search["output"]["variants"] == []
        assert search["output"]["candidates"] == 0
        service.supabase.search_chunks_hybrid.assert_not_called()

    def test_empty_result_keeps_coverage(self, app, saved):
        result, spans = self._retrieve(app, _service([]), saved)
        out = _one(spans, "retrieve", "retrieval")["output"]
        assert result.is_empty()
        assert out["chunks"] == []
        assert out["coverage"] == ["Sec"]
        assert out["context_chars"] == 0

    def test_same_result_with_tracing_off(self, app, saved):
        def run() -> RetrievalResult:
            with app.app_context():
                return _service(ROWS, _FastLLM()).retrieve(
                    "u1", "simpler please", MEDIA, history=HISTORY, options=FULL
                )

        plain = run()
        assert "spans" not in saved
        _start()
        traced = run()
        tracing.finish_turn()
        assert [c.id for c in plain.chunks] == [c.id for c in traced.chunks]
        assert plain.excerpts == traced.excerpts
        assert plain.context_text == traced.context_text
        assert plain.sources == traced.sources
        assert plain.allowed_markers == traced.allowed_markers
        assert plain.query_used == traced.query_used
        assert plain.coverage == traced.coverage

        def timeless(diag: dict) -> dict:
            return {k: v for k, v in diag.items() if not k.endswith("_ms")}

        assert timeless(plain.diagnostics) == timeless(traced.diagnostics)
        assert list(plain.diagnostics) == list(traced.diagnostics)

    def test_no_state_is_kept_on_the_shared_service(self, app, saved):
        service = _service(ROWS, _FastLLM())
        before = dict(vars(service))
        self._retrieve(app, service, saved, history=HISTORY, options=FULL)
        assert vars(service) == before

    def test_concurrent_retrievals_in_one_turn_do_not_cross(self, app, saved):
        # Two generators ground themselves at once on the shared service.
        service = _service(ROWS, _FastLLM())
        errors: list[BaseException] = []

        def work(query: str) -> None:
            try:
                with (
                    app.app_context(),
                    tracing.span(tracing.KIND_TOOL, f"tool:{query}"),
                ):
                    service.retrieve(
                        "u1", query, MEDIA, history=HISTORY, options=FULL
                    )
            except BaseException as exc:  # noqa: BLE001
                errors.append(exc)

        _start()
        threads = [
            threading.Thread(target=tracing.carry(work), args=(query,))
            for query in ("first one", "second one")
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(5)
        assert errors == []
        assert _slots() == []
        tracing.finish_turn()
        spans = saved["spans"]
        retrieves = _named(spans, "retrieve", "retrieval")
        assert len(retrieves) == 2
        for retrieve in retrieves:
            tool = next(s for s in spans if s["id"] == retrieve["parent_id"])
            assert tool["name"] == f"tool:{retrieve['input']['query']}"
            kids = [s for s in spans if s["parent_id"] == retrieve["id"]]
            assert [
                k["name"] for k in sorted(kids, key=lambda s: s["seq"])
            ] == [
                "rewrite",
                "embed",
                "search",
                "rerank",
            ]
            rewrite = next(k for k in kids if k["name"] == "rewrite")
            assert rewrite["input"]["query"] == retrieve["input"]["query"]
            assert len(_one(kids, "search")["output"]["variants"]) == 2


# ---------------------------------------------------- retrieval decorators


class _Opts:
    rerank = "llm"
    rerank_timeout_s = 1.0
    multi_query = False
    hybrid = True
    vector_candidates = 4
    fts_candidates = 6


class TestRetrievalDecorators:
    def test_the_service_mirrors_the_rerank_mode_constant(self):
        assert retrieval_trace.RERANK_LLM == retrieval_module.RERANK_LLM

    def test_decorated_methods_keep_their_identity(self):
        for name in (
            "retrieve",
            "_rewrite",
            "_search_all",
            "_search",
            "_rerank",
        ):
            method = getattr(RetrievalService, name)
            assert method.__name__ == name
            assert method.__doc__
            assert method.__wrapped__.__name__ == name
        assert ground_generator.__name__ == "ground_generator"
        assert ground_generator.__wrapped__.__doc__ == ground_generator.__doc__

    @pytest.mark.parametrize(
        "decorator",
        [
            retrieval_trace.retrieve,
            retrieval_trace.rewrite,
            retrieval_trace.search,
            retrieval_trace.search_variant,
            retrieval_trace.rerank,
            retrieval_trace.grounding,
        ],
    )
    def test_pass_through_with_tracing_off(self, decorator, saved):
        calls: list[tuple] = []
        marker = object()

        @decorator
        def step(*args, **kwargs):
            calls.append((args, kwargs))
            return marker

        assert step(1, "two", key=3) is marker
        assert calls == [((1, "two"), {"key": 3})]
        assert "spans" not in saved

    @pytest.mark.parametrize(
        "decorator",
        [
            retrieval_trace.retrieve,
            retrieval_trace.rewrite,
            retrieval_trace.search,
            retrieval_trace.search_variant,
            retrieval_trace.rerank,
            retrieval_trace.grounding,
        ],
    )
    @pytest.mark.parametrize("traced", [False, True])
    def test_the_wrapped_exception_propagates_unchanged(
        self, decorator, traced, saved
    ):
        error = KeyError("the step's own failure")

        @decorator
        def step(*_args, **_kwargs):
            raise error

        if traced:
            _start()
        with pytest.raises(KeyError) as caught:
            step("odd", arguments="the step never declared")
        assert caught.value is error
        if traced:
            assert _slots() == []
            tracing.event(tracing.KIND_DECISION, "after")
            tracing.finish_turn()
            spans = saved["spans"]
            # Whatever span the step had is closed, and nothing is current.
            assert all(s["status"] != "running" for s in spans)
            assert _one(spans, "after")["parent_id"] == spans[0]["id"]

    @pytest.mark.parametrize(
        "decorator",
        [
            retrieval_trace.retrieve,
            retrieval_trace.rewrite,
            retrieval_trace.search,
            retrieval_trace.search_variant,
            retrieval_trace.rerank,
            retrieval_trace.grounding,
        ],
    )
    def test_unexpected_arguments_and_results_never_raise(
        self, decorator, saved
    ):
        # The bookkeeping understands none of this; the call still works.
        marker = object()

        @decorator
        def step(*_args, **_kwargs):
            return marker

        _start()
        assert step(None, 5, nonsense=object()) is marker
        assert _slots() == []
        tracing.event(tracing.KIND_DECISION, "after")
        tracing.finish_turn()
        assert (
            _one(saved["spans"], "after")["parent_id"]
            == saved["spans"][0]["id"]
        )

    def test_works_under_staticmethod(self, saved):
        class Holder:
            @staticmethod
            @retrieval_trace.rerank
            def step(query, chunks, opts, diag):
                diag["reranked"] = False
                return chunks

        assert Holder.step("q", [], _Opts(), {}) == []
        _start()
        assert Holder().step("q", [], _Opts(), {}) == []
        tracing.finish_turn()
        rerank = _one(saved["spans"], "rerank", "retrieval")
        assert rerank["input"] == {
            "query": "q",
            "candidates": [],
            "timeout_s": 1.0,
        }

    def test_rerank_call_is_the_function_itself_with_tracing_off(self):
        def call() -> dict:
            return {"scores": []}

        assert retrieval_trace.rerank_call(call) is call

    def test_rerank_call_keeps_result_and_exception(self, saved):
        _start()
        error = RuntimeError("down")

        @retrieval_trace.rerank_call
        def ok(value: int) -> int:
            return value + 1

        @retrieval_trace.rerank_call
        def bad() -> None:
            raise error

        assert ok.__name__ == "ok"
        assert ok(1) == 2
        with pytest.raises(RuntimeError) as caught:
            bad()
        assert caught.value is error
        tracing.finish_turn()

    def test_search_variant_outside_a_search_records_nothing(self, app, saved):
        service = _service(ROWS)
        _start()
        with app.app_context():
            rows = service._search(
                [0.1], "", "u1", ["m1"], RetrievalOptions(), {}
            )
        tracing.finish_turn()
        assert rows == ROWS
        assert _named(saved["spans"], "search") == []

    def test_stage_called_on_its_own_is_recorded_under_the_current_span(
        self, app, saved
    ):
        # Without a surrounding ``retrieve`` there is nothing to update.
        service = _service(ROWS)
        _start()
        with app.app_context():
            result = service._rewrite(
                "q",
                None,
                {"m1": "n.pdf"},
                RetrievalOptions(multi_query=False),
                {},
            )
        tracing.finish_turn()
        assert result.query == "q"
        rewrite = _one(saved["spans"], "rewrite", "retrieval")
        assert rewrite["parent_id"] == saved["spans"][0]["id"]
        assert rewrite["status"] == "skipped"

    @pytest.mark.parametrize(
        "broken",
        [
            "_retrieve_output",
            "_chunk_refs",
            "_search_input",
            "_rerank_output",
            "_rerank_scores",
            "_key",
        ],
    )
    def test_a_fault_in_the_bookkeeping_never_reaches_the_caller(
        self, broken, app, saved, monkeypatch
    ):
        def run() -> RetrievalResult:
            with app.app_context():
                return _service(ROWS, _FastLLM()).retrieve(
                    "u1", "simpler please", MEDIA, history=HISTORY, options=FULL
                )

        plain = run()

        def boom(*_a: Any, **_k: Any) -> Any:
            raise RuntimeError("tracing bug")

        monkeypatch.setattr(retrieval_trace, broken, boom)
        _start()
        traced = run()
        tracing.event(tracing.KIND_DECISION, "after")
        tracing.finish_turn()
        assert [c.id for c in traced.chunks] == [c.id for c in plain.chunks]
        assert traced.context_text == plain.context_text
        assert traced.query_used == plain.query_used
        spans = saved["spans"]
        # Every span was closed and the position returned to the root, so
        # later steps of the turn are not mis-nested.
        retrieve = _one(spans, "retrieve", "retrieval")
        assert retrieve["status"] == "ok"
        assert _one(spans, "after")["parent_id"] == spans[0]["id"]
        for name in ("rewrite", "rerank"):
            assert _one(spans, name, "retrieval")["parent_id"] == retrieve["id"]
        for span in _named(spans, "search"):
            assert span["status"] == "ok"
            assert span["parent_id"] == retrieve["id"]


# ------------------------------------------------------------- grounding

INDEXED = {
    "id": "a",
    "processing_status": "ready",
    "chunk_count": 9,
    "mime_type": "application/pdf",
    "file_name": "n.pdf",
}
IMAGE = {
    "id": "b",
    "processing_status": "ready",
    "chunk_count": 0,
    "mime_type": "image/png",
    "file_name": "d.png",
}


def _ctx(**kw) -> ToolContext:
    base: dict[str, Any] = {
        "user_id": "u",
        "session_id": "s",
        "message": "m",
        "enriched_message": "m",
        "media_ids": None,
    }
    base.update(kw)
    return ToolContext(**base)


def _excerpt() -> Excerpt:
    return Excerpt(
        media_id="a",
        document_name="n.pdf",
        content="excerpt body",
        page_number=1,
        section="Sec",
        chunk_ids=("c1",),
        first_index=0,
        last_index=0,
        score=0.5,
        similarity=0.9,
    )


def _retrieved(context: str) -> RetrievalResult:
    return RetrievalResult(
        chunks=[],
        excerpts=[_excerpt()] if context else [],
        sources=[],
        context_text=context,
        allowed_markers=set(),
        query_used="q",
        diagnostics={"mode": "hybrid"},
    )


def _supabase() -> MagicMock:
    supabase = MagicMock()
    supabase.get_media.side_effect = lambda mid, _u: {
        "a": INDEXED,
        "b": IMAGE,
    }[mid]
    return supabase


def _real_retrieval(rows: list[dict]) -> RetrievalService:
    """The real (decorated) service over fake search results."""
    return _service([{**row, "media_id": "a"} for row in rows])


class TestGroundingDecision:
    def _ground(
        self,
        saved,
        ctx,
        *,
        retrieval: Any = None,
        context: str = "",
        wants_media: bool = True,
        topic: str = "t",
    ):
        if retrieval is None:
            retrieval = MagicMock()
            retrieval.retrieve.return_value = _retrieved(context)
        _start()
        with (
            Flask(__name__).app_context(),
            patch(
                "aeva.media.grounding.download_attachments",
                return_value=[{"mime_type": "image/png", "data": b"x" * 9}],
            ),
            tracing.span(tracing.KIND_TOOL, "quiz_generator"),
        ):
            grounding = ground_generator(
                ctx,
                topic=topic,
                wants_media=wants_media,
                supabase=_supabase(),
                retrieval=retrieval,
            )
            assert _slots() == []
        tracing.finish_turn()
        return grounding, _one(saved["spans"], "grounding", "decision")

    def test_prior_agent_output_wins(self, saved):
        ctx = _ctx(
            media_ids=["a"],
            prior_results=[PriorResult(tool="web_search", text="Summary")],
        )
        grounding, row = self._ground(saved, ctx)
        assert grounding.from_prior
        assert row["parent_id"] == _one(saved["spans"], "quiz_generator")["id"]
        assert row["output"]["source"] == "prior_output"
        assert row["output"]["retrieval_query"] is None
        assert row["output"]["source_context_chars"] == len(
            grounding.source_context
        )
        assert row["output"]["prior_text_chars"] == len("Summary")
        assert row["output"]["files"] == {}
        assert row["input"] == {
            "topic": "t",
            "wants_media": True,
            "media_ids": ["a"],
            "prior_results": ["web_search"],
        }
        assert "produced text" in row["meta"]["reason"]

    @pytest.mark.parametrize("text", ["", "   \n"])
    def test_empty_prior_hand_off_is_called_empty(self, saved, text):
        # An earlier agent that produced nothing still wins (the block is a
        # bare header); the trace must not claim it "produced text".
        ctx = _ctx(
            media_ids=["a"],
            prior_results=[PriorResult(tool="general", text=text)],
        )
        grounding, row = self._ground(saved, ctx)
        assert grounding.from_prior
        assert grounding.source_context
        assert row["output"]["source"] == "prior_output"
        assert row["output"]["prior_text_chars"] == 0
        assert row["output"]["source_context_chars"] == len(
            grounding.source_context
        )
        assert row["meta"]["reason"] == (
            "An earlier agent ran but produced no text; its empty hand-off "
            "still replaced the student's files."
        )

    def test_retrieved_excerpts_through_the_real_service(self, saved):
        grounding, row = self._ground(
            saved,
            _ctx(media_ids=["a", "b"]),
            retrieval=_real_retrieval(ROWS),
            topic="quiz from this pdf",
        )
        spans = saved["spans"]
        tool = _one(spans, "quiz_generator", "tool")
        retrieve = _one(spans, "retrieve", "retrieval")
        assert retrieve["parent_id"] == tool["id"] == row["parent_id"]
        assert retrieve["seq"] < row["seq"]
        assert retrieve["input"]["options"]["rerank"] == "none"
        out = row["output"]
        assert grounding.source_context
        assert out["source"] == "retrieved_excerpts"
        assert out["retrieval_query"] == COVERAGE_QUERY
        assert out["source_context_chars"] == len(grounding.source_context)
        assert out["prior_text_chars"] == 0
        assert out["attachments"] == 1
        assert out["files"] == {
            "indexed": ["n.pdf"],
            "attached": [{"mime_type": "image/png", "bytes": 9}],
        }
        assert out["source_media_ids"] == ["a", "b"]
        assert out["grounded"] is True
        # Neither attachment bytes nor excerpt text enter the decision.
        dumped = json.dumps(row)
        assert "xxxxxxxxx" not in dumped
        assert "SECRET TEXT" not in dumped

    def test_retrieved_excerpts_from_an_uninstrumented_retrieval(self, saved):
        # A retrieval that is not the decorated service (a test double):
        # the decision is still right, only the file names are unknown.
        _grounding, row = self._ground(
            saved, _ctx(media_ids=["a", "b"]), context="[1] excerpt"
        )
        out = row["output"]
        assert out["source"] == "retrieved_excerpts"
        assert out["retrieval_query"] is None
        assert out["files"]["indexed"] == []
        assert out["attachments"] == 1

    def test_whole_files_when_retrieval_is_empty(self, saved):
        _grounding, row = self._ground(
            saved,
            _ctx(media_ids=["a"]),
            retrieval=_real_retrieval([]),
            topic="osmosis",
        )
        out = row["output"]
        assert out["source"] == "whole_files"
        assert out["retrieval_query"] == "osmosis"
        assert out["source_context_chars"] == 0
        assert out["files"]["indexed"] == ["n.pdf"]
        assert len(out["files"]["attached"]) == 1
        assert row["meta"]["reason"].startswith("Retrieval found nothing")

    def test_whole_files_when_nothing_is_indexed(self, saved):
        retrieval = MagicMock()
        _grounding, row = self._ground(
            saved, _ctx(media_ids=["b"]), retrieval=retrieval
        )
        retrieval.retrieve.assert_not_called()
        assert row["output"]["source"] == "whole_files"
        assert row["output"]["retrieval_query"] is None
        assert row["output"]["files"]["indexed"] == []
        assert row["meta"]["reason"].startswith("Nothing in scope is indexed")

    def test_none_when_files_are_not_wanted(self, saved):
        grounding, row = self._ground(
            saved, _ctx(media_ids=["a"]), wants_media=False
        )
        assert not grounding.grounded
        assert row["output"]["source"] == "none"
        assert row["output"]["grounded"] is False
        assert row["output"]["files"] == {}
        assert "not asked to use files" in row["meta"]["reason"]

    def test_none_when_no_files_are_in_scope(self, saved):
        _grounding, row = self._ground(saved, _ctx(media_ids=None))
        assert row["output"]["source"] == "none"
        assert row["meta"]["reason"] == (
            "No prior agent output and no files in scope."
        )

    def test_a_failing_grounding_raises_and_records_no_decision(self, saved):
        supabase = MagicMock()
        supabase.get_media.side_effect = ConnectionError("db")
        _start()
        with (
            Flask(__name__).app_context(),
            pytest.raises(ConnectionError, match="db"),
        ):
            ground_generator(
                _ctx(media_ids=["a"]),
                topic="t",
                wants_media=True,
                supabase=supabase,
                retrieval=MagicMock(),
            )
        assert _slots() == []
        tracing.finish_turn()
        assert _named(saved["spans"], "grounding") == []

    def test_same_grounding_with_tracing_off(self, saved):
        def run() -> Any:
            with (
                Flask(__name__).app_context(),
                patch(
                    "aeva.media.grounding.download_attachments",
                    return_value=[{"mime_type": "image/png", "data": b"x" * 9}],
                ),
            ):
                return ground_generator(
                    _ctx(media_ids=["a", "b"]),
                    topic="osmosis",
                    wants_media=True,
                    supabase=_supabase(),
                    retrieval=_real_retrieval(ROWS),
                )

        plain = run()
        assert "spans" not in saved
        _start()
        traced = run()
        tracing.finish_turn()
        assert plain.source_context == traced.source_context
        assert plain.attachments == traced.attachments
        assert plain.from_media is traced.from_media is True
        assert plain.source_media_ids == traced.source_media_ids

    def test_a_fault_in_the_bookkeeping_never_reaches_the_caller(
        self, saved, monkeypatch
    ):
        def boom(*_a: Any, **_k: Any) -> Any:
            raise RuntimeError("tracing bug")

        monkeypatch.setattr(retrieval_trace, "_grounding_reason", boom)
        _start()
        with Flask(__name__).app_context():
            grounding = ground_generator(
                _ctx(media_ids=None),
                topic="t",
                wants_media=True,
                supabase=MagicMock(),
                retrieval=MagicMock(),
            )
        tracing.event(tracing.KIND_DECISION, "after")
        tracing.finish_turn()
        assert not grounding.grounded
        assert _named(saved["spans"], "grounding") == []
        assert (
            _one(saved["spans"], "after")["parent_id"]
            == saved["spans"][0]["id"]
        )
