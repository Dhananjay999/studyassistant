"""Media RAG tool: retrieve relevant chunks, then answer with citations.

Instead of attaching whole files to the LLM, this embeds the question, runs a
pgvector similarity search over the user's indexed chunks, and grounds the
answer in the top matches — returning structured page-level sources. Documents
that are not yet indexed (legacy uploads, or one still processing) fall back to
the old direct-attachment path so they stay answerable during rollout.
"""

from collections.abc import Generator
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
from aeva.supabase.supabase_service import SupabaseService

_SNIPPET_CHARS = 240


class MediaLLMTool(BaseTool):
    """Answer questions using uploaded study materials (RAG)."""

    def __init__(
        self,
        llm: LLMClient | None = None,
        supabase: SupabaseService | None = None,
        embed_llm: LLMClient | None = None,
    ) -> None:
        self._llm = llm
        self._supabase = supabase
        self._embed_llm = embed_llm

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
    ) -> list[dict[str, Any]]:
        """Resolve the media records in scope for this turn."""
        if media_ids:
            records = [
                self.supabase.get_media(media_id, ctx.user_id)
                for media_id in media_ids
            ]
            return [r for r in records if r]
        return self.supabase.list_media(ctx.user_id, ctx.session_id)

    @staticmethod
    def _is_ready(record: dict[str, Any]) -> bool:
        """Whether a document is indexed and searchable."""
        return (
            record.get("processing_status") == "ready"
            and bool(record.get("chunk_count"))
        )

    def _retrieve(
        self,
        ctx: ToolContext,
        query: str,
        ready: list[dict[str, Any]],
    ) -> tuple[str, list[dict[str, Any]]]:
        """Embed the query, search chunks, build context + sources."""
        query_vector = self.embed_llm.embed(
            [query],
            task_type="RETRIEVAL_QUERY",
            output_dimensionality=current_app.config["RAG_EMBEDDING_DIM"],
        )[0]
        rows = self.supabase.match_chunks(
            query_vector,
            ctx.user_id,
            media_ids=[r["id"] for r in ready],
            top_k=current_app.config["RAG_TOP_K"],
        )
        names = {r["id"]: r["file_name"] for r in ready}

        context_lines: list[str] = []
        sources: list[dict[str, Any]] = []
        for index, row in enumerate(rows, start=1):
            name = names.get(row["media_id"], "document")
            page = row.get("page_number")
            section = row.get("section") or ""
            label = f"{name}, p.{page}" if page else name
            if section:
                label += f', "{section}"'
            # Hand the model the exact inline marker to copy for this excerpt.
            marker = f"[cite:{name}#{page}]" if page else f"[cite:{name}]"
            context_lines.append(
                f"[{index}] ({label}) — cite as {marker}\n{row['content']}"
            )
            sources.append({
                "document_name": name,
                "media_id": row["media_id"],
                "page_number": page,
                "chunk_id": row["id"],
                "section": section or None,
                "snippet": row["content"][:_SNIPPET_CHARS].strip(),
            })
        return "\n\n".join(context_lines), sources

    def _fallback_attachments(
        self, ctx: ToolContext, records: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """Direct-attachment fallback for not-yet-indexed documents."""
        if not current_app.config["RAG_ATTACHMENT_FALLBACK"]:
            return []
        return download_attachments(
            self.supabase,
            ctx.user_id,
            ctx.session_id,
            [r["id"] for r in records],
        )

    def execute(self, ctx: ToolContext, params: dict[str, Any]) -> dict[str, Any]:
        """Answer the question via retrieval, with attachment fallback."""
        query = params.get("query") or ctx.enriched_message
        media_ids = params.get("media_ids") or ctx.media_ids
        records = self._candidate_records(ctx, media_ids)
        ready = [r for r in records if self._is_ready(r)]

        if not records:
            return {"answer": prompts.NO_MEDIA_MESSAGE, "media_count": 0}

        if not ready:
            return self._answer_with_attachments(ctx, query, records)

        context, sources = self._retrieve(ctx, query, ready)
        if not sources:
            return {
                "answer": prompts.NO_CONTEXT_MESSAGE,
                "sources": [],
                "media_count": len(ready),
            }
        answer = self.llm.generate(
            prompts.MEDIA_PROMPT.format(query=query, context=context)
            + prompts.ANSWER_META_INSTRUCTION,
            system_prompt=prompts.personalize(
                prompts.SYSTEM_PROMPT, ctx.personalization
            ),
            history=ctx.history,
        )
        return {
            "answer": answer,
            "sources": sources,
            "media_count": len(ready),
        }

    def _answer_with_attachments(
        self,
        ctx: ToolContext,
        query: str,
        records: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Non-streaming fallback: answer from raw file attachments."""
        attachments = self._fallback_attachments(ctx, records)
        if not attachments:
            return {"answer": prompts.NO_MEDIA_MESSAGE, "media_count": 0}
        answer = self.llm.generate(
            prompts.MEDIA_PROMPT.format(query=query, context="(none)")
            + prompts.ANSWER_META_INSTRUCTION,
            system_prompt=prompts.personalize(
                prompts.SYSTEM_PROMPT, ctx.personalization
            ),
            attachments=attachments,
            history=ctx.history,
        )
        return {"answer": answer, "media_count": len(attachments)}

    def can_stream(self) -> bool:
        """Media answers stream token-by-token."""
        return True

    def execute_stream(
        self,
        ctx: ToolContext,
        params: dict[str, Any],
    ) -> Generator[str, None, dict[str, Any]]:
        """Stream the answer; retrieval (or fallback) runs up front."""
        llm = self.llm
        query = params.get("query") or ctx.enriched_message
        media_ids = params.get("media_ids") or ctx.media_ids
        records = self._candidate_records(ctx, media_ids)
        ready = [r for r in records if self._is_ready(r)]

        if not records:
            yield prompts.NO_MEDIA_MESSAGE
            return {"answer": prompts.NO_MEDIA_MESSAGE, "media_count": 0}

        if not ready:
            attachments = self._fallback_attachments(ctx, records)
            if not attachments:
                yield prompts.NO_MEDIA_MESSAGE
                return {"answer": prompts.NO_MEDIA_MESSAGE, "media_count": 0}
            prompt = (
                prompts.MEDIA_PROMPT.format(query=query, context="(none)")
                + prompts.ANSWER_META_INSTRUCTION
            )
            answer = ""
            for chunk in llm.generate_stream(
                prompt,
                system_prompt=prompts.personalize(
                    prompts.SYSTEM_PROMPT, ctx.personalization
                ),
                attachments=attachments,
                history=ctx.history,
            ):
                answer += chunk
                yield chunk
            return {"answer": answer, "media_count": len(attachments)}

        context, sources = self._retrieve(ctx, query, ready)
        if not sources:
            yield prompts.NO_CONTEXT_MESSAGE
            return {
                "answer": prompts.NO_CONTEXT_MESSAGE,
                "sources": [],
                "media_count": len(ready),
            }
        prompt = (
            prompts.MEDIA_PROMPT.format(query=query, context=context)
            + prompts.ANSWER_META_INSTRUCTION
        )
        answer = ""
        for chunk in llm.generate_stream(
            prompt,
            system_prompt=prompts.personalize(
                prompts.SYSTEM_PROMPT, ctx.personalization
            ),
            history=ctx.history,
        ):
            answer += chunk
            yield chunk
        return {
            "answer": answer,
            "sources": sources,
            "media_count": len(ready),
        }
