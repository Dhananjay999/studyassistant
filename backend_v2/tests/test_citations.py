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


class TestBracketInFileName:
    """A ``]`` inside the file name must not end the marker early."""

    allowed: ClassVar[set[str]] = {"[cite:Syllabus [AICTE].pdf#3]"}

    def test_close_after_page_wins(self):
        f = CitationFilter(self.allowed)
        out = f.feed("See [cite:Syllabus [AICTE].pdf#3] for the units.")
        out += f.flush()
        assert out == "See [cite:Syllabus [AICTE].pdf#3] for the units."
        assert f.cited == ["[cite:Syllabus [AICTE].pdf#3]"]
        assert f.dropped == 0

    def test_split_after_the_inner_bracket(self):
        f = CitationFilter(self.allowed)
        out = f.feed("See [cite:Syllabus [AICTE]")
        # Held back: the marker may continue with the page part.
        assert out == "See "
        out += f.feed(".pdf#3] now") + f.flush()
        assert out == "See [cite:Syllabus [AICTE].pdf#3] now"

    def test_pageless_marker_at_end_is_still_resolved(self):
        f = CitationFilter({"[cite:Notes.pdf]"})
        out = f.feed("Water [cite:Notes.pdf]") + f.flush()
        assert out == "Water [cite:Notes.pdf]"
        assert f.cited == ["[cite:Notes.pdf]"]
