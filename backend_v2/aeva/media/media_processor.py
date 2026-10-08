"""Stage-by-stage media processing for the RAG pipeline.

``MediaProcessor.process`` is a generator: each stage yields a progress event
(consumed by the SSE endpoint and surfaced in the upload UI) and persists its
artifacts plus ``media.processing_status`` before moving on. Persisting the
LlamaParse job id *before* polling makes the run resumable — a dropped SSE
connection that reconnects re-enters ``process`` and picks up the existing job
instead of re-parsing, which matters under the serverless request ceiling.

Progress events are plain dicts ``{stage, pct, msg}``; terminal events use the
``ready`` and ``error`` stages.

Failures never delete the upload. A document that cannot be indexed (parsing
not configured, or a scan with no extractable text) is marked ``ready`` with
zero chunks so the media tool answers it from the raw file, exactly like an
image; any other failure is persisted as ``failed`` with its message so the
file stays visible with retry/remove actions.
"""

import json
import logging
import time
from collections.abc import Generator
from datetime import UTC, datetime
from typing import Any

from flask import current_app

from aeva.llm.llm_client import LLMClient
from aeva.media.chunking import (
    EMBEDDING_VERSION,
    Chunk,
    chunk_parsed_document,
)
from aeva.media.llamaparse_service import (
    STATUS_COMPLETED,
    TERMINAL_STATUSES,
    LlamaParseService,
    ParsedDocument,
)
from aeva.media.text_quality import score_document
from aeva.supabase.supabase_service import SupabaseService

logger = logging.getLogger(__name__)

# Poll cadence while waiting on LlamaParse. Capped well under the serverless
# request ceiling; a longer parse drops out and resumes on reconnect.
_POLL_INTERVAL_SECONDS = 3
_MAX_POLL_SECONDS = 240

# While LlamaParse works, cycle these so a long parse still feels alive.
_PARSE_HINTS = ("Reading pages…", "Understanding document structure…")
# The OCR re-parse reads page images, which is slower; say so.
_OCR_HINTS = ("Reading page images…", "Recognising text on each page…")

Event = dict[str, Any]


class MediaProcessingError(Exception):
    """A processing stage failed; carries a user-facing message.

    ``recoverable`` marks a failure the client can retry by *resuming* the
    existing run (e.g. a parse that is merely slow) rather than re-uploading.
    Non-recoverable failures are persisted as ``failed``; the upload is kept.
    """

    def __init__(self, message: str, *, recoverable: bool = False) -> None:
        """Store the user-facing message and recoverability."""
        super().__init__(message)
        self.user_message = message
        self.recoverable = recoverable


class MediaProcessor:
    """Parse, chunk, embed, and index one uploaded document."""

    def __init__(
        self,
        supabase: SupabaseService | None = None,
        llamaparse: LlamaParseService | None = None,
        embed_llm: LLMClient | None = None,
    ) -> None:
        self._supabase = supabase
        self._llamaparse = llamaparse
        self._embed_llm = embed_llm

    @property
    def supabase(self) -> SupabaseService:
        """Lazy Supabase client."""
        return self._supabase or SupabaseService()

    @property
    def llamaparse(self) -> LlamaParseService:
        """Lazy LlamaParse client."""
        return self._llamaparse or LlamaParseService()

    @property
    def embed_llm(self) -> LLMClient:
        """Lazy embedding client."""
        return self._embed_llm or LLMClient(config_key="LLM_EMBEDDING_MODEL")

    @staticmethod
    def _event(stage: str, pct: int, msg: str) -> Event:
        """Build a progress event."""
        return {"stage": stage, "pct": pct, "msg": msg}

    @staticmethod
    def _error_event(msg: str, *, recoverable: bool) -> Event:
        """Build a terminal error event carrying its recoverability."""
        return {
            "stage": "error",
            "pct": 0,
            "msg": msg,
            "recoverable": recoverable,
            # The upload always survives a failure now; the client keeps the
            # row (with retry/remove) instead of dropping it.
            "kept": True,
        }

    def process(
        self, user_id: str, media_id: str
    ) -> Generator[Event, None, None]:
        """Run the pipeline, yielding progress and persisting each stage."""
        logger.info(
            "Media processing start | media=%s | user=%s", media_id, user_id
        )
        record = self.supabase.get_media(media_id, user_id)
        if not record:
            logger.warning("Media processing: file not found | %s", media_id)
            yield self._error_event("File not found.", recoverable=False)
            return

        # Already indexed (e.g. a redundant reconnect) -> report ready.
        if (
            record.get("processing_status") == "ready"
            and record.get("chunk_count")
        ):
            yield self._event("ready", 100, "Document is ready!")
            return

        # Images skip the RAG pipeline entirely — no parsing, chunking, or
        # embedding. They are answered by sending the image straight to the
        # vision-capable LLM (the media tool's attachment path). Marking the
        # record ready with ZERO chunks is what routes it there: the media tool
        # treats "ready + chunk_count>0" as retrievable and everything else as a
        # direct attachment. Only documents (PDF/DOCX/PPTX/…) enter RAG below.
        if str(record.get("mime_type", "")).startswith("image/"):
            logger.info("Image skips RAG pipeline | media=%s", media_id)
            self.supabase.update_media_processing(
                media_id,
                user_id,
                processing_status="ready",
                chunk_count=0,
                processing_error=None,
                processed_at=datetime.now(tz=UTC).isoformat(),
            )
            yield self._event("ready", 100, "Image ready!")
            return

        try:
            yield from self._run(user_id, record)
        except MediaProcessingError as exc:
            logger.exception("Media processing failed for %s", media_id)
            yield from self._handle_failure(
                user_id,
                record,
                exc.user_message,
                recoverable=exc.recoverable,
            )
        except Exception:
            logger.exception("Unexpected processing error for %s", media_id)
            yield from self._handle_failure(
                user_id,
                record,
                "Processing failed unexpectedly.",
                recoverable=False,
            )

    def _handle_failure(
        self,
        user_id: str,
        record: dict[str, Any],
        message: str,
        *,
        recoverable: bool,
    ) -> Generator[Event, None, None]:
        """Persist the failure, then emit the error event.

        A recoverable failure (a slow parse) keeps the status so a reconnect
        resumes the job. An unrecoverable one is marked ``failed`` — the
        original file, parsed artifacts, and pages are all kept, so the
        student can retry later or still get answers from the raw file.
        """
        media_id = record["id"]
        fields: dict[str, Any] = {"processing_error": message[:500]}
        if not recoverable:
            fields["processing_status"] = "failed"
            # A retry must submit a fresh parse, not poll the dead job.
            fields["llamaparse_job_id"] = None
        self.supabase.update_media_processing(media_id, user_id, **fields)
        yield self._error_event(message, recoverable=recoverable)

    def _mark_unindexed(
        self, user_id: str, record: dict[str, Any], reason: str
    ) -> Generator[Event, None, None]:
        """Finish a document that cannot be chunked as ready-with-no-chunks.

        Zero chunks routes the file to the media tool's whole-file attachment
        path (the same contract images use), so it stays answerable instead
        of vanishing. ``reason`` is kept on the row for diagnostics.
        """
        media_id = record["id"]
        logger.info(
            "Media unindexed (attachment path) | media=%s | %s",
            media_id,
            reason,
        )
        self.supabase.update_media_processing(
            media_id,
            user_id,
            processing_status="ready",
            chunk_count=0,
            processing_error=reason[:500],
            processed_at=datetime.now(tz=UTC).isoformat(),
        )
        yield self._event(
            "ready", 100, "Uploaded — answers will use the full file."
        )

    def _run(
        self, user_id: str, record: dict[str, Any]
    ) -> Generator[Event, None, None]:
        """Happy-path stages; exceptions bubble to ``process`` for cleanup."""
        media_id = record["id"]

        if not self.llamaparse.enabled:
            # No parser configured: keep the file usable via attachments
            # (the pre-RAG behaviour) rather than failing the upload.
            yield from self._mark_unindexed(
                user_id,
                record,
                "Document parsing is not configured on this server.",
            )
            return

        yield self._event("parsing", 12, "Parsing document…")
        logger.info("Stage: parsing | media=%s", media_id)
        job_id = yield from self._parse(user_id, record)

        yield self._event("extracting", 45, "Extracting tables and text…")
        logger.info("Stage: extracting | media=%s | job=%s", media_id, job_id)
        doc = self.llamaparse.fetch_result(job_id)

        # A text-layer parse of a symbol-font PDF or a scan comes back as
        # junk or nothing. Re-parse once at the OCR tier rather than index it.
        ocr_tier = self._ocr_tier_for(record, doc)
        if ocr_tier:
            yield self._event(
                "parsing", 30, "Text unclear, reading page images…"
            )
            job_id = yield from self._parse(
                user_id, record, tier=ocr_tier, fresh=True
            )
            yield self._event("extracting", 45, "Extracting tables and text…")
            doc = self.llamaparse.fetch_result(job_id)
            logger.info(
                "OCR re-parse done | media=%s | job=%s | %s",
                media_id,
                job_id,
                score_document(doc).summary(),
            )
        self._persist_artifacts(user_id, record, doc)

        yield self._event("chunking", 65, "Creating semantic chunks…")
        logger.info("Stage: chunking | media=%s", media_id)
        self._set_status(user_id, media_id, "chunking")
        chunks = self._chunk(doc, record)
        if not chunks:
            # A scanned/empty document: nothing to retrieve from, but the
            # file itself can still be sent to the model whole.
            yield from self._mark_unindexed(
                user_id,
                record,
                "No readable text was found in this document.",
            )
            return
        logger.info("Chunked | media=%s | %d chunks", media_id, len(chunks))

        yield self._event("embedding", 82, "Generating embeddings…")
        logger.info(
            "Stage: embedding | media=%s | %d chunks", media_id, len(chunks)
        )
        self._set_status(user_id, media_id, "embedding")
        vectors = self._embed(chunks)

        yield self._event("indexing", 93, "Building knowledge index…")
        logger.info("Stage: indexing | media=%s", media_id)
        self._set_status(user_id, media_id, "indexing")
        self._index(user_id, media_id, chunks, vectors)
        yield self._event("indexing", 98, "Almost ready…")

        self.supabase.update_media_processing(
            media_id,
            user_id,
            processing_status="ready",
            chunk_count=len(chunks),
            processing_error=None,
            processed_at=datetime.now(tz=UTC).isoformat(),
        )
        logger.info(
            "Media processing done | media=%s | %d chunks, %d pages",
            media_id,
            len(chunks),
            doc.page_count,
        )
        yield self._event("ready", 100, "Document is ready!")

    def reindex(
        self, user_id: str, media_id: str
    ) -> Generator[Event, None, None]:
        """Re-chunk and re-embed an indexed document from its stored parse.

        Used to backfill documents onto the current embedding layout (context
        headers, sentence-aware splitting) without paying for another
        LlamaParse run: the ``parsed.json`` artifact is rebuilt into a
        ``ParsedDocument`` and pushed through chunk → embed → index again.
        """
        record = self.supabase.get_media(media_id, user_id)
        if not record:
            yield self._error_event("File not found.", recoverable=False)
            return
        json_path = record.get("parsed_json_path")
        if not json_path:
            yield self._error_event(
                "No parsed document is stored for this file; re-upload it.",
                recoverable=False,
            )
            return
        try:
            raw = json.loads(self.supabase.download_file(json_path))
            doc = LlamaParseService.normalize_raw(raw)
            yield self._event("chunking", 40, "Re-chunking document…")
            chunks = self._chunk(doc, record)
            if not chunks:
                yield from self._mark_unindexed(
                    user_id, record, "No readable text was found."
                )
                return
            yield self._event("embedding", 70, "Re-embedding chunks…")
            vectors = self._embed(chunks)
            yield self._event("indexing", 90, "Rebuilding knowledge index…")
            self.supabase.delete_media_chunks(media_id, user_id)
            self.supabase.insert_media_pages([
                {
                    "media_id": media_id,
                    "user_id": user_id,
                    "page_number": page.page_number,
                    "text": page.text,
                    "markdown": page.markdown,
                }
                for page in doc.pages
            ])
            self._index(user_id, media_id, chunks, vectors)
            self.supabase.update_media_processing(
                media_id,
                user_id,
                processing_status="ready",
                chunk_count=len(chunks),
                page_count=doc.page_count,
                processing_error=None,
                processed_at=datetime.now(tz=UTC).isoformat(),
            )
        except Exception:
            logger.exception("Re-index failed for %s", media_id)
            yield self._error_event("Re-index failed.", recoverable=False)
            return
        logger.info(
            "Media re-indexed | media=%s | %d chunks", media_id, len(chunks)
        )
        yield self._event("ready", 100, "Document re-indexed!")

    def _chunk(
        self, doc: ParsedDocument, record: dict[str, Any]
    ) -> list[Chunk]:
        """Chunk a parsed document with the configured sizes + file name."""
        cfg = current_app.config
        return chunk_parsed_document(
            doc,
            target_tokens=cfg["RAG_CHUNK_TOKENS"],
            overlap_tokens=cfg["RAG_CHUNK_OVERLAP"],
            max_tokens=int(cfg.get("RAG_CHUNK_MAX_TOKENS", 640)),
            table_max_chars=int(cfg.get("RAG_TABLE_MAX_CHARS", 6000)),
            file_name=str(record.get("file_name") or ""),
        )

    def _embed(self, chunks: list[Chunk]) -> list[list[float]]:
        """Embed the header-prefixed text of every chunk."""
        return self.embed_llm.embed(
            [c.embed_text for c in chunks],
            task_type="RETRIEVAL_DOCUMENT",
            output_dimensionality=current_app.config["RAG_EMBEDDING_DIM"],
        )

    def _ocr_tier_for(
        self, record: dict[str, Any], doc: ParsedDocument
    ) -> str | None:
        """Return the OCR tier to re-parse at, or None when the parse is fine.

        None when the fallback is disabled, when this parse already ran at
        the OCR tier (a resumed run must not loop), or when the text reads
        as real words.
        """
        ocr_tier = self.llamaparse.ocr_tier
        if not ocr_tier or record.get("parse_tier") == ocr_tier:
            return None
        quality = score_document(doc)
        if not quality.needs_ocr:
            return None
        logger.info(
            "Text layer unusable, OCR fallback | media=%s | %s | tier=%s",
            record["id"],
            quality.summary(),
            ocr_tier,
        )
        return ocr_tier

    def _parse(
        self,
        user_id: str,
        record: dict[str, Any],
        tier: str | None = None,
        *,
        fresh: bool = False,
    ) -> Generator[Event, None, str]:
        """Submit (or resume) the LlamaParse job and poll to completion.

        ``fresh`` ignores a stored job id and submits again (the OCR retry);
        ``tier`` overrides the configured parse tier for that submission.
        """
        media_id = record["id"]
        job_id = None if fresh else record.get("llamaparse_job_id")
        if not job_id:
            tier = tier or self.llamaparse.tier
            file_bytes = self.supabase.download_file(record["storage_path"])
            job_id = self.llamaparse.submit(
                file_bytes, record["file_name"], record["mime_type"], tier=tier
            )
            # Persist the job id (and its tier) BEFORE polling so a reconnect
            # resumes here, and a resumed OCR job is not re-checked for OCR.
            self._record_parse_job(media_id, user_id, job_id, tier)
            record["llamaparse_job_id"] = job_id
            record["parse_tier"] = tier
        hints = _OCR_HINTS if tier and tier == self.llamaparse.ocr_tier else (
            _PARSE_HINTS
        )

        waited = 0
        while waited < _MAX_POLL_SECONDS:
            status = self.llamaparse.poll(job_id)
            if status == STATUS_COMPLETED:
                return job_id
            if status in TERMINAL_STATUSES:
                msg = f"Parsing did not complete (status: {status})."
                raise MediaProcessingError(msg)
            # Creep the bar forward and rotate hints so the wait feels alive.
            ticks = waited // _POLL_INTERVAL_SECONDS
            pct = min(40, 18 + ticks * 2)
            hint = hints[ticks % len(hints)]
            yield self._event("parsing", pct, hint)
            time.sleep(_POLL_INTERVAL_SECONDS)
            waited += _POLL_INTERVAL_SECONDS

        # The job is still running server-side — a reconnect can resume it.
        msg = "Parsing is taking longer than expected; please retry."
        raise MediaProcessingError(msg, recoverable=True)

    def _record_parse_job(
        self, media_id: str, user_id: str, job_id: str, tier: str
    ) -> None:
        """Store the job id and tier; tolerate a DB without migration 032."""
        try:
            self.supabase.update_media_processing(
                media_id,
                user_id,
                processing_status="parsing",
                llamaparse_job_id=job_id,
                parse_tier=tier,
            )
        except Exception as exc:
            if "parse_tier" not in str(exc):
                raise
            logger.warning("media.parse_tier missing (migration 032)")
            self.supabase.update_media_processing(
                media_id,
                user_id,
                processing_status="parsing",
                llamaparse_job_id=job_id,
            )

    def _persist_artifacts(
        self,
        user_id: str,
        record: dict[str, Any],
        doc: ParsedDocument,
    ) -> None:
        """Store parsed JSON/markdown/text and per-page rows."""
        media_id = record["id"]
        base = record["storage_path"].rsplit(".", 1)[0]
        json_path = f"{base}.parsed.json"
        md_path = f"{base}.parsed.md"
        text_path = f"{base}.parsed.txt"

        self.supabase.upload_file(
            json_path,
            json.dumps(doc.raw).encode("utf-8"),
            "application/json",
        )
        self.supabase.upload_file(
            md_path, doc.markdown.encode("utf-8"), "text/markdown"
        )
        self.supabase.upload_file(
            text_path, doc.text.encode("utf-8"), "text/plain"
        )

        # Re-index cleanly if a prior attempt left partial rows behind.
        self.supabase.delete_media_chunks(media_id, user_id)
        self.supabase.insert_media_pages([
            {
                "media_id": media_id,
                "user_id": user_id,
                "page_number": page.page_number,
                "text": page.text,
                "markdown": page.markdown,
            }
            for page in doc.pages
        ])
        self.supabase.update_media_processing(
            media_id,
            user_id,
            processing_status="extracting",
            page_count=doc.page_count,
            parsed_json_path=json_path,
            parsed_md_path=md_path,
            parsed_text_path=text_path,
        )

    def _set_status(self, user_id: str, media_id: str, status: str) -> None:
        """Persist the current stage so polling clients see real progress."""
        self.supabase.update_media_processing(
            media_id, user_id, processing_status=status
        )

    def _index(
        self,
        user_id: str,
        media_id: str,
        chunks: list[Chunk],
        vectors: list[list[float]],
    ) -> None:
        """Insert chunk rows with their embeddings."""
        rows = [
            {
                "media_id": media_id,
                "user_id": user_id,
                "chunk_index": chunk.chunk_index,
                "content": chunk.content,
                "page_number": chunk.page_number,
                "section": chunk.section,
                "token_count": chunk.token_count,
                "context": chunk.context,
                "embedding_version": EMBEDDING_VERSION,
                "embedding": vector,
            }
            for chunk, vector in zip(chunks, vectors, strict=False)
        ]
        self.supabase.insert_media_chunks(rows)
