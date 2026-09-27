"""Streaming citation filter contracts."""

from typing import ClassVar

from aeva.media.citations import CitationFilter, canonical_marker


class TestCanonical:
    def test_spacing_and_page(self):
        assert canonical_marker("[cite: Notes.pdf # 3 ]") == "[cite:Notes.pdf#3]"
        assert canonical_marker("[cite:Notes.pdf]") == "[cite:Notes.pdf]"


class TestCitationFilter:
    allowed: ClassVar[set[str]] = {"[cite:Notes.pdf#3]", "[cite:Notes.pdf]"}

    def test_keeps_allowed_drops_unknown(self):
        f = CitationFilter(self.allowed)
        out = f.feed("Osmosis moves water [cite:Notes.pdf#3]. Other [cite:Book.pdf#9].")
        out += f.flush()
        assert out == "Osmosis moves water [cite:Notes.pdf#3]. Other ."
        assert f.cited == ["[cite:Notes.pdf#3]"]
        assert f.dropped == 1

    def test_marker_split_across_chunks(self):
        f = CitationFilter(self.allowed)
        out = f.feed("Water moves [ci")
        assert out == "Water moves "
        out += f.feed("te:notes.pdf#3] into cells")
        out += f.flush()
        assert out == "Water moves [cite:Notes.pdf#3] into cells"

    def test_non_cite_brackets_untouched(self):
        f = CitationFilter(self.allowed)
        out = f.feed("f(x) = [1, 2] and [cite:Notes.pdf]") + f.flush()
        assert out == "f(x) = [1, 2] and [cite:Notes.pdf]"

    def test_unterminated_tail_dropped(self):
        f = CitationFilter(self.allowed)
        out = f.feed("Done [cite:Notes.pdf#3")
        assert out == "Done "
        assert f.flush() == ""
        assert f.dropped == 1
