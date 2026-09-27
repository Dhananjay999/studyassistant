"""RetrievalService pipeline with mocked Supabase + LLM clients."""

import time
from typing import Any
from unittest.mock import MagicMock

import pytest
from flask import Flask

from aeva.media.retrieval import RetrievalOptions, RetrievalService


def _row(cid: str, media: str, index: int, sim: float, **extra: Any) -> dict:
    return {
        "id": cid,
        "media_id": media,
        "chunk_index": index,
        "content": f"text {cid}",
        "page_number": index + 1,
        "section": "Sec",
        "similarity": sim,
        "rrf_score": 1 / (60 + index + 1),
        **extra,
    }


@pytest.fixture
def app() -> Flask:
    app = Flask(__name__)
    app.config.update(RAG_TOP_K=3, RAG_MULTI_QUERY=False, RAG_RERANK="none")
    return app


def _service(rows: list[dict], *, rpc_raises: bool = False) -> tuple[RetrievalService, MagicMock]:
    supabase = MagicMock()
    if rpc_raises:
        supabase.search_chunks_hybrid.side_effect = RuntimeError("no function")
    else:
        supabase.search_chunks_hybrid.return_value = rows
    supabase.match_chunks.return_value = rows
    supabase.fetch_adjacent_chunks.return_value = []
    supabase.list_chunk_sections.return_value = [{"section": "Sec"}]
    embed = MagicMock()
    embed.embed.return_value = [[0.1, 0.2]]
    rewrite = MagicMock()
    return RetrievalService(supabase=supabase, embed_llm=embed, rewrite_llm=rewrite), supabase


class TestPipeline:
    def test_hybrid_call_and_diagnostics(self, app: Flask):
        rows = [
            _row("a", "m1", 0, 0.9, vector_rank=1, text_rank=1, exact_scan=True),
            _row("b", "m1", 4, 0.6, vector_rank=2),
            _row("c", "m2", 0, 0.2),
        ]
        service, supabase = _service(rows)
        with app.app_context():
            result = service.retrieve(
                "u1", "what is osmosis", [{"id": "m1", "file_name": "n.pdf"}, {"id": "m2", "file_name": "b.pdf"}]
            )
        kwargs = supabase.search_chunks_hybrid.call_args.kwargs
        args = supabase.search_chunks_hybrid.call_args.args
        assert args[1].startswith("osmosis")
        assert args[2] == "u1"
        assert args[3] == ["m1", "m2"]
        assert kwargs["top_k"] == 24
        d = result.diagnostics
        assert d["mode"] == "hybrid"
        assert d["exact_scan"] is True
        assert d["candidates"] == 3
        # c (0.2) is below the floor; a and b stay.
        assert d["kept"] == 2
        assert [c.id for c in result.chunks] == ["a", "b"]
        assert result.chunks[0].origin == "both"
        assert "[cite:n.pdf#1]" in result.allowed_markers
        assert d["rewritten"] is False
        assert not result.is_empty()

    def test_vector_fallback_when_rpc_missing(self, app: Flask):
        rows = [_row("a", "m1", 0, 0.9)]
        service, supabase = _service(rows, rpc_raises=True)
        with app.app_context():
            result = service.retrieve("u1", "q", [{"id": "m1", "file_name": "n.pdf"}])
        assert result.diagnostics["mode"] == "vector_fallback"
        supabase.match_chunks.assert_called_once()
        # Second call skips the RPC entirely.
        with app.app_context():
            service.retrieve("u1", "q", [{"id": "m1", "file_name": "n.pdf"}])
        assert supabase.search_chunks_hybrid.call_count == 1

    def test_empty_result_lists_coverage(self, app: Flask):
        service, _ = _service([])
        with app.app_context():
            result = service.retrieve("u1", "q", [{"id": "m1", "file_name": "n.pdf"}])
        assert result.is_empty()
        assert result.coverage == ["Sec"]

    def test_rewrite_failure_falls_back(self, app: Flask):
        rows = [_row("a", "m1", 0, 0.9)]
        service, _ = _service(rows)
        service.rewrite_llm.generate_structured.side_effect = RuntimeError("boom")
        history = [{"role": "user", "content": "explain osmosis"}]
        with app.app_context():
            result = service.retrieve(
                "u1", "simpler please", [{"id": "m1", "file_name": "n.pdf"}], history=history
            )
        assert result.query_used == "simpler please"
        assert result.diagnostics["rewritten"] is False

    def test_rewrite_resolves_followup(self, app: Flask):
        rows = [_row("a", "m1", 0, 0.9)]
        service, _ = _service(rows)
        service.rewrite_llm.generate_structured.return_value = {
            "standalone_query": "explain osmosis simply",
            "keywords": ["osmosis"],
            "paraphrases": ["x", "y"],
            "is_followup": True,
        }
        history = [{"role": "user", "content": "explain osmosis"}]
        with app.app_context():
            result = service.retrieve(
                "u1", "simpler please", [{"id": "m1", "file_name": "n.pdf"}], history=history
            )
        assert result.query_used == "explain osmosis simply"
        assert result.diagnostics["keywords"] == ["osmosis"]
        # multi-query off in this app config -> no paraphrases embedded
        assert result.diagnostics["query_variants"] == 1

    def test_rerank_timeout_keeps_order(self, app: Flask):
        rows = [_row("a", "m1", 0, 0.9), _row("b", "m1", 3, 0.8)]
        service, _ = _service(rows)

        def slow(*_a: Any, **_k: Any) -> dict:
            time.sleep(0.3)
            return {"scores": [{"index": 1, "score": 10}, {"index": 0, "score": 1}]}

        service.rewrite_llm.generate_structured.side_effect = slow
        opts = RetrievalOptions(top_k=2, multi_query=False, rerank="llm", rerank_timeout_s=0.05)
        with app.app_context():
            result = service.retrieve("u1", "q", [{"id": "m1", "file_name": "n.pdf"}], options=opts)
        assert [c.id for c in result.chunks] == ["a", "b"]
        assert result.diagnostics["reranked"] is False
        assert result.diagnostics["rerank_timeout"] is True

    def test_rerank_reorders(self, app: Flask):
        rows = [_row("a", "m1", 0, 0.9), _row("b", "m1", 3, 0.8)]
        service, _ = _service(rows)
        service.rewrite_llm.generate_structured.return_value = {
            "scores": [{"index": 1, "score": 9}, {"index": 0, "score": 2}]
        }
        opts = RetrievalOptions(top_k=2, multi_query=False, rerank="llm", rerank_timeout_s=2)
        with app.app_context():
            result = service.retrieve("u1", "q", [{"id": "m1", "file_name": "n.pdf"}], options=opts)
        assert [c.id for c in result.chunks] == ["b", "a"]
        assert result.diagnostics["reranked"] is True
