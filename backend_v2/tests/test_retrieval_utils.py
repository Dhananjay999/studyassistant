"""Pure retrieval helpers: fusion, thresholds, quotas, merging, context."""

from typing import ClassVar

from aeva.media.retrieval_utils import (
    ORIGIN_NEIGHBOR,
    RetrievedChunk,
    apply_threshold,
    build_context,
    diversify_by_document,
    fts_query,
    merge_neighbors,
    needs_rewrite,
    rrf_fuse,
)


def _chunk(
    cid: str,
    *,
    media: str = "m1",
    index: int = 0,
    sim: float = 0.5,
    score: float = 0.0,
    text_rank: int | None = None,
    content: str | None = None,
    page: int | None = 1,
    section: str | None = "Intro",
) -> RetrievedChunk:
    return RetrievedChunk(
        id=cid,
        media_id=media,
        document_name=f"{media}.pdf",
        chunk_index=index,
        content=content or f"content of {cid}",
        page_number=page,
        section=section,
        similarity=sim,
        score=score,
        text_rank=text_rank,
    )


class TestRrfFuse:
    def test_shared_top_ids_win(self):
        fused = rrf_fuse([["a", "b", "c"], ["b", "a", "d"]], k=60)
        ordered = sorted(fused, key=fused.get, reverse=True)
        assert ordered[:2] == ["a", "b"] or ordered[:2] == ["b", "a"]
        assert fused["a"] > fused["c"]
        assert fused["d"] < fused["b"]

    def test_single_list_keeps_order(self):
        fused = rrf_fuse([["x", "y"]])
        assert fused["x"] > fused["y"]


class TestApplyThreshold:
    def test_drops_weak_keeps_strong(self):
        chunks = [_chunk("a", sim=0.9), _chunk("b", sim=0.3), _chunk("c", sim=0.5)]
        kept = apply_threshold(
            chunks, min_similarity=0.4, floor_similarity=0.25, min_results=1
        )
        assert [c.id for c in kept] == ["a", "c"]

    def test_tops_up_to_min_results_from_floor(self):
        chunks = [_chunk("a", sim=0.9), _chunk("b", sim=0.3), _chunk("c", sim=0.1)]
        kept = apply_threshold(
            chunks, min_similarity=0.4, floor_similarity=0.25, min_results=2
        )
        assert [c.id for c in kept] == ["a", "b"]

    def test_keyword_hit_survives_low_similarity(self):
        chunks = [_chunk("a", sim=0.9), _chunk("b", sim=0.1, text_rank=1)]
        kept = apply_threshold(
            chunks, min_similarity=0.4, floor_similarity=0.25, min_results=1
        )
        assert [c.id for c in kept] == ["a", "b"]


class TestDiversify:
    def test_each_document_gets_a_slot(self):
        chunks = [
            _chunk("a1", media="A", score=0.9),
            _chunk("a2", media="A", score=0.8),
            _chunk("a3", media="A", score=0.7),
            _chunk("b1", media="B", score=0.1),
        ]
        picked = diversify_by_document(chunks, top_k=3, per_doc_min=1)
        assert [c.id for c in picked] == ["a1", "a2", "b1"]

    def test_zero_top_k(self):
        assert diversify_by_document([_chunk("a")], top_k=0) == []


class TestMergeNeighbors:
    def test_contiguous_run_merges_and_trims_overlap(self):
        hit = _chunk("h", index=2, score=0.9, content="AAAA" * 20 + " tail text here")
        overlap = hit.content[-24:]
        nxt = _chunk(
            "n", index=3, content=overlap + " continues the thought"
        )
        nxt = RetrievedChunk(**{**nxt.__dict__, "origin": ORIGIN_NEIGHBOR})
        gap = _chunk("g", index=7, content="far away")
        excerpts = merge_neighbors([hit], [nxt, gap], overlap_chars=24)
        assert len(excerpts) == 2
        merged = excerpts[0]
        assert merged.chunk_ids == ("h", "n")
        assert merged.content.count("tail text here") == 1
        assert merged.content.endswith("continues the thought")
        assert merged.score == 0.9
        assert excerpts[1].chunk_ids == ("g",)

    def test_documents_never_merge_across(self):
        a = _chunk("a", media="A", index=1, score=0.5)
        b = _chunk("b", media="B", index=2, score=0.6)
        excerpts = merge_neighbors([a, b], [], overlap_chars=0)
        assert [e.chunk_ids for e in excerpts] == [("b",), ("a",)]


class TestFtsQuery:
    def test_or_joins_content_words_and_quotes_keywords(self):
        q = fts_query("What is the CPCB's role in pollution?", ["Central Board"])
        assert q.startswith('"Central Board" OR ')
        assert "CPCB's" in q
        assert " what " not in q.lower()

    def test_empty(self):
        assert fts_query("the of and") == ""


class TestBuildContext:
    def test_markers_and_budget(self):
        from aeva.media.retrieval_utils import Excerpt

        excerpts = [
            Excerpt("m1", "notes.pdf", "x" * 100, 3, "Ch 1", ("c1",), 0, 0, 0.9, 0.9),
            Excerpt("m2", "book.pdf", "y" * 100, None, None, ("c2",), 5, 5, 0.5, 0.5),
        ]
        text, sources, markers = build_context(excerpts, max_chars=10_000)
        assert text.startswith(
            '[1] (notes.pdf, p.3, "Ch 1") — cite as [cite:notes.pdf#3]'
        )
        assert "[2] (book.pdf) — cite as [cite:book.pdf]" in text
        assert markers == {"[cite:notes.pdf#3]", "[cite:notes.pdf]", "[cite:book.pdf]"}
        assert sources[0]["chunk_id"] == "c1"
        assert sources[1]["page_number"] is None

    def test_budget_truncates_but_keeps_first(self):
        from aeva.media.retrieval_utils import Excerpt

        excerpts = [
            Excerpt("m1", "a.pdf", "z" * 500, 1, None, ("c1",), 0, 0, 1, 1),
            Excerpt("m1", "a.pdf", "z" * 500, 2, None, ("c2",), 1, 1, 1, 1),
        ]
        text, sources, _ = build_context(excerpts, max_chars=200)
        assert len(sources) == 1
        assert text.endswith("[…]")


class TestNeedsRewrite:
    history: ClassVar[list[dict[str, str]]] = [
        {"role": "user", "content": "explain osmosis"}
    ]

    def test_no_history_never_rewrites(self):
        assert needs_rewrite("explain it", None) is False

    def test_short_followup(self):
        assert needs_rewrite("explain it simpler", self.history) is True

    def test_pronoun_reference(self):
        msg = "can you give me three more examples of that process please"
        assert needs_rewrite(msg, self.history) is True

    def test_long_standalone(self):
        msg = (
            "What are the differences between mitosis and meiosis in terms "
            "of chromosome number and genetic variation?"
        )
        assert needs_rewrite(msg, self.history) is False
