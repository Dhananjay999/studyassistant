"""Generator grounding: prior output > retrieved excerpts > whole files."""

from unittest.mock import MagicMock, patch

from flask import Flask

from aeva.mcp.base import PriorResult, ToolContext
from aeva.media.grounding import (
    COVERAGE_QUERY,
    ground_generator,
    retrieval_query,
)
from aeva.media.retrieval import RetrievalResult


def _ctx(**kw) -> ToolContext:
    base = {
        "user_id": "u", "session_id": "s", "message": "m",
        "enriched_message": "m", "media_ids": ["a", "b"],
    }
    base.update(kw)
    return ToolContext(**base)


def _result(context: str) -> RetrievalResult:
    return RetrievalResult(
        chunks=[], excerpts=[object()] if context else [], sources=[],
        context_text=context, allowed_markers=set(), query_used="q",
        diagnostics={"mode": "hybrid"},
    )


INDEXED = {"id": "a", "processing_status": "ready", "chunk_count": 9,
           "mime_type": "application/pdf", "file_name": "n.pdf"}
IMAGE = {"id": "b", "processing_status": "ready", "chunk_count": 0,
         "mime_type": "image/png", "file_name": "d.png"}


class TestQuery:
    def test_generic_topics_use_coverage_query(self):
        assert retrieval_query("") == COVERAGE_QUERY
        assert retrieval_query("create a quiz from this pdf") == COVERAGE_QUERY
        assert retrieval_query("my uploaded notes") == COVERAGE_QUERY

    def test_specific_topic_is_kept(self):
        assert retrieval_query("osmosis in plant cells") == "osmosis in plant cells"


class TestGrounding:
    def test_prior_results_win(self):
        ctx = _ctx(prior_results=[PriorResult(tool="web_search", text="Summary")])
        with Flask(__name__).app_context():
            g = ground_generator(ctx, topic="t", wants_media=True,
                                 supabase=MagicMock(), retrieval=MagicMock())
        assert g.from_prior
        assert "Summary" in g.source_context
        assert g.attachments is None

    def test_no_media_no_grounding(self):
        with Flask(__name__).app_context():
            g = ground_generator(_ctx(), topic="t", wants_media=False,
                                 supabase=MagicMock(), retrieval=MagicMock())
        assert not g.grounded

    def test_indexed_docs_are_retrieved_images_attached(self):
        supabase = MagicMock()
        supabase.get_media.side_effect = lambda mid, _u: {"a": INDEXED, "b": IMAGE}[mid]
        retrieval = MagicMock()
        retrieval.retrieve.return_value = _result("[1] excerpt")
        with Flask(__name__).app_context(), patch(
            "aeva.media.grounding.download_attachments",
            return_value=[{"mime_type": "image/png", "data": b"x"}],
        ) as download:
            g = ground_generator(_ctx(), topic="quiz from this pdf", wants_media=True,
                                 supabase=supabase, retrieval=retrieval)
        args, kwargs = retrieval.retrieve.call_args
        assert args[1] == COVERAGE_QUERY
        assert [r["id"] for r in args[2]] == ["a"]
        opts = kwargs["options"]
        assert opts.top_k == 16
        assert opts.rerank == "none"
        assert opts.multi_query is False
        assert opts.min_similarity == 0.0
        # Only the image is attached whole.
        assert download.call_args.args[3] == ["b"]
        assert "[1] excerpt" in g.source_context
        assert g.from_media
        assert g.source_media_ids == ["a", "b"]

    def test_empty_retrieval_falls_back_to_whole_files(self):
        supabase = MagicMock()
        supabase.get_media.side_effect = lambda _m, _u: INDEXED
        retrieval = MagicMock()
        retrieval.retrieve.return_value = _result("")
        with Flask(__name__).app_context(), patch(
            "aeva.media.grounding.download_attachments",
            return_value=[{"mime_type": "application/pdf", "data": b"x"}],
        ) as download:
            g = ground_generator(_ctx(media_ids=["a"]), topic="osmosis",
                                 wants_media=True, supabase=supabase, retrieval=retrieval)
        assert download.call_args.args[3] == ["a"]
        assert g.source_context == ""
        assert g.attachments
