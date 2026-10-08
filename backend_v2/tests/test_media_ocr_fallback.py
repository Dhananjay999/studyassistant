"""OCR fallback for PDFs whose text layer is junk or empty.

Two layers:

* ``aeva.media.text_quality`` scores parsed pages. Real prose (including
  markdown tables and non-Latin scripts) must pass; the glyph soup a
  symbol-font PDF produces, and a scan with no text, must trigger OCR.
* ``MediaProcessor._run`` re-parses once at the OCR tier when the score says
  so, records the tier, and never loops on a resumed OCR job.
"""

from unittest.mock import MagicMock

import pytest
from flask import Flask

from aeva.media.llamaparse_service import ParsedDocument, ParsedPage
from aeva.media.media_processor import MediaProcessor
from aeva.media.text_quality import score_document, score_text

# Real excerpts from the NCERT Class 11 Biology parse (symbol-font pages).
JUNK = (
    "P▲ ✁✂ ✥■✁✄☎✆✝ ✸✸ t✞✟✠✡ ☛☞☞✌ ✍✎ ✎t☞✏✟✌ ✑✎ ✒☞✠✓✔✟✕ ✒✑✏✖☞✞✗✌✏✑t✟✎✘ "
    "❢☞✏✠ ☞❢ ✔✑✠✍✚✑✏✍✚ ☞✏ ✠✑✚✚✍t☞✔✡ ✛✞✟ ✜✟✢✟t✑t✍✜✟ ✣✎✣✑✔✔✗ ✒☞✜✟✏✟✌"
)
PROSE = (
    "Food is stored as complex carbohydrates, which may be in the form of "
    "laminarin or mannitol. The vegetative cells have a cellulosic wall."
)
TABLE = (
    "| 152 | BIOLOGY | | --- | ---- | with T and C, respectively, on the "
    "other strand. There are two hydrogen bonds between A and T."
)
HINDI = "जीव विज्ञान में कोशिका जीवन की मूल इकाई है और सभी जीव कोशिकाओं से बने हैं।"
MATH = "E = mc² and ΔG = ΔH - TΔS; the ratio is 3:2 (see Table 9.1, p. 145)."


def _doc(*texts: str) -> ParsedDocument:
    pages = [
        ParsedPage(page_number=i + 1, text=t, markdown=t, items=[])
        for i, t in enumerate(texts)
    ]
    return ParsedDocument(
        pages=pages,
        markdown="\n".join(texts),
        text="\n".join(texts),
        page_count=len(pages),
        raw={},
    )


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("text", [PROSE, TABLE, HINDI, MATH])
def test_real_text_is_readable(text):
    q = score_text(text)
    assert not q.unreadable
    assert not q.blank


def test_symbol_font_junk_is_unreadable():
    q = score_text(JUNK)
    assert q.unreadable
    assert q.junk_share > 0.5


def test_short_text_is_blank_not_unreadable():
    q = score_text("173-254")
    assert q.blank
    assert not q.unreadable


def test_document_mostly_junk_needs_ocr():
    quality = score_document(_doc(PROSE, JUNK, JUNK, PROSE, JUNK))
    assert quality.unreadable_pages == [2, 3, 5]
    assert quality.needs_ocr
    assert "3 unreadable" in quality.summary()


def test_document_with_one_bad_page_in_many_does_not():
    quality = score_document(_doc(*([PROSE] * 9), JUNK))
    assert quality.unreadable_pages == [10]
    assert not quality.needs_ocr


def test_scanned_document_needs_ocr():
    quality = score_document(_doc("", "", "", PROSE))
    assert quality.blank_pages == [1, 2, 3]
    assert quality.needs_ocr


def test_clean_document_with_cover_does_not():
    quality = score_document(_doc("", PROSE, TABLE, HINDI))
    assert not quality.needs_ocr


def test_empty_document_does_not():
    assert not score_document(_doc()).needs_ocr


# ---------------------------------------------------------------------------
# Processor
# ---------------------------------------------------------------------------


@pytest.fixture
def app():
    flask_app = Flask(__name__)
    flask_app.config.update(
        LLAMAPARSE_MODE="fast",
        LLAMAPARSE_OCR_MODE="agentic",
        RAG_CHUNK_TOKENS=512,
        RAG_CHUNK_OVERLAP=64,
        RAG_EMBEDDING_DIM=4,
    )
    return flask_app


def _processor(results, record):
    """A processor whose parser answers ``results`` in order."""
    supabase = MagicMock()
    supabase.get_media.return_value = record
    supabase.download_file.return_value = b"%PDF-"
    llamaparse = MagicMock()
    llamaparse.enabled = True
    llamaparse.tier = "fast"
    llamaparse.ocr_tier = "agentic"
    llamaparse.submit.side_effect = [f"job-{i}" for i in range(len(results))]
    llamaparse.poll.return_value = "COMPLETED"
    llamaparse.fetch_result.side_effect = list(results)
    embed = MagicMock()
    proc = MediaProcessor(supabase=supabase, llamaparse=llamaparse, embed_llm=embed)
    # Chunking/embedding/indexing are not under test here.
    proc._chunk = MagicMock(return_value=[MagicMock(chunk_index=0)])
    proc._embed = MagicMock(return_value=[[0.0, 0.0, 0.0, 1.0]])
    proc._index = MagicMock()
    proc._persist_artifacts = MagicMock()
    return proc, supabase, llamaparse


def _record(**over):
    base = {
        "id": "m1",
        "file_name": "book.pdf",
        "mime_type": "application/pdf",
        "storage_path": "u1/book.pdf",
        "processing_status": "pending",
        "chunk_count": 0,
        "llamaparse_job_id": None,
        "parse_tier": None,
    }
    base.update(over)
    return base


def test_junk_parse_is_retried_at_the_ocr_tier(app):
    junk = _doc(JUNK, JUNK, PROSE)
    clean = _doc(PROSE, PROSE, PROSE)
    proc, supabase, llamaparse = _processor([junk, clean], _record())

    with app.app_context():
        events = list(proc.process("u1", "m1"))

    tiers = [c.kwargs["tier"] for c in llamaparse.submit.call_args_list]
    assert tiers == ["fast", "agentic"]
    assert llamaparse.fetch_result.call_count == 2
    # The OCR job id and tier are stored before polling it.
    stored = [
        c.kwargs for c in supabase.update_media_processing.call_args_list
        if "llamaparse_job_id" in c.kwargs
    ]
    assert stored[-1]["llamaparse_job_id"] == "job-1"
    assert stored[-1]["parse_tier"] == "agentic"
    # The clean (second) document is what gets persisted and chunked.
    proc._persist_artifacts.assert_called_once()
    assert proc._persist_artifacts.call_args.args[2] is clean
    assert any("page images" in e["msg"] for e in events)
    assert events[-1]["stage"] == "ready"


def test_clean_parse_is_not_retried(app):
    clean = _doc(PROSE, TABLE)
    proc, _, llamaparse = _processor([clean], _record())
    with app.app_context():
        events = list(proc.process("u1", "m1"))
    assert llamaparse.submit.call_count == 1
    assert llamaparse.submit.call_args.kwargs["tier"] == "fast"
    assert events[-1]["stage"] == "ready"


def test_resumed_ocr_job_is_not_retried_again(app):
    # Reconnect mid-OCR: the stored job is the agentic one and is still junk
    # (say OCR genuinely could not read it). It must not submit a third parse.
    still_junk = _doc(JUNK, JUNK)
    proc, _, llamaparse = _processor(
        [still_junk],
        _record(llamaparse_job_id="job-ocr", parse_tier="agentic"),
    )
    with app.app_context():
        events = list(proc.process("u1", "m1"))
    llamaparse.submit.assert_not_called()
    llamaparse.poll.assert_called_with("job-ocr")
    assert events[-1]["stage"] == "ready"


def test_fallback_disabled_indexes_what_it_got(app):
    junk = _doc(JUNK, JUNK)
    proc, _, llamaparse = _processor([junk], _record())
    llamaparse.ocr_tier = ""
    with app.app_context():
        list(proc.process("u1", "m1"))
    assert llamaparse.submit.call_count == 1


def test_parse_tier_column_missing_is_tolerated(app):
    clean = _doc(PROSE)
    proc, supabase, _ = _processor([clean], _record())

    def update(media_id, user_id, **fields):
        if "parse_tier" in fields:
            raise RuntimeError("column media.parse_tier does not exist")
        return {}

    supabase.update_media_processing.side_effect = update
    with app.app_context():
        events = list(proc.process("u1", "m1"))
    assert events[-1]["stage"] == "ready"
