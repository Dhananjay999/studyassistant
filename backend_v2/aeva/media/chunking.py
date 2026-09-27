"""Structure-aware semantic chunking of parsed documents.

Fixed-size chunking splits mid-sentence and loses the heading a passage lived
under. This walks the LlamaParse layout items instead: it keeps a running
heading breadcrumb, starts a fresh chunk at each new heading, and emits tables
whole (splitting a table destroys it). Every chunk records the page it started
on and its section, which are the inputs for page-level citations.

Token counts are approximated as ``len(text) // 4`` to avoid pulling in a
tokenizer; with a 512-token target this stays well under the embedding model's
per-input ceiling. A single oversized item (a whole page of plain text, a long
paragraph, a huge table) is split sentence-wise so no chunk exceeds
``max_tokens`` — the embedding model would silently truncate anything longer,
leaving the tail unsearchable.

Every chunk also carries a *context header* (``file | section | page``). It is
prepended to the embedded text (``embed_text``) so the vector encodes where a
passage lives, which is what lets "chapter 3 summary" retrieve chapter 3's
chunks; the stored ``content`` stays the clean passage.
"""

import re
from dataclasses import dataclass
from typing import Any

from aeva.media.llamaparse_service import ParsedDocument

_CHARS_PER_TOKEN = 4
# Layout version of the embedded text (bumped when ``embed_text`` changes);
# stored per chunk so a re-index can target rows on an older layout.
EMBEDDING_VERSION = 2

_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+|\n{2,}")
_HEADER_SEP = " | "


@dataclass(frozen=True)
class Chunk:
    """A retrievable unit of a document with its citation metadata."""

    content: str
    page_number: int | None
    section: str | None
    chunk_index: int
    token_count: int
    # "file | section | p.N" — where the passage lives.
    context: str = ""

    @property
    def embed_text(self) -> str:
        """Text sent to the embedding model (header + passage)."""
        if not self.context:
            return self.content
        return f"{self.context}\n{self.content}"


def build_context_header(
    file_name: str, section: str | None, page_number: int | None
) -> str:
    """Compose the ``file | section | p.N`` header for a chunk."""
    parts = [file_name.strip()] if file_name else []
    if section:
        parts.append(section)
    if page_number:
        parts.append(f"p.{page_number}")
    return _HEADER_SEP.join(parts)


def split_long_text(text: str, max_chars: int, overlap_chars: int) -> list[str]:
    """Split ``text`` into pieces of at most ``max_chars`` on sentence ends.

    Sentences are packed greedily; a single sentence longer than the limit
    is hard-cut. Consecutive pieces share ``overlap_chars`` of tail so a fact
    straddling a boundary is still retrievable from one of them.
    """
    text = text.strip()
    if len(text) <= max_chars:
        return [text] if text else []
    sentences = [s for s in _SENTENCE_RE.split(text) if s and s.strip()]
    pieces: list[str] = []
    current = ""
    for raw_sentence in sentences:
        rest = raw_sentence.strip()
        while len(rest) > max_chars:
            # A monster sentence: hard-cut it, keeping the overlap.
            if current:
                pieces.append(current)
                current = current[-overlap_chars:] if overlap_chars else ""
            room = max_chars - len(current) - 1
            head, rest = rest[:room], rest[room:]
            current = f"{current} {head}".strip()
            pieces.append(current)
            current = current[-overlap_chars:] if overlap_chars else ""
        if not rest:
            continue
        candidate = f"{current} {rest}".strip() if current else rest
        if len(candidate) > max_chars and current:
            pieces.append(current)
            tail = current[-overlap_chars:] if overlap_chars else ""
            current = f"{tail} {rest}".strip() if tail else rest
        else:
            current = candidate
    if current and (not pieces or current != pieces[-1]):
        pieces.append(current)
    return pieces


def _split_table(text: str, max_chars: int) -> list[str]:
    """Split a huge table by rows, repeating the header row in every part."""
    rows = [r for r in text.split("\n") if r.strip()]
    if len(rows) < 2 or len(text) <= max_chars:  # noqa: PLR2004 - header + 1 row
        return [text]
    header = rows[0]
    parts: list[str] = []
    current = [header]
    size = len(header)
    for row in rows[1:]:
        if size + len(row) + 1 > max_chars and len(current) > 1:
            parts.append("\n".join(current))
            current, size = [header], len(header)
        current.append(row)
        size += len(row) + 1
    if len(current) > 1:
        parts.append("\n".join(current))
    return parts


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

    def __init__(
        self,
        target_tokens: int,
        overlap_tokens: int,
        *,
        max_tokens: int = 640,
        table_max_chars: int = 6000,
        file_name: str = "",
    ) -> None:
        self._target_chars = target_tokens * _CHARS_PER_TOKEN
        self._overlap_chars = overlap_tokens * _CHARS_PER_TOKEN
        self._max_chars = max(max_tokens, target_tokens) * _CHARS_PER_TOKEN
        self._table_max_chars = table_max_chars
        self._file_name = file_name
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
                context=build_context_header(
                    self._file_name, self._start_section, self._start_page
                ),
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
        """Add a fragment, opening a chunk window and splitting when full.

        A fragment that would not fit under the hard ceiling (even after the
        overlap carried from the previous chunk) is split sentence-wise
        first, and a full window is flushed before a fragment is added, so
        no chunk ever exceeds ``max_tokens`` — a whole plain-text page can
        never become one oversized chunk.
        """
        if not text:
            return
        piece_limit = self._max_chars - self._overlap_chars - 2
        if len(text) > piece_limit:
            for piece in split_long_text(
                text, piece_limit, self._overlap_chars
            ):
                self._append(piece, page_number)
            return
        if (
            self._buffer.strip()
            and len(self._buffer) + len(text) + 2 > self._max_chars
        ):
            self._emit(carry_overlap=True)
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
        """Emit a table as its own standalone chunk (split by rows if huge)."""
        self._emit(carry_overlap=False)
        text = _item_text(item)
        if not text:
            return
        for part in _split_table(text, self._table_max_chars):
            self._start_page = page_number
            self._start_section = self._section()
            self._buffer = part
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
    max_tokens: int = 640,
    table_max_chars: int = 6000,
    file_name: str = "",
) -> list[Chunk]:
    """Split a parsed document into structure-aware, page-tagged chunks.

    Falls back to chunking each page's plain text when a page exposes no
    structured items, so a thin parse still yields retrievable chunks.
    ``file_name`` feeds every chunk's context header.
    """
    builder = _ChunkBuilder(
        target_tokens,
        overlap_tokens,
        max_tokens=max_tokens,
        table_max_chars=table_max_chars,
        file_name=file_name,
    )
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
