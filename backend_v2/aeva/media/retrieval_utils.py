"""Pure helpers for the media retrieval pipeline (no Flask, no I/O).

Everything the retrieval service does between "rows came back from the
database" and "here is the numbered excerpt block for the prompt" lives here
as plain functions over plain dataclasses, so each step is unit-testable
without a database or an LLM: rank fusion, thresholds, per-document quotas,
neighbour merging, keyword-query building, and context assembly.
"""

import re
from dataclasses import dataclass, field
from itertools import pairwise

# Origin of a retrieved chunk, for diagnostics.
ORIGIN_VECTOR = "vector"
ORIGIN_FTS = "fts"
ORIGIN_BOTH = "both"
ORIGIN_NEIGHBOR = "neighbor"

# Keyword hits this high in the text ranking survive the similarity floor:
# an exact token match (acronym, code, drug name) is evidence on its own.
_FTS_SURVIVOR_RANK = 3

# Words too common to help a keyword query; the tsvector parser drops most
# of them anyway, this just keeps the OR-list short and readable.
_STOPWORDS = frozenset({
    "a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "is",
    "are", "was", "were", "be", "been", "what", "which", "who", "whom",
    "how", "why", "when", "where", "does", "do", "did", "can", "could",
    "would", "should", "please", "explain", "tell", "me", "about", "this",
    "that", "these", "those", "it", "its", "with", "from", "by", "as",
    "at", "my", "your", "our", "their", "i", "you", "we", "they",
})
_WORD_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9'\-]{1,}")
_MAX_FTS_TERMS = 12

_MIN_OVERLAP_TRIM = 20


@dataclass(frozen=True)
class RetrievedChunk:
    """One chunk row plus its retrieval scores."""

    id: str
    media_id: str
    document_name: str
    chunk_index: int
    content: str
    page_number: int | None
    section: str | None
    similarity: float
    score: float = 0.0
    fts_rank: float | None = None
    vector_rank: int | None = None
    text_rank: int | None = None
    origin: str = ORIGIN_VECTOR


@dataclass(frozen=True)
class Excerpt:
    """A run of adjacent chunks merged into one citable passage."""

    media_id: str
    document_name: str
    content: str
    page_number: int | None
    section: str | None
    chunk_ids: tuple[str, ...]
    first_index: int
    last_index: int
    score: float
    similarity: float
    origins: tuple[str, ...] = field(default_factory=tuple)


def rrf_fuse(rankings: list[list[str]], k: int = 60) -> dict[str, float]:
    """Reciprocal Rank Fusion across several ranked id lists.

    Each list contributes ``1 / (k + rank)`` per id (rank starts at 1), so an
    id near the top of several lists outranks one that tops a single list.
    Returns ``id -> fused score`` (unordered; sort by value descending).
    """
    scores: dict[str, float] = {}
    for ranking in rankings:
        for rank, chunk_id in enumerate(ranking, start=1):
            scores[chunk_id] = scores.get(chunk_id, 0.0) + 1.0 / (k + rank)
    return scores


def apply_threshold(
    chunks: list[RetrievedChunk],
    *,
    min_similarity: float,
    floor_similarity: float,
    min_results: int,
) -> list[RetrievedChunk]:
    """Drop weak matches while guaranteeing a minimum number of results.

    Keeps chunks at or above ``min_similarity`` (and top keyword hits, which
    carry their own evidence). If that leaves fewer than ``min_results``,
    tops up with the best remaining chunks that still clear
    ``floor_similarity``. Input order (by score) is preserved.
    """
    kept: list[RetrievedChunk] = []
    rest: list[RetrievedChunk] = []
    for chunk in chunks:
        strong_keyword = (
            chunk.text_rank is not None
            and chunk.text_rank <= _FTS_SURVIVOR_RANK
        )
        if chunk.similarity >= min_similarity or strong_keyword:
            kept.append(chunk)
        else:
            rest.append(chunk)
    if len(kept) < min_results:
        top_up = [c for c in rest if c.similarity >= floor_similarity]
        kept_ids = {c.id for c in kept} | {
            c.id for c in top_up[: min_results - len(kept)]
        }
        return [c for c in chunks if c.id in kept_ids]
    return kept


def diversify_by_document(
    chunks: list[RetrievedChunk],
    top_k: int,
    per_doc_min: int = 1,
) -> list[RetrievedChunk]:
    """Reserve slots so every document with a hit gets represented.

    First pass gives each document up to ``per_doc_min`` of its best chunks
    (in overall score order); the remaining slots go to the best leftovers.
    The result keeps the incoming score order.
    """
    if top_k <= 0:
        return []
    taken: dict[str, int] = {}
    chosen: set[str] = set()
    for chunk in chunks:
        if len(chosen) >= top_k:
            break
        if taken.get(chunk.media_id, 0) < per_doc_min:
            chosen.add(chunk.id)
            taken[chunk.media_id] = taken.get(chunk.media_id, 0) + 1
    for chunk in chunks:
        if len(chosen) >= top_k:
            break
        chosen.add(chunk.id)
    return [c for c in chunks if c.id in chosen]


def _trim_overlap(previous: str, following: str, overlap_chars: int) -> str:
    """Drop the head of ``following`` that repeats the tail of ``previous``."""
    limit = min(len(previous), len(following), overlap_chars + 2)
    for size in range(limit, _MIN_OVERLAP_TRIM - 1, -1):
        tail = previous[-size:]
        if following.startswith(tail):
            return following[size:].lstrip()
    return following


def merge_neighbors(
    hits: list[RetrievedChunk],
    neighbors: list[RetrievedChunk],
    overlap_chars: int,
) -> list[Excerpt]:
    """Merge hits with their fetched neighbours into contiguous excerpts.

    Chunks of the same document with consecutive indexes become one passage
    (overlap trimmed); a gap starts a new excerpt. Excerpts are ordered by
    the best hit score they contain, and cite the page of that best hit.
    """
    by_id: dict[str, RetrievedChunk] = {}
    for chunk in [*neighbors, *hits]:  # hits win on duplicate ids
        by_id[chunk.id] = chunk
    hit_ids = {c.id for c in hits}

    per_doc: dict[str, list[RetrievedChunk]] = {}
    for chunk in by_id.values():
        per_doc.setdefault(chunk.media_id, []).append(chunk)

    excerpts: list[Excerpt] = []
    for chunks in per_doc.values():
        chunks.sort(key=lambda c: c.chunk_index)
        run: list[RetrievedChunk] = []
        for chunk in chunks:
            if run and chunk.chunk_index != run[-1].chunk_index + 1:
                excerpts.append(_excerpt_from_run(run, hit_ids, overlap_chars))
                run = []
            run.append(chunk)
        if run:
            excerpts.append(_excerpt_from_run(run, hit_ids, overlap_chars))
    excerpts.sort(key=lambda e: e.score, reverse=True)
    return excerpts


def _excerpt_from_run(
    run: list[RetrievedChunk],
    hit_ids: set[str],
    overlap_chars: int,
) -> Excerpt:
    """Build one excerpt from a contiguous run of chunks."""
    text = run[0].content
    for previous, following in pairwise(run):
        text += "\n" + _trim_overlap(
            previous.content, following.content, overlap_chars
        )
    scored = [c for c in run if c.id in hit_ids] or run
    best = max(scored, key=lambda c: c.score)
    return Excerpt(
        media_id=best.media_id,
        document_name=best.document_name,
        content=text.strip(),
        page_number=(
            best.page_number if best.page_number else run[0].page_number
        ),
        section=best.section or run[0].section,
        chunk_ids=tuple(c.id for c in run),
        first_index=run[0].chunk_index,
        last_index=run[-1].chunk_index,
        score=best.score,
        similarity=max(c.similarity for c in scored),
        origins=tuple(c.origin for c in run),
    )


def fts_query(text: str, keywords: list[str] | None = None) -> str:
    """Build a ``websearch_to_tsquery`` string: OR of content words.

    A natural-language question ANDed together matches nothing; OR-ing its
    content words lets any exact token (an acronym, a code, a name) pull a
    chunk into the keyword ranking. Explicit ``keywords`` (from the query
    rewrite) come first and multi-word ones are quoted as phrases.
    """
    terms: list[str] = []
    seen: set[str] = set()
    for keyword in keywords or []:
        cleaned = " ".join(_WORD_RE.findall(keyword))
        key = cleaned.lower()
        if not cleaned or key in seen:
            continue
        seen.add(key)
        terms.append(f'"{cleaned}"' if " " in cleaned else cleaned)
    for word in _WORD_RE.findall(text):
        key = word.lower()
        if key in _STOPWORDS or key in seen:
            continue
        seen.add(key)
        terms.append(word)
    return " OR ".join(terms[:_MAX_FTS_TERMS])


def citation_marker(document_name: str, page_number: int | None) -> str:
    """Build the inline marker the answer model must copy for an excerpt."""
    if page_number:
        return f"[cite:{document_name}#{page_number}]"
    return f"[cite:{document_name}]"


def build_context(
    excerpts: list[Excerpt],
    *,
    max_chars: int,
    snippet_chars: int = 240,
) -> tuple[str, list[dict[str, object]], set[str]]:
    """Render numbered excerpts + sources + the set of allowed cite markers.

    Excerpts are added in score order until ``max_chars`` is reached (the
    first always fits, truncated if needed), so a long document never blows
    the prompt budget. Sources mirror the excerpts one-to-one for the
    client's citation cards.
    """
    lines: list[str] = []
    sources: list[dict[str, object]] = []
    markers: set[str] = set()
    used = 0
    for index, excerpt in enumerate(excerpts, start=1):
        name = excerpt.document_name
        page = excerpt.page_number
        label = f"{name}, p.{page}" if page else name
        if excerpt.section:
            label += f', "{excerpt.section}"'
        marker = citation_marker(name, page)
        content = excerpt.content
        header = f"[{index}] ({label}) — cite as {marker}\n"
        room = max_chars - used - len(header)
        if room <= 0 and lines:
            break
        if len(content) > room:
            content = content[: max(room, 0)].rstrip() + " […]"
        block = header + content
        lines.append(block)
        used += len(block) + 2
        markers.add(marker)
        if page:
            markers.add(citation_marker(name, None))
        sources.append({
            "document_name": name,
            "media_id": excerpt.media_id,
            "page_number": page,
            "chunk_id": excerpt.chunk_ids[0],
            "section": excerpt.section or None,
            "snippet": excerpt.content[:snippet_chars].strip(),
        })
    return "\n\n".join(lines), sources, markers


# Follow-up cues: short, pronoun-heavy, or continuation-shaped messages whose
# retrieval query only makes sense with the previous turns folded in.
_FOLLOWUP_WORDS_MAX = 6
_STANDALONE_WORDS_MIN = 12
_FOLLOWUP_REF_RE = re.compile(
    r"\b(it|its|this|that|these|those|they|them|same|above|the one|"
    r"he|she|his|her|there)\b",
    re.IGNORECASE,
)
_FOLLOWUP_START_RE = re.compile(
    r"^\s*(and|also|what about|how about|why|more|explain|elaborate|"
    r"simpler|simplify|again|then|so|but|ok|okay)\b",
    re.IGNORECASE,
)


def needs_rewrite(message: str, history: list[dict[str, str]] | None) -> bool:
    """Whether a message needs conversation context to be a good search query.

    Never without history. True for short messages, pronoun references and
    continuation openers; false for long, self-contained questions.
    """
    if not history:
        return False
    words = message.split()
    if len(words) <= _FOLLOWUP_WORDS_MAX:
        return True
    if _FOLLOWUP_REF_RE.search(message) or _FOLLOWUP_START_RE.match(message):
        return True
    return len(words) < _STANDALONE_WORDS_MIN
