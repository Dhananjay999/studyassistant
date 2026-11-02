"""Ground generator tools (quiz, flashcards) in the student's material.

A generator can draw on three sources, in priority order:

1. **Prior agent output** from the same turn ("summarize my notes and make
   flashcards") — the summary IS the material.
2. **Retrieved excerpts** from indexed uploads, via the shared
   ``RetrievalService``. Generation wants coverage rather than precision, so
   it asks for more chunks, spreads them across documents, and skips the
   similarity threshold, query rewrite and rerank.
3. **Whole files** as binary attachments — only for what cannot be
   retrieved from: images, and documents that are not indexed.

Before this, quiz/flashcard generation attached every selected PDF whole on
each call, re-uploading megabytes and ignoring the index entirely.
"""

import re
from dataclasses import dataclass, field
from typing import Any

from flask import current_app

from aeva.mcp.base import ToolContext, source_context_block
from aeva.media.attachments import download_attachments
from aeva.media.raw_docs import (
    RawDocTriage,
    documents_attachable,
    inline_text_context,
    triage_raw_docs,
)
from aeva.media.retrieval import (
    RERANK_NONE,
    RetrievalOptions,
    RetrievalService,
    partition_media_records,
)
from aeva.supabase.supabase_service import SupabaseService
from aeva.tracing.services import retrieval_trace

# Used when the "topic" is just a pointer at the files ("quiz from this
# pdf"): search for what a good quiz covers instead of those words.
COVERAGE_QUERY = (
    "key concepts, definitions, processes, formulas, and important facts"
)
_GENERIC_TOPIC_RE = re.compile(
    r"\b(upload(?:ed)?|materials?|documents?|files?|pdfs?|notes?|attached|"
    r"attachment|this|these|it|chapter)\b",
    re.IGNORECASE,
)
_GENERIC_TOPIC_MAX_WORDS = 10
_DEFAULT_TOP_K = 16
_PER_DOC_MIN = 3


@dataclass
class Grounding:
    """What a generator should build from."""

    source_context: str = ""
    attachments: list[dict[str, Any]] | None = None
    from_prior: bool = False
    from_media: bool = False
    source_media_ids: list[str] = field(default_factory=list)
    diagnostics: dict[str, Any] | None = None

    @property
    def grounded(self) -> bool:
        """Whether the generator has material (so chat history is dropped)."""
        return bool(self.source_context or self.attachments)


def retrieval_query(topic: str) -> str:
    """Search query for a generator topic (coverage query when generic)."""
    cleaned = (topic or "").strip()
    words = cleaned.split()
    generic = not cleaned or (
        len(words) <= _GENERIC_TOPIC_MAX_WORDS
        and bool(_GENERIC_TOPIC_RE.search(cleaned))
    )
    return COVERAGE_QUERY if generic else cleaned


@retrieval_trace.grounding
def ground_generator(
    ctx: ToolContext,
    *,
    topic: str,
    wants_media: bool,
    supabase: SupabaseService,
    retrieval: RetrievalService,
    llm: Any | None = None,
) -> Grounding:
    """Resolve the material a quiz/flashcard generation should use.

    ``llm`` is the client the generator will call. Its provider decides
    whether a document that cannot be searched may travel whole: the
    OpenAI provider drops every non-image attachment, so for it the parsed
    text is inlined instead (``aeva.media.raw_docs``). Without ``llm`` the
    pre-2026-11 behaviour (attach whole) is kept.
    """
    cfg = current_app.config
    prior = source_context_block(
        ctx.prior_results,
        max_chars=int(cfg.get("PRIOR_CONTEXT_MAX_CHARS", 12000)),
    )
    if prior:
        return Grounding(source_context=prior, from_prior=True)
    if not wants_media or not ctx.media_ids:
        return Grounding()

    records = [
        record
        for record in (
            supabase.get_media(media_id, ctx.user_id)
            for media_id in ctx.media_ids
        )
        if record
    ]
    indexed, images, raw_docs = partition_media_records(records)

    context = ""
    diagnostics: dict[str, Any] | None = None
    if indexed:
        ctx.note("Searching your files…")
        options = RetrievalOptions.from_config(
            top_k=int(cfg.get("QUIZ_RAG_TOP_K", _DEFAULT_TOP_K)),
            per_doc_min=_PER_DOC_MIN,
            min_similarity=0.0,
            floor_similarity=0.0,
            rewrite=False,
            multi_query=False,
            rerank=RERANK_NONE,
        )
        result = retrieval.retrieve(
            ctx.user_id, retrieval_query(topic), indexed, options=options
        )
        diagnostics = result.diagnostics
        if not result.is_empty():
            context = (
                "Excerpts from the student's files — the ONLY material to "
                f"use:\n{result.context_text}\n"
            )

    if llm is None:
        # No provider to ask: the old path (attach every un-indexed file).
        attachable = True
        triage = RawDocTriage(attach=list(raw_docs))
    else:
        attachable = documents_attachable(llm)
        triage = triage_raw_docs(raw_docs, attachable=attachable)
    budget = int(cfg.get("RAG_CONTEXT_MAX_CHARS", 24000))
    inline_docs = list(triage.inline)
    whole = list(images)
    if cfg.get("RAG_ATTACHMENT_FALLBACK", True):
        whole += triage.attach
    if indexed and not context:
        # Retrieval came back empty (or is unavailable): the files
        # themselves are still better than generating from nothing. A
        # provider that drops documents gets their parsed text instead.
        if attachable:
            whole += indexed
        else:
            inline_docs += indexed
    if inline_docs:
        inline = inline_text_context(supabase, inline_docs, budget=budget)
        if inline.context:
            context = (
                f"{context}\n{inline.context}"
                if context
                else (
                    "Full text of the student's files that are not indexed "
                    f"yet — the ONLY material to use:\n{inline.context}\n"
                )
            )
    attachments: list[dict[str, Any]] = []
    if whole:
        ctx.note("Reading your files…")
        attachments = download_attachments(
            supabase,
            ctx.user_id,
            ctx.session_id,
            [str(r["id"]) for r in whole],
        )
    return Grounding(
        source_context=context,
        attachments=attachments or None,
        from_media=bool(context or attachments),
        source_media_ids=[str(r["id"]) for r in records],
        diagnostics=diagnostics,
    )
