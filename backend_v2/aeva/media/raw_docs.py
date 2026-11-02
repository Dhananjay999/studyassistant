"""Un-indexed documents: what can still be done with each of them.

A selected document that cannot be searched (still processing, failed, or
parsed to zero chunks) used to be attached whole to the answer model. The
OpenAI provider only inlines images, so such a document was silently
dropped while the prompt told the model the file was "attached in full":
Aeva answered from general knowledge and said the PDF "was not included in
readable form" (5 turns in the week of 2026-10-22, every one on a failed
upload). This module decides, per document, between inlining its parsed
text, attaching the binary (providers that read documents), or saying so.
It is shared by the media tool and the quiz / flashcard / notes grounding.
"""

import logging
from dataclasses import dataclass, field
from typing import Any

from aeva.llm import prompts

logger = logging.getLogger(__name__)

Records = list[dict[str, Any]]

# Providers whose chat API accepts whole documents (PDF, DOCX, ...) as
# attachments. Every other provider inlines only images.
DOCUMENT_ATTACHMENT_PROVIDERS = frozenset({"gemini"})

# ``processing_status`` values that mean "the pipeline is still running".
IN_PROGRESS_STATUSES = frozenset({
    "pending",
    "parsing",
    "extracting",
    "chunking",
    "embedding",
    "indexing",
})


def documents_attachable(llm: Any) -> bool:
    """Whether ``llm``'s provider reads whole documents sent as attachments."""
    name = getattr(llm, "provider_name", "")
    return isinstance(name, str) and name in DOCUMENT_ATTACHMENT_PROVIDERS


@dataclass
class RawDocTriage:
    """Un-indexed documents split by what can still be done with them.

    - ``inline``: parsed text exists (``parsed_text_path``), so the text
      itself goes into the prompt: complete, provider-independent and
      cheaper than the binary.
    - ``attach``: no text yet, but the provider accepts the document whole.
    - ``failed``: processing failed and there is nothing to read.
    - ``processing``: still in the pipeline and not attachable.
    """

    inline: Records = field(default_factory=list)
    attach: Records = field(default_factory=list)
    failed: Records = field(default_factory=list)
    processing: Records = field(default_factory=list)

    @property
    def failed_names(self) -> list[str]:
        """File names of the documents nothing can be done with."""
        return [str(r.get("file_name") or "document") for r in self.failed]


def triage_raw_docs(raw_docs: Records, *, attachable: bool) -> RawDocTriage:
    """Sort ``raw_docs`` (see :func:`partition_media_records`) for a provider
    that does (``attachable``) or does not read whole documents."""
    triage = RawDocTriage()
    for record in raw_docs:
        if record.get("parsed_text_path"):
            triage.inline.append(record)
            continue
        status = str(record.get("processing_status") or "")
        if attachable and status != "failed":
            triage.attach.append(record)
        elif status in IN_PROGRESS_STATUSES:
            triage.processing.append(record)
        else:
            triage.failed.append(record)
    return triage


@dataclass
class InlineText:
    """Parsed text of un-indexed documents, rendered for a prompt."""

    context: str = ""
    # One label per file for the attached-files list ("x.pdf (text, ...)").
    labels: list[str] = field(default_factory=list)
    # One source per file (document name, no page) so the answer can still
    # show where it came from.
    sources: list[dict[str, Any]] = field(default_factory=list)


def inline_text_context(
    supabase: Any, records: Records, *, budget: int
) -> InlineText:
    """Download and render the parsed text of ``records`` within ``budget``
    characters in total. A file whose text cannot be fetched is skipped."""
    out = InlineText()
    blocks: list[str] = []
    remaining = int(budget)
    for record in records:
        if remaining <= 0:
            break
        path = record.get("parsed_text_path")
        if not path:
            continue
        name = str(record.get("file_name") or "document")
        try:
            raw = supabase.download_file(str(path))
        except Exception:  # noqa: BLE001 — fall back to the other files
            logger.warning("Parsed text unavailable for inline use: %s", name)
            continue
        text = raw.decode("utf-8", errors="replace")[:remaining].strip()
        if not text:
            continue
        remaining -= len(text)
        blocks.append(prompts.inline_text_block(name, text))
        out.labels.append(f"{name} (text, not indexed)")
        out.sources.append({
            "media_id": str(record.get("id") or ""),
            "document_name": name,
            "page_number": None,
        })
    out.context = "\n".join(blocks)
    return out
