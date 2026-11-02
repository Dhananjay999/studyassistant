"""Media RAG tool: retrieve relevant chunks, then answer with citations.

Instead of attaching whole files to the LLM, this embeds the question, runs a
pgvector similarity search over the user's indexed chunks, and grounds the
answer in the top matches — returning structured page-level sources.

Not every selected file is retrievable: images are never chunked, and a
document may still be indexing or may have failed to parse. Those travel as
binary parts in the SAME call as the excerpts, so a PDF plus a diagram
selected together are both answered from (previously anything without chunks
was silently dropped whenever one indexed PDF was present). When nothing is
indexed at all, the turn falls back to the pre-RAG direct-attachment path
(gated by ``RAG_ATTACHMENT_FALLBACK``; images always attach).
"""

from collections.abc import Generator
from dataclasses import dataclass, field
from typing import Any

from flask import current_app

from aeva.llm import prompts
from aeva.llm.llm_client import LLMClient
from aeva.mcp.base import (
    RESPONSE_FILE_ANALYSIS,
    BaseTool,
    ToolContext,
    ToolDefinition,
)
from aeva.media.attachments import download_attachments
from aeva.media.citations import CitationFilter
from aeva.media.raw_docs import (
    IN_PROGRESS_STATUSES,
    RawDocTriage,
    documents_attachable,
    inline_text_context,
    triage_raw_docs,
)
from aeva.media.retrieval import (
    RetrievalResult,
    RetrievalService,
    partition_media_records,
)
from aeva.media.retrieval_utils import citation_marker
from aeva.supabase.supabase_service import SupabaseService
from aeva.tracing.services import tool_trace

# ``processing_status`` values that mean "the pipeline is still running".
_IN_PROGRESS_STATUSES = IN_PROGRESS_STATUSES

Records = list[dict[str, Any]]


@dataclass
class _Prepared:
    """Everything one media turn needs before the answer model runs.

    ``early_answer`` short-circuits the LLM call (no files, nothing
    retrievable, still processing); otherwise ``rendered`` + ``attachments``
    are what the model receives and ``sources`` ride the result.
    """

    rendered: prompts.RenderedPrompt | None = None
    attachments: list[dict[str, Any]] | None = None
    sources: list[dict[str, Any]] = field(default_factory=list)
    media_count: int = 0
    early_answer: str | None = None
    # Cite markers the answer may use (from the retrieved excerpts).
    allowed_markers: set[str] = field(default_factory=set)
    # Retrieval diagnostics for Developer Mode (popped by the orchestrator).
    diagnostics: dict[str, Any] | None = None
    suggested_followups: list[dict[str, str]] = field(default_factory=list)
    # Streamed before the answer: names selected files that could not be
    # read while other files still answered the question.
    notice: str = ""


class MediaLLMTool(BaseTool):
    """Answer questions using uploaded study materials (RAG)."""

    def __init__(
        self,
        llm: LLMClient | None = None,
        supabase: SupabaseService | None = None,
        embed_llm: LLMClient | None = None,
        retrieval: RetrievalService | None = None,
    ) -> None:
        self._llm = llm
        self._supabase = supabase
        self._embed_llm = embed_llm
        self._retrieval = retrieval

    @property
    def llm(self) -> LLMClient:
        """Lazy answer LLM client."""
        return self._llm or LLMClient(config_key="LLM_MEDIA_MODEL")

    @property
    def embed_llm(self) -> LLMClient:
        """Lazy embedding client."""
        return self._embed_llm or LLMClient(config_key="LLM_EMBEDDING_MODEL")

    @property
    def supabase(self) -> SupabaseService:
        """Lazy Supabase client."""
        return self._supabase or SupabaseService()

    @property
    def retrieval(self) -> RetrievalService:
        """Lazy retrieval service (shares this tool's clients)."""
        if self._retrieval is None:
            self._retrieval = RetrievalService(
                supabase=self.supabase, embed_llm=self.embed_llm
            )
        return self._retrieval

    @property
    def definition(self) -> ToolDefinition:
        """Tool metadata."""
        return ToolDefinition(
            name="media_llm",
            description=(
                "Analyze uploaded PDFs, images, screenshots, diagrams, or "
                "handwritten notes and answer questions about them."
            ),
            parameters_schema=prompts.MEDIA_PARAMS,
        )

    @property
    def response_type(self) -> str:
        """Answers grounded in uploaded files are file analysis."""
        return RESPONSE_FILE_ANALYSIS

    def _candidate_records(
        self, ctx: ToolContext, media_ids: list[str] | None
    ) -> Records:
        """Resolve the media records in scope for this turn."""
        if media_ids:
            records = [
                self.supabase.get_media(media_id, ctx.user_id)
                for media_id in media_ids
            ]
            return [r for r in records if r]
        return self.supabase.list_media(ctx.user_id, ctx.session_id)

    @staticmethod
    def _partition_records(
        records: Records,
    ) -> tuple[Records, Records, Records]:
        """Split records into ``(indexed, images, raw_docs)``.

        ``indexed`` documents are searched; ``images`` (never chunked) and
        ``raw_docs`` (still processing, failed, or parsed to zero chunks) are
        sent whole as attachments so nothing the student selected is ignored.
        """
        return partition_media_records(records)

    @staticmethod
    def _attached_labels(images: Records, raw_docs: Records) -> list[str]:
        """Human-readable labels for files sent whole ("x.pdf (indexing)")."""
        labels = [f"{r.get('file_name', 'image')} (image)" for r in images]
        for record in raw_docs:
            status = str(record.get("processing_status") or "")
            note = (
                "still indexing"
                if status in _IN_PROGRESS_STATUSES
                else "not indexed"
            )
            labels.append(f"{record.get('file_name', 'document')} ({note})")
        return labels

    @tool_trace.media_retrieval
    def _retrieve(
        self, ctx: ToolContext, query: str, indexed: Records
    ) -> RetrievalResult:
        """Run the shared retrieval pipeline over the indexed documents."""
        return self.retrieval.retrieve(
            ctx.user_id, query, indexed, history=ctx.history
        )

    @tool_trace.media_whole_files
    def _whole_file_attachments(
        self,
        ctx: ToolContext,
        images: Records,
        raw_docs: Records,
        attach_docs: Records | None = None,
    ) -> tuple[list[dict[str, Any]], list[str]]:
        """Download files that must travel whole, with their prompt labels.

        Images always attach (they have no other path). Un-indexed documents
        attach only while ``RAG_ATTACHMENT_FALLBACK`` is on — off means
        retrieval-only answers once every upload is indexed. ``raw_docs`` is
        every un-indexed document in scope (kept for the trace);
        ``attach_docs`` narrows it to the ones the provider can read whole
        (see ``_triage_raw_docs``).
        """
        fallback = current_app.config["RAG_ATTACHMENT_FALLBACK"]
        candidates = raw_docs if attach_docs is None else attach_docs
        docs = candidates if fallback else []
        records = images + docs
        if not records:
            return [], []
        attachments = download_attachments(
            self.supabase,
            ctx.user_id,
            ctx.session_id,
            [r["id"] for r in records],
        )
        return attachments, self._attached_labels(images, docs)

    def _documents_attachable(self, ctx: ToolContext) -> bool:
        """Whether the answer model's provider reads whole documents."""
        return documents_attachable(self.resolve_llm(ctx, "LLM_MEDIA_MODEL"))

    def _triage_raw_docs(
        self, ctx: ToolContext, raw_docs: Records
    ) -> RawDocTriage:
        """Split un-indexed documents by what can still be done with them
        (see ``aeva.media.raw_docs``). The provider is looked up only when
        a document without parsed text has to be decided."""
        if not raw_docs or all(r.get("parsed_text_path") for r in raw_docs):
            return triage_raw_docs(raw_docs, attachable=False)
        return triage_raw_docs(
            raw_docs, attachable=self._documents_attachable(ctx)
        )

    @tool_trace.media_prepare
    def _prepare(self, ctx: ToolContext, params: dict[str, Any]) -> _Prepared:
        """Resolve files, retrieve excerpts, and render the prompt."""
        # The retrieval query is a search string (the planner's rewrite, else
        # the student's raw words); the answer prompt gets the full enriched
        # message so clarification answers still reach the model.
        query = params.get("query") or ctx.message
        media_ids = params.get("media_ids") or ctx.media_ids
        records = self._candidate_records(ctx, media_ids)
        if not records:
            return _Prepared(early_answer=prompts.NO_MEDIA_MESSAGE)

        indexed, images, raw_docs = self._partition_records(records)
        triage = self._triage_raw_docs(ctx, raw_docs)
        if images or triage.attach:
            ctx.note("Reading your files…")
        attachments, labels = self._whole_file_attachments(
            ctx, images, raw_docs, triage.attach
        )
        inline = inline_text_context(
            self.supabase,
            triage.inline,
            budget=int(current_app.config.get("RAG_CONTEXT_MAX_CHARS", 24000)),
        )
        inline_context, inline_sources = inline.context, inline.sources
        labels = labels + inline.labels
        media_count = len(indexed) + len(attachments) + len(inline_sources)
        failed_names = triage.failed_names
        processing_docs = triage.processing

        if not indexed and not attachments and not inline_context:
            # Nothing readable among the selected files: say exactly why.
            if failed_names:
                return _Prepared(
                    early_answer=prompts.failed_media_message(failed_names),
                    suggested_followups=[
                        {
                            "title": "Answer from general knowledge",
                            "prompt": (
                                f"{query} (answer from general knowledge, "
                                "not my files)"
                            ),
                        }
                    ],
                )
            return _Prepared(
                early_answer=(
                    prompts.PROCESSING_MESSAGE
                    if processing_docs
                    else prompts.NO_MEDIA_MESSAGE
                ),
            )

        context = ""
        sources: list[dict[str, Any]] = []
        markers: set[str] = set()
        diagnostics: dict[str, Any] | None = None
        if indexed:
            ctx.note("Searching your files…")
            retrieval = self._retrieve(ctx, query, indexed)
            diagnostics = retrieval.diagnostics
            if retrieval.is_empty() and not attachments and not inline_context:
                return _Prepared(
                    early_answer=prompts.no_context_message(
                        query,
                        [
                            str(r.get("file_name") or "document")
                            for r in indexed
                        ],
                        retrieval.coverage,
                    ),
                    media_count=media_count,
                    diagnostics=diagnostics,
                    suggested_followups=[
                        {
                            "title": "Answer from general knowledge",
                            "prompt": (
                                f"{query} (answer from general knowledge, "
                                "not my files)"
                            ),
                        }
                    ],
                )
            context = retrieval.context_text
            sources = retrieval.sources
            markers = retrieval.allowed_markers
        if inline_context:
            context = f"{context}\n{inline_context}".strip()
            sources = sources + inline_sources
            # The inlined files are cited by name only (no page markers).
            for src in inline_sources:
                markers.add(citation_marker(str(src["document_name"]), None))

        rendered = prompts.PromptBuilder.build(
            prompts.MEDIA_TEMPLATE,
            USER_MESSAGE=ctx.enriched_message,
            PLANNER_NOTE=prompts.planner_note_segment(
                ctx.enriched_message, params.get("query")
            ),
            DOCUMENT_CONTEXT=context or "(none)",
            USER_PROFILE=prompts.user_profile_segment(ctx.personalization),
            ATTACHED_FILES=prompts.attached_files_block(labels),
        )
        return _Prepared(
            rendered=rendered,
            attachments=attachments or None,
            sources=sources,
            media_count=media_count,
            allowed_markers=markers,
            diagnostics=diagnostics,
            notice=(
                prompts.failed_media_notice(failed_names) if failed_names else ""
            ),
        )

    @staticmethod
    def _cited_first(
        sources: list[dict[str, Any]], cited: list[str]
    ) -> list[dict[str, Any]]:
        """Order sources so the ones the answer actually cited come first."""
        if not cited:
            return sources
        cited_set = {c.lower() for c in cited}
        first = [
            src
            for src in sources
            if citation_marker(
                str(src["document_name"]), src.get("page_number")
            ).lower()
            in cited_set
        ]
        rest = [src for src in sources if src not in first]
        return first + rest

    def execute(self, ctx: ToolContext, params: dict[str, Any]) -> dict[str, Any]:
        """Answer the question (non-streaming): drains the stream path."""
        stream = self.execute_stream(ctx, params)
        result: dict[str, Any] = {}
        try:
            while True:
                next(stream)
        except StopIteration as stop:
            result = stop.value or {}
        return result

    def can_stream(self) -> bool:
        """Media answers stream token-by-token."""
        return True

    def execute_stream(
        self,
        ctx: ToolContext,
        params: dict[str, Any],
    ) -> Generator[str, None, dict[str, Any]]:
        """Stream the answer; retrieval (and downloads) run up front."""
        prepared = self._prepare(ctx, params)
        if prepared.early_answer is not None or prepared.rendered is None:
            answer = prepared.early_answer or prompts.NO_MEDIA_MESSAGE
            yield answer
            result: dict[str, Any] = {
                "answer": answer,
                "sources": prepared.sources,
                "media_count": prepared.media_count,
                "suggested_followups": prepared.suggested_followups,
            }
            if prepared.diagnostics is not None:
                result["_retrieval"] = prepared.diagnostics
            return result

        llm = self.resolve_llm(ctx, "LLM_MEDIA_MODEL")
        # Only markers that map to a retrieved excerpt reach the client; on
        # the attachment-only path there are no excerpts, so nothing to gate.
        citations = (
            CitationFilter(prepared.allowed_markers)
            if prepared.allowed_markers
            else None
        )
        answer = ""
        if prepared.notice:
            answer = prepared.notice
            yield prepared.notice
        for chunk in llm.generate_stream(
            prepared.rendered.user_message,
            system_prompt=prepared.rendered.system_prompt,
            attachments=prepared.attachments,
            history=ctx.history,
        ):
            text = citations.feed(chunk) if citations else chunk
            if text:
                answer += text
                yield text
        if citations:
            tail = citations.flush()
            if tail:
                answer += tail
                yield tail
        sources = (
            self._cited_first(prepared.sources, citations.cited)
            if citations
            else prepared.sources
        )
        result = {
            "answer": answer,
            "sources": sources,
            "media_count": prepared.media_count,
        }
        if prepared.diagnostics is not None:
            if citations:
                prepared.diagnostics["citations_dropped"] = citations.dropped
                prepared.diagnostics["citations_used"] = len(citations.cited)
            result["_retrieval"] = prepared.diagnostics
        return result
