"""Stage-by-stage media processing for the RAG pipeline.

``MediaProcessor.process`` is a generator: each stage yields a progress event
(consumed by the SSE endpoint and surfaced in the upload UI) and persists its
artifacts plus ``media.processing_status`` before moving on. Persisting the
LlamaParse job id *before* polling makes the run resumable — a dropped SSE
connection that reconnects re-enters ``process`` and picks up the existing job
instead of re-parsing, which matters under the serverless request ceiling.

Progress events are plain dicts ``{stage, pct, msg}``; terminal events use the
``ready`` and ``error`` stages.
"""

import json
import logging
import time
from collections.abc import Generator
from datetime import UTC, datetime
from typing import Any

from flask import current_app

from aeva.llm.llm_client import LLMClient
from aeva.media.chunking import chunk_parsed_document
from aeva.media.llamaparse_service import (
    STATUS_COMPLETED,
    TERMINAL_STATUSES,
    LlamaParseService,
    ParsedDocument,
)
from aeva.supabase.supabase_service import SupabaseService

logger = logging.getLogger(__name__)

# Poll cadence while waiting on LlamaParse. Capped well under the serverless
# request ceiling; a longer parse drops out and resumes on reconnect.
_POLL_INTERVAL_SECONDS = 3
_MAX_POLL_SECONDS = 240

# Storage-path suffixes for the artifacts a failed run may have written; cleaned
# up alongside the original so nothing unusable is ever left behind.
_PARSED_SUFFIXES = (".parsed.json", ".parsed.md", ".parsed.txt")

# While LlamaParse works, cycle these so a long parse still feels alive.
_PARSE_HINTS = ("Reading pages…", "Understanding document structure…")

Event = dict[str, Any]


class MediaProcessingError(Exception):
    """A processing stage failed; carries a user-facing message.

    ``recoverable`` marks a failure the client can retry by *resuming* the
    existing run (e.g. a parse that is merely slow) rather than re-uploading.
    Non-recoverable failures trigger a full cleanup of the half-built document.
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
        """React to a terminal failure, then emit the error event.

        A recoverable failure (a slow parse) keeps the record + job id so a
        reconnect resumes it. An unrecoverable one scrubs every artifact so the
        application never holds a partially processed, unusable file.
        """
        media_id = record["id"]
        if recoverable:
            self.supabase.update_media_processing(
                media_id,
                user_id,
                processing_error=message[:500],
            )
        else:
            self._cleanup(user_id, record)
        yield self._error_event(message, recoverable=recoverable)

    def _cleanup(self, user_id: str, record: dict[str, Any]) -> None:
        """Delete the original, derived artifacts, chunks, pages, and row."""
        media_id = record["id"]
        base = record["storage_path"].rsplit(".", 1)[0]
        paths = [record["storage_path"]]
        paths += [f"{base}{suffix}" for suffix in _PARSED_SUFFIXES]
        for path in paths:
            try:
                self.supabase.delete_storage_file(path)
            except Exception:  # noqa: BLE001 - best-effort cleanup
                logger.warning("Cleanup could not delete storage %s", path)
        try:
            self.supabase.delete_media_chunks(media_id, user_id)
            self.supabase.delete_media_record(media_id, user_id)
        except Exception:  # noqa: BLE001 - best-effort cleanup
            logger.warning("Cleanup could not delete record %s", media_id)

    def _run(
        self, user_id: str, record: dict[str, Any]
    ) -> Generator[Event, None, None]:
        """Happy-path stages; exceptions bubble to ``process`` for cleanup."""
        media_id = record["id"]

        yield self._event("parsing", 12, "Parsing document…")
        logger.info("Stage: parsing | media=%s", media_id)
        job_id = yield from self._parse(user_id, record)

        yield self._event("extracting", 45, "Extracting tables and text…")
        logger.info("Stage: extracting | media=%s | job=%s", media_id, job_id)
        doc = self.llamaparse.fetch_result(job_id)
        self._persist_artifacts(user_id, record, doc)

        yield self._event("chunking", 65, "Creating semantic chunks…")
        logger.info("Stage: chunking | media=%s", media_id)
        chunks = chunk_parsed_document(
            doc,
            target_tokens=current_app.config["RAG_CHUNK_TOKENS"],
            overlap_tokens=current_app.config["RAG_CHUNK_OVERLAP"],
        )
        if not chunks:
            msg = "No readable text was found in this document."
            raise MediaProcessingError(msg)
        logger.info("Chunked | media=%s | %d chunks", media_id, len(chunks))

        yield self._event("embedding", 82, "Generating embeddings…")
        logger.info(
            "Stage: embedding | media=%s | %d chunks", media_id, len(chunks)
        )
        vectors = self.embed_llm.embed(
            [c.content for c in chunks],
            task_type="RETRIEVAL_DOCUMENT",
            output_dimensionality=current_app.config["RAG_EMBEDDING_DIM"],
        )

        yield self._event("indexing", 93, "Building knowledge index…")
        logger.info("Stage: indexing | media=%s", media_id)
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

    def _parse(
        self, user_id: str, record: dict[str, Any]
    ) -> Generator[Event, None, str]:
        """Submit (or resume) the LlamaParse job and poll to completion."""
        if not self.llamaparse.enabled:
            msg = "Document parsing is not configured on this server."
            raise MediaProcessingError(msg)

        media_id = record["id"]
        job_id = record.get("llamaparse_job_id")
        if not job_id:
            file_bytes = self.supabase.download_file(record["storage_path"])
            job_id = self.llamaparse.submit(
                file_bytes, record["file_name"], record["mime_type"]
            )
            # Persist the job id BEFORE polling so a reconnect resumes here.
            self.supabase.update_media_processing(
                media_id,
                user_id,
                processing_status="parsing",
                llamaparse_job_id=job_id,
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
            hint = _PARSE_HINTS[ticks % len(_PARSE_HINTS)]
            yield self._event("parsing", pct, hint)
            time.sleep(_POLL_INTERVAL_SECONDS)
            waited += _POLL_INTERVAL_SECONDS

        # The job is still running server-side — a reconnect can resume it.
        msg = "Parsing is taking longer than expected; please retry."
        raise MediaProcessingError(msg, recoverable=True)

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

    def _index(
        self,
        user_id: str,
        media_id: str,
        chunks: list[Any],
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
                "embedding": vector,
            }
            for chunk, vector in zip(chunks, vectors, strict=False)
        ]
        self.supabase.insert_media_chunks(rows)
