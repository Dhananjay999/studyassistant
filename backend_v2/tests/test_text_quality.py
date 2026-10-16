"""Text-layer quality scoring: glyph junk, blank pages and glued text."""

from aeva.media.text_quality import (
    GLUED_WORD_CHARS,
    DocumentQuality,
    score_text,
)

PROSE = (
    "The cell is the basic structural and functional unit of life. "
    "Every living organism is made of one or more cells, and new cells "
    "arise only from existing cells by division."
)


class TestGluedText:
    def test_normal_prose_is_readable(self):
        page = score_text(PROSE, 1)
        assert page.glued_share == 0.0
        assert not page.unreadable

    def test_glued_runs_make_the_page_unreadable(self):
        glued = " ".join(
            ["thecellisthebasicstructuralandfunctionalunitoflife"] * 3
            + PROSE.split()[:20]
        )
        page = score_text(glued, 2)
        assert page.glued_share > 0.05
        assert page.unreadable

    def test_long_urls_and_identifiers_are_not_glued(self):
        text = PROSE + " https://example.org/" + "a" * GLUED_WORD_CHARS
        text += " ABC-" + "d" * GLUED_WORD_CHARS
        page = score_text(text, 3)
        assert page.glued_share == 0.0

    def test_glued_pages_trigger_the_ocr_tier(self):
        glued_page = score_text(
            " ".join(["thisisapagewhoseeverywordisgluedtogether"] * 30), 1
        )
        clean = [score_text(PROSE, n) for n in range(2, 6)]
        doc = DocumentQuality(pages=[glued_page, *clean])
        assert doc.unreadable_pages == [1]
        assert doc.needs_ocr
