"""LlamaParse document parsing via the official ``llama_cloud`` SDK.

LlamaParse (LlamaCloud) does the document parsing for the RAG pipeline. This
wraps the SDK's ``LlamaCloud`` client into the same three-call shape the rest of
the pipeline relies on:

- ``submit``  — upload a file + create a parse job, return its job id.
- ``poll``    — read the job status (PENDING/RUNNING/COMPLETED/FAILED/...).
- ``fetch_result`` — fetch the expanded result (text + markdown + structured
  items) once the job is COMPLETED, normalized into ``ParsedDocument``.

The SDK ships a one-shot ``parsing.parse`` that creates + waits + fetches in a
single blocking call, but the processor needs the split: it persists the job id
*before* polling so a dropped SSE connection resumes the existing job instead of
re-parsing. So we drive ``files.create`` + ``parsing.create`` + ``parsing.get``
directly rather than the blocking wrapper. The full result is dumped to JSON by
the caller, so re-chunking later never needs another parse.
"""

import logging
from dataclasses import dataclass, field
from typing import Any

from flask import current_app
from llama_cloud import LlamaCloud

logger = logging.getLogger(__name__)

# The parse-tier version pinned for every job; "latest" tracks LlamaParse's most
# recent release of the configured tier.
_TIER_VERSION = "latest"

# Result fields to materialize on fetch: per-page text, markdown, and the
# structured layout items the chunker walks for headings and tables.
_RESULT_EXPAND = ("text", "items")

# Terminal job states reported by the parse job.
STATUS_COMPLETED = "COMPLETED"
STATUS_FAILED = "FAILED"
STATUS_CANCELLED = "CANCELLED"
TERMINAL_STATUSES = frozenset({
    STATUS_COMPLETED,
    STATUS_FAILED,
    STATUS_CANCELLED,
})


@dataclass(frozen=True)
class ParsedPage:
    """One parsed page: plain text, markdown, and structured layout items."""

    page_number: int
    text: str
    markdown: str
    items: list[dict[str, Any]] = field(default_factory=list)


@dataclass(frozen=True)
class ParsedDocument:
    """Normalized LlamaParse result plus the raw JSON it came from."""

    pages: list[ParsedPage]
    markdown: str
    text: str
    page_count: int
    raw: dict[str, Any]


class LlamaParseService:
    """``llama_cloud`` SDK client for LlamaParse document parsing."""

    def __init__(self) -> None:
        """Hold a lazily built, API-key-keyed SDK client."""
        self._client: LlamaCloud | None = None
        self._client_key: str | None = None

    @property
    def _api_key(self) -> str:
        """LlamaCloud API key from config (empty disables media RAG)."""
        return str(current_app.config["LLAMA_CLOUD_API_KEY"])

    @property
    def _tier(self) -> str:
        """Parse tier; the agentic tiers OCR images and handwriting."""
        return str(current_app.config["LLAMAPARSE_MODE"])

    @property
    def enabled(self) -> bool:
        """Whether a LlamaCloud key is configured."""
        return bool(self._api_key)

    @property
    def client(self) -> LlamaCloud:
        """Return a cached SDK client, rebuilding if the key changed."""
        key = self._api_key
        if self._client is None or self._client_key != key:
            self._client = LlamaCloud(api_key=key)
            self._client_key = key
        return self._client

    def submit(
        self,
        file_bytes: bytes,
        file_name: str,
        mime_type: str,
    ) -> str:
        """Upload a file, create a parse job, and return its job id."""
        file_obj = self.client.files.create(
            file=(file_name, file_bytes, mime_type),
            purpose="parse",
        )
        job = self.client.parsing.create(
            file_id=file_obj.id,
            tier=self._tier,
            version=_TIER_VERSION,
        )
        if not job.id:
            msg = "LlamaParse create returned no job id"
            raise ValueError(msg)
        return str(job.id)

    def poll(self, job_id: str) -> str:
        """Return the current job status (PENDING/RUNNING/COMPLETED/...)."""
        job = self.client.parsing.get(job_id).job
        return str(job.status or "UNKNOWN").upper()

    def fetch_result(self, job_id: str) -> ParsedDocument:
        """Fetch the completed result expanded with text, markdown, items."""
        result = self.client.parsing.get(
            job_id, expand=list(_RESULT_EXPAND)
        )
        return self._normalize(result)

    @staticmethod
    def _normalize(result: Any) -> ParsedDocument:
        """Merge the SDK's parallel per-page lists into a ``ParsedDocument``.

        ``parsing.get`` returns text, markdown, and items as separate
        page-keyed collections; this folds them together by page number. The
        item models are dumped to plain dicts so the chunker (which reads
        ``type``/``value``/``md``/``level``/``rows``) stays SDK-agnostic.
        """
        texts = _pages_by_number(result.text, "text")
        markdowns = _pages_by_number(result.markdown, "markdown")
        items = _items_by_number(result.items)

        numbers = sorted(texts.keys() | markdowns.keys() | items.keys())
        pages = [
            ParsedPage(
                page_number=number,
                text=str(texts.get(number, "")),
                markdown=str(markdowns.get(number, "")),
                items=items.get(number, []),
            )
            for number in numbers
        ]

        joined_md = "\n\n".join(p.markdown for p in pages if p.markdown)
        joined_text = "\n\n".join(p.text for p in pages if p.text)
        return ParsedDocument(
            pages=pages,
            markdown=str(result.markdown_full or joined_md),
            text=str(result.text_full or joined_text),
            page_count=len(pages),
            raw=result.model_dump(mode="json"),
        )


def _pages_by_number(collection: Any, attr: str) -> dict[int, str]:
    """Map page number -> text/markdown for one expanded collection."""
    if collection is None:
        return {}
    mapping: dict[int, str] = {}
    for page in collection.pages or []:
        number = getattr(page, "page_number", None)
        if number is None:
            continue
        mapping[int(number)] = getattr(page, attr, None) or ""
    return mapping


def _items_by_number(collection: Any) -> dict[int, list[dict[str, Any]]]:
    """Map page number -> structured layout items as plain dicts."""
    if collection is None:
        return {}
    mapping: dict[int, list[dict[str, Any]]] = {}
    for page in collection.pages or []:
        number = getattr(page, "page_number", None)
        if number is None:
            continue
        mapping[int(number)] = [
            item.model_dump() for item in getattr(page, "items", None) or []
        ]
    return mapping
