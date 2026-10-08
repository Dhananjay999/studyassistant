"""Decide whether a parsed document's text is real or needs OCR.

Some PDFs (NCERT textbooks are the common case here) draw every letter with
a custom symbol font: the text layer holds private glyph codes, so a
text-layer parse comes back as ``❚❘ ✁✂✄☎❘✆`` instead of words. The parse
"succeeds", the junk gets embedded, and retrieval over those pages finds
nothing. The same goes for a scanned PDF, whose text layer is simply empty.

This module scores the parsed pages so the processor can re-run such a file
through an OCR tier (which reads the page images) instead of indexing junk.
Pure functions over ``ParsedDocument``; nothing here touches the network.
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from aeva.media.llamaparse_service import ParsedDocument

# A page with fewer visible characters than this is treated as blank (a
# scanned page, a cover, a separator) rather than scored for junk.
MIN_PAGE_CHARS = 20

# Share of a page's visible characters that must be glyph junk, or the share
# that must be letters, to call the page unreadable.
JUNK_CHAR_SHARE = 0.15
MIN_LETTER_SHARE = 0.35

# Document-level triggers: enough unreadable pages, or a mostly blank file.
UNREADABLE_PAGE_SHARE = 0.2
BLANK_PAGE_SHARE = 0.6

# Code-point ranges a text-layer parse of a symbol-font PDF produces. These
# never appear in meaningful quantity in real prose.
_JUNK_RANGES = (
    (0x2500, 0x27BF),  # box drawing, geometric shapes, misc symbols, dingbats
    (0xE000, 0xF8FF),  # private use area
    (0xFFFD, 0xFFFD),  # replacement character
)


def _is_junk(char: str) -> bool:
    code = ord(char)
    return any(lo <= code <= hi for lo, hi in _JUNK_RANGES)


@dataclass(frozen=True)
class PageQuality:
    """How much of one page's visible text is letters versus glyph junk."""

    page_number: int
    chars: int
    letter_share: float
    junk_share: float

    @property
    def blank(self) -> bool:
        """Too little visible text to judge (a scan, cover or separator)."""
        return self.chars < MIN_PAGE_CHARS

    @property
    def unreadable(self) -> bool:
        """Visible text that is mostly glyph codes rather than words."""
        if self.blank:
            return False
        return (
            self.junk_share >= JUNK_CHAR_SHARE
            or self.letter_share < MIN_LETTER_SHARE
        )


@dataclass(frozen=True)
class DocumentQuality:
    """Page-level scores rolled up for the OCR decision."""

    pages: list[PageQuality]

    @property
    def page_count(self) -> int:
        """Number of scored pages."""
        return len(self.pages)

    @property
    def unreadable_pages(self) -> list[int]:
        """Page numbers whose text is glyph junk."""
        return [p.page_number for p in self.pages if p.unreadable]

    @property
    def blank_pages(self) -> list[int]:
        """Page numbers with too little text to judge."""
        return [p.page_number for p in self.pages if p.blank]

    @property
    def needs_ocr(self) -> bool:
        """Whether the text layer is bad enough to pay for an OCR parse."""
        if not self.pages:
            return False
        total = self.page_count
        unreadable = len(self.unreadable_pages) / total
        blank = len(self.blank_pages) / total
        return unreadable >= UNREADABLE_PAGE_SHARE or blank >= BLANK_PAGE_SHARE

    def summary(self) -> str:
        """One line for logs and the processing_error column."""
        return (
            f"{len(self.unreadable_pages)} unreadable and "
            f"{len(self.blank_pages)} blank of {self.page_count} pages"
        )


def score_text(text: str, page_number: int = 0) -> PageQuality:
    """Score one page's text. Whitespace and layout pipes are ignored."""
    visible = [c for c in text if not c.isspace() and c not in "|-"]
    chars = len(visible)
    if chars == 0:
        return PageQuality(page_number, 0, 0.0, 0.0)
    letters = sum(1 for c in visible if unicodedata.category(c).startswith("L"))
    junk = sum(1 for c in visible if _is_junk(c))
    return PageQuality(page_number, chars, letters / chars, junk / chars)


def score_document(doc: ParsedDocument) -> DocumentQuality:
    """Score every page of a parsed document."""
    return DocumentQuality(
        pages=[
            score_text(page.text or page.markdown or "", page.page_number)
            for page in doc.pages
        ]
    )
