"""Pasted notes and imported links as study material (R23, 2026-10-16)."""

from flask import Flask

from aeva.media.compression import ALLOWED_TEXT_TYPE, compress_media
from aeva.media.media_processor import split_text_pages
from aeva.media.media_repository import ALLOWED_TYPES
from aeva.media.url_import import html_to_text


class TestPlainTextUploads:
    def test_text_is_an_allowed_upload_type(self):
        assert ALLOWED_TEXT_TYPE in ALLOWED_TYPES

    def test_text_passes_through_compression(self):
        app = Flask(__name__)
        app.config["MAX_UPLOAD_MB"] = 30
        with app.app_context():
            out, mime = compress_media(b"hello notes", ALLOWED_TEXT_TYPE)
        assert out == b"hello notes"
        assert mime == ALLOWED_TEXT_TYPE


class TestSplitTextPages:
    def test_short_text_is_one_page(self):
        assert split_text_pages("a short note") == ["a short note"]

    def test_splits_at_paragraphs_near_the_limit(self):
        paragraphs = [f"Paragraph {i} " + "word " * 60 for i in range(12)]
        pages = split_text_pages("\n\n".join(paragraphs), max_chars=1000)
        assert len(pages) > 1
        assert all(len(p) <= 2000 for p in pages)
        # Nothing lost: every paragraph appears in exactly one page.
        joined = "\n\n".join(pages)
        for para in paragraphs:
            assert para.strip() in joined

    def test_a_single_huge_paragraph_is_cut_hard(self):
        pages = split_text_pages("x" * 7000, max_chars=2500)
        assert len(pages) >= 2
        assert "".join(pages) == "x" * 7000


class TestHtmlToText:
    def test_strips_scripts_and_keeps_paragraphs(self):
        html = (
            "<html><head><title> Light &amp; Shadow </title>"
            "<script>var x = 1;</script></head><body>"
            "<h1>Light</h1><p>Light travels in straight lines.</p>"
            "<style>p{}</style><p>Shadows form behind opaque objects.</p>"
            "</body></html>"
        )
        text, title = html_to_text(html)
        assert title == "Light & Shadow"
        assert "var x" not in text
        assert "p{}" not in text
        assert text.splitlines()[0] == "Light"
        assert "Light travels in straight lines." in text
        assert "Shadows form behind opaque objects." in text
