"""Structure-aware semantic chunking of parsed documents.

Fixed-size chunking splits mid-sentence and loses the heading a passage lived
under. This walks the LlamaParse layout items instead: it keeps a running
heading breadcrumb, starts a fresh chunk at each new heading, and emits tables
whole (splitting a table destroys it). Every chunk records the page it started
on and its section, which are the inputs for page-level citations.

Token counts are approximated as ``len(text) // 4`` to avoid pulling in a
tokenizer; with a 512-token target this stays well under the embedding model's
per-input ceiling.
"""

from dataclasses import dataclass
from typing import Any

from aeva.media.llamaparse_service import ParsedDocument

_CHARS_PER_TOKEN = 4


@dataclass(frozen=True)
class Chunk:
    """A retrievable unit of a document with its citation metadata."""

    content: str
    page_number: int | None
    section: str | None
    chunk_index: int
    token_count: int


def _estimate_tokens(text: str) -> int:
    """Approximate token count from character length."""
    return max(1, len(text) // _CHARS_PER_TOKEN)


def _first(data: dict[str, Any], *keys: str) -> Any:
    """Return the first present, non-None value among ``keys``."""
    for key in keys:
        if data.get(key) is not None:
            return data[key]
    return None


def _item_type(item: dict[str, Any]) -> str:
    """Return the normalized item kind (heading/text/table/...)."""
    return str(_first(item, "type") or "text").lower()


def _item_text(item: dict[str, Any]) -> str:
    """Best textual representation of a layout item."""
    value = _first(item, "value", "md", "markdown", "text")
    if value is not None:
        return str(value).strip()
    rows = item.get("rows")
    if isinstance(rows, list):
        return "\n".join(
            " | ".join(str(cell) for cell in row)
            for row in rows
            if isinstance(row, list)
        )
    return ""


class _ChunkBuilder:
    """Accumulates text into chunks split on headings, tables, and size."""

    def __init__(self, target_tokens: int, overlap_tokens: int) -> None:
        self._target_chars = target_tokens * _CHARS_PER_TOKEN
        self._overlap_chars = overlap_tokens * _CHARS_PER_TOKEN
        self._heading_stack: list[tuple[int, str]] = []
        self._buffer = ""
        self._start_page: int | None = None
        self._start_section: str | None = None
        self._next_index = 0
        self.chunks: list[Chunk] = []

    def _section(self) -> str | None:
        """Return the heading breadcrumb, e.g. ``Chapter 3 > Scheduling``."""
        if not self._heading_stack:
            return None
        return " > ".join(title for _, title in self._heading_stack)

    def _emit(self, *, carry_overlap: bool) -> None:
        """Flush the buffer into a chunk, optionally keeping a tail overlap."""
        content = self._buffer.strip()
        if not content:
            self._buffer = ""
            self._start_page = None
            self._start_section = None
            return
        self.chunks.append(
            Chunk(
                content=content,
                page_number=self._start_page,
                section=self._start_section,
                chunk_index=self._next_index,
                token_count=_estimate_tokens(content),
            )
        )
        self._next_index += 1
        overlap = (
            self._buffer[-self._overlap_chars :]
            if carry_overlap and self._overlap_chars
            else ""
        )
        self._buffer = overlap
        self._start_page = None if not overlap else self._start_page
        self._start_section = None if not overlap else self._start_section

    def _append(self, text: str, page_number: int) -> None:
        """Add a fragment, opening a chunk window and splitting when full."""
        if not text:
            return
        if not self._buffer.strip():
            self._start_page = page_number
            self._start_section = self._section()
        self._buffer = f"{self._buffer}\n\n{text}".strip()
        while len(self._buffer) >= self._target_chars:
            self._emit(carry_overlap=True)

    def add_heading(self, item: dict[str, Any], page_number: int) -> None:
        """Close the current chunk and push the heading onto the stack."""
        self._emit(carry_overlap=False)
        level = int(_first(item, "lvl", "level") or 1)
        title = _item_text(item)
        while self._heading_stack and self._heading_stack[-1][0] >= level:
            self._heading_stack.pop()
        if title:
            self._heading_stack.append((level, title))
            # Seed the next chunk with the heading so it carries its own title.
            self._append(title, page_number)

    def add_table(self, item: dict[str, Any], page_number: int) -> None:
        """Emit a table as its own standalone chunk."""
        self._emit(carry_overlap=False)
        text = _item_text(item)
        if not text:
            return
        self._start_page = page_number
        self._start_section = self._section()
        self._buffer = text
        self._emit(carry_overlap=False)

    def add_text(self, item: dict[str, Any], page_number: int) -> None:
        """Append a paragraph/list item to the current chunk window."""
        self._append(_item_text(item), page_number)

    def finish(self) -> list[Chunk]:
        """Flush any remaining buffered text and return all chunks."""
        self._emit(carry_overlap=False)
        return self.chunks


def chunk_parsed_document(
    doc: ParsedDocument,
    *,
    target_tokens: int = 512,
    overlap_tokens: int = 64,
) -> list[Chunk]:
    """Split a parsed document into structure-aware, page-tagged chunks.

    Falls back to chunking each page's plain text when a page exposes no
    structured items, so a thin parse still yields retrievable chunks.
    """
    builder = _ChunkBuilder(target_tokens, overlap_tokens)
    for page in doc.pages:
        if page.items:
            for item in page.items:
                kind = _item_type(item)
                if kind == "heading":
                    builder.add_heading(item, page.page_number)
                elif kind == "table":
                    builder.add_table(item, page.page_number)
                else:
                    builder.add_text(item, page.page_number)
        elif page.text:
            builder.add_text({"value": page.text}, page.page_number)
    return builder.finish()
