"""Citation integrity for streamed answers.

The media answer model is told to cite excerpts with ``[cite:<file>#<page>]``
markers copied from the excerpt labels. Models still invent pages, cite
files that were never retrieved, or vary the spacing. ``CitationFilter``
sits between the model stream and the client: it canonicalises each marker,
keeps the ones that correspond to a retrieved excerpt, drops the rest, and
records what was actually cited so sources can be ordered cited-first.
It is a streaming state machine — a marker split across two chunks is
handled by holding back the unfinished tail.
"""

_OPEN = "[cite:"
_CLOSE = "]"


def canonical_marker(marker: str) -> str:
    """Normalise ``[cite: Name # 3 ]`` to ``[cite:Name#3]``."""
    inner = marker[len(_OPEN) : -len(_CLOSE)] if marker.endswith(_CLOSE) else ""
    name, _, page = inner.partition("#")
    name = name.strip()
    page = page.strip()
    return f"{_OPEN}{name}#{page}{_CLOSE}" if page else f"{_OPEN}{name}{_CLOSE}"


def _partial_open_len(text: str) -> int:
    """Length of a trailing fragment that could still grow into ``[cite:``."""
    for size in range(min(len(text), len(_OPEN) - 1), 0, -1):
        if _OPEN.startswith(text[-size:]):
            return size
    return 0


class CitationFilter:
    """Keep only the citation markers the retrieved context allows."""

    def __init__(self, allowed: set[str]) -> None:
        """Remember the allowed markers (matched case-insensitively)."""
        self._allowed = {
            canonical_marker(m).lower(): canonical_marker(m) for m in allowed
        }
        self._buffer = ""
        self.cited: list[str] = []
        self.dropped = 0

    def feed(self, chunk: str) -> str:
        """Consume a stream chunk and return the text safe to emit now."""
        self._buffer += chunk
        out: list[str] = []
        while True:
            start = self._buffer.find(_OPEN)
            if start == -1:
                keep = _partial_open_len(self._buffer)
                cut = len(self._buffer) - keep
                out.append(self._buffer[:cut])
                self._buffer = self._buffer[cut:]
                break
            out.append(self._buffer[:start])
            end = self._buffer.find(_CLOSE, start)
            if end == -1:
                # Unterminated marker: wait for the rest of it.
                self._buffer = self._buffer[start:]
                break
            marker = self._buffer[start : end + 1]
            self._buffer = self._buffer[end + 1 :]
            canonical = self._allowed.get(canonical_marker(marker).lower())
            if canonical is None:
                self.dropped += 1
            else:
                self.cited.append(canonical)
                out.append(canonical)
        return "".join(out)

    def flush(self) -> str:
        """Return whatever is still buffered once the stream has ended."""
        rest = self._buffer
        self._buffer = ""
        if rest.startswith(_OPEN):
            # An unfinished marker at the very end is noise, not a citation.
            self.dropped += 1
            return ""
        return rest
