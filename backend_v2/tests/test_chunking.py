"""Chunker contracts: splitting, tables, context headers, raw round-trip."""

from aeva.media.chunking import (
    EMBEDDING_VERSION,
    build_context_header,
    chunk_parsed_document,
    split_long_text,
)
from aeva.media.llamaparse_service import (
    LlamaParseService,
    ParsedDocument,
    ParsedPage,
)


def _doc(pages: list[ParsedPage]) -> ParsedDocument:
    return ParsedDocument(
        pages=pages,
        markdown="",
        text="",
        page_count=len(pages),
        raw={},
    )


def _sentences(n: int, width: int = 60) -> str:
    return " ".join(f"Sentence number {i} " + "x" * (width - 20) + "." for i in range(n))


class TestSplitLongText:
    def test_short_text_untouched(self):
        assert split_long_text("hello world.", 100, 10) == ["hello world."]

    def test_pieces_respect_limit_and_overlap(self):
        text = _sentences(30)
        pieces = split_long_text(text, max_chars=400, overlap_chars=40)
        assert len(pieces) > 1
        assert all(len(p) <= 400 for p in pieces)
        # Every sentence survives somewhere.
        assert all(f"Sentence number {i} " in text for i in range(30))
        joined = "\n".join(pieces)
        assert all(f"Sentence number {i} " in joined for i in range(30))
        # Consecutive pieces share a tail/head (overlap).
        assert pieces[1].startswith(pieces[0][-40:].split(" ", 1)[-1][:10]) or (
            pieces[0][-40:] in pieces[1]
        )

    def test_monster_sentence_hard_cut(self):
        text = "a" * 1000
        pieces = split_long_text(text, max_chars=300, overlap_chars=20)
        assert all(len(p) <= 300 for p in pieces)
        assert "".join(p for p in pieces).count("a") >= 1000


class TestChunkDocument:
    def test_oversized_page_is_split_with_headers(self):
        page = ParsedPage(page_number=1, text=_sentences(80), markdown="", items=[])
        chunks = chunk_parsed_document(
            _doc([page]),
            target_tokens=100,
            overlap_tokens=10,
            max_tokens=120,
            file_name="notes.pdf",
        )
        assert len(chunks) > 1
        assert all(len(c.content) <= 120 * 4 for c in chunks)
        assert all(c.context.startswith("notes.pdf") for c in chunks)
        assert all(c.embed_text.startswith("notes.pdf | p.1\n") for c in chunks)
        assert [c.chunk_index for c in chunks] == list(range(len(chunks)))

    def test_heading_resets_and_seeds_section(self):
        items = [
            {"type": "heading", "lvl": 1, "value": "Chapter 3"},
            {"type": "text", "value": "Scheduling basics."},
            {"type": "heading", "lvl": 2, "value": "Round robin"},
            {"type": "text", "value": "Each process gets a time slice."},
        ]
        page = ParsedPage(page_number=4, text="", markdown="", items=items)
        chunks = chunk_parsed_document(_doc([page]), file_name="os.pdf")
        assert [c.section for c in chunks] == ["Chapter 3", "Chapter 3 > Round robin"]
        assert chunks[1].context == "os.pdf | Chapter 3 > Round robin | p.4"
        assert chunks[0].content.startswith("Chapter 3")

    def test_small_table_whole_large_table_split_with_header(self):
        header = "col a | col b"
        rows = [f"row {i} | value {i}" for i in range(200)]
        table = {"type": "table", "value": "\n".join([header, *rows])}
        page = ParsedPage(page_number=2, text="", markdown="", items=[table])
        whole = chunk_parsed_document(_doc([page]), table_max_chars=100_000)
        assert len(whole) == 1
        split = chunk_parsed_document(_doc([page]), table_max_chars=800)
        assert len(split) > 1
        assert all(c.content.startswith(header) for c in split)
        assert all(len(c.content) <= 800 for c in split)

    def test_embedding_version_constant(self):
        assert EMBEDDING_VERSION >= 2


class TestHeaderAndRaw:
    def test_header_parts(self):
        assert build_context_header("a.pdf", None, None) == "a.pdf"
        assert build_context_header("a.pdf", "S", 3) == "a.pdf | S | p.3"
        assert build_context_header("", "S", None) == "S"

    def test_normalize_raw_round_trip(self):
        raw = {
            "text": {"pages": [{"page_number": 1, "text": "hello"}, {"page_number": 2, "text": "world"}]},
            "markdown": {"pages": [{"page_number": 1, "markdown": "# hello"}]},
            "items": {"pages": [{"page_number": 1, "items": [{"type": "heading", "value": "hello"}]}]},
            "markdown_full": None,
            "text_full": None,
        }
        doc = LlamaParseService.normalize_raw(raw)
        assert doc.page_count == 2
        assert doc.pages[0].items == [{"type": "heading", "value": "hello"}]
        assert doc.pages[1].text == "world"
        assert doc.text == "hello\n\nworld"
        assert doc.markdown == "# hello"
