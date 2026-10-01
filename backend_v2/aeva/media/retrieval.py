"""Reusable retrieval over a user's indexed study materials.

``RetrievalService.retrieve`` is the single retrieval entry point for every
tool that grounds itself in uploads (the media answer tool today; quiz and
flashcard generation next). One call runs the whole pipeline::

    message ─▶ [rewrite: standalone query + keywords + paraphrases]
            ─▶ embed (one call for all query variants)
            ─▶ hybrid search per variant (vector + keyword, RRF-fused in SQL;
               falls back to the vector-only RPC until migration 023 lands)
            ─▶ fuse variants ─▶ similarity threshold ─▶ per-document quota
            ─▶ [LLM listwise rerank, hard timeout]
            ─▶ neighbour expansion (chunk_index ± window, merged)
            ─▶ numbered excerpt block + sources + allowed cite markers

Every knob comes from ``RetrievalOptions`` (read once from config), every
optional stage degrades to "skip" on failure, and ``diagnostics`` records
what happened for the Developer Mode panel. The step functions in
``retrieval_utils`` are pure so the pipeline is unit-testable without a
database or an LLM.
"""

import logging
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError
from dataclasses import dataclass, field, replace
from typing import Any

from flask import current_app

from aeva.llm import prompts
from aeva.llm.llm_client import LLMClient
from aeva.media.retrieval_utils import (
    ORIGIN_BOTH,
    ORIGIN_FTS,
    ORIGIN_NEIGHBOR,
    ORIGIN_VECTOR,
    Excerpt,
    RetrievedChunk,
    apply_threshold,
    build_context,
    diversify_by_document,
    fts_query,
    merge_neighbors,
    needs_rewrite,
    rrf_fuse,
)
from aeva.supabase.supabase_service import SupabaseService
from aeva.tracing.services import retrieval_trace

logger = logging.getLogger(__name__)

_RECENT_TURN_CHARS = 600
_RERANK_EXCERPT_CHARS = 700
_MAX_KEYWORDS = 6
_MAX_PARAPHRASES = 2
_COVERAGE_SECTIONS = 6
_CHARS_PER_TOKEN = 4

RERANK_NONE = "none"
RERANK_LLM = "llm"


Records = list[dict[str, Any]]


def partition_media_records(
    records: Records,
) -> tuple[Records, Records, Records]:
    """Split media rows into ``(indexed, images, raw_docs)``.

    ``indexed`` documents are searchable (``ready`` with chunks). ``images``
    are never chunked and ``raw_docs`` are still processing, failed, or
    parsed to zero chunks — both can only be used whole, as attachments.
    """
    indexed: Records = []
    images: Records = []
    raw_docs: Records = []
    for record in records:
        is_ready = record.get("processing_status") == "ready"
        if is_ready and record.get("chunk_count"):
            indexed.append(record)
        elif str(record.get("mime_type", "")).startswith("image/"):
            images.append(record)
        else:
            raw_docs.append(record)
    return indexed, images, raw_docs


def _ms(since: float) -> int:
    """Milliseconds elapsed since a ``perf_counter`` timestamp."""
    return int((time.perf_counter() - since) * 1000)


@dataclass
class RetrievalOptions:
    """Every retrieval knob, with the defaults ``load_env_vars`` mirrors."""

    top_k: int = 8
    hybrid: bool = True
    vector_candidates: int = 24
    fts_candidates: int = 24
    rrf_k: int = 60
    min_similarity: float = 0.40
    floor_similarity: float = 0.25
    min_results: int = 3
    per_doc_min: int = 1
    neighbor_window: int = 1
    context_max_chars: int = 24000
    exact_scan_max: int = 5000
    ef_search: int = 100
    rewrite: bool = True
    rewrite_history_turns: int = 6
    multi_query: bool = True
    rerank: str = RERANK_LLM
    rerank_candidates: int = 20
    rerank_timeout_s: float = 2.5
    embedding_dim: int = 768
    chunk_overlap_chars: int = 256

    @classmethod
    def from_config(cls, **overrides: Any) -> "RetrievalOptions":
        """Read the ``RAG_*`` keys from the Flask config (single reader)."""
        cfg = current_app.config
        defaults = cls()
        base = cls(
            top_k=int(cfg.get("RAG_TOP_K", defaults.top_k)),
            hybrid=bool(cfg.get("RAG_HYBRID", defaults.hybrid)),
            vector_candidates=int(
                cfg.get("RAG_VECTOR_CANDIDATES", defaults.vector_candidates)
            ),
            fts_candidates=int(
                cfg.get("RAG_FTS_CANDIDATES", defaults.fts_candidates)
            ),
            rrf_k=int(cfg.get("RAG_RRF_K", defaults.rrf_k)),
            min_similarity=float(
                cfg.get("RAG_MIN_SIMILARITY", defaults.min_similarity)
            ),
            floor_similarity=float(
                cfg.get("RAG_FLOOR_SIMILARITY", defaults.floor_similarity)
            ),
            min_results=int(cfg.get("RAG_MIN_RESULTS", defaults.min_results)),
            per_doc_min=int(cfg.get("RAG_PER_DOC_MIN", defaults.per_doc_min)),
            neighbor_window=int(
                cfg.get("RAG_NEIGHBOR_WINDOW", defaults.neighbor_window)
            ),
            context_max_chars=int(
                cfg.get("RAG_CONTEXT_MAX_CHARS", defaults.context_max_chars)
            ),
            exact_scan_max=int(
                cfg.get("RAG_EXACT_SCAN_MAX", defaults.exact_scan_max)
            ),
            ef_search=int(cfg.get("RAG_EF_SEARCH", defaults.ef_search)),
            rewrite=bool(cfg.get("RAG_QUERY_REWRITE", defaults.rewrite)),
            rewrite_history_turns=int(
                cfg.get(
                    "RAG_REWRITE_HISTORY_TURNS", defaults.rewrite_history_turns
                )
            ),
            multi_query=bool(cfg.get("RAG_MULTI_QUERY", defaults.multi_query)),
            rerank=str(cfg.get("RAG_RERANK", defaults.rerank)),
            rerank_candidates=int(
                cfg.get("RAG_RERANK_CANDIDATES", defaults.rerank_candidates)
            ),
            rerank_timeout_s=float(
                cfg.get("RAG_RERANK_TIMEOUT_S", defaults.rerank_timeout_s)
            ),
            embedding_dim=int(
                cfg.get("RAG_EMBEDDING_DIM", defaults.embedding_dim)
            ),
            chunk_overlap_chars=int(cfg.get("RAG_CHUNK_OVERLAP", 64))
            * _CHARS_PER_TOKEN,
        )
        return replace(base, **overrides)


@dataclass
class RetrievalResult:
    """What a retrieval produced, ready for a prompt and for the client."""

    chunks: list[RetrievedChunk]
    excerpts: list[Excerpt]
    sources: list[dict[str, Any]]
    context_text: str
    allowed_markers: set[str]
    query_used: str
    diagnostics: dict[str, Any]
    # Section titles the searched files DO cover (only filled when nothing
    # matched), for the graceful "here's what they cover" message.
    coverage: list[str] = field(default_factory=list)

    def is_empty(self) -> bool:
        """Report whether no excerpt survived retrieval."""
        return not self.excerpts


@dataclass
class _Rewrite:
    """Outcome of the (optional) query-rewrite step."""

    query: str
    keywords: list[str] = field(default_factory=list)
    paraphrases: list[str] = field(default_factory=list)


class RetrievalService:
    """Hybrid, rewritten, reranked retrieval over ``media_chunks``."""

    def __init__(
        self,
        supabase: SupabaseService | None = None,
        embed_llm: LLMClient | None = None,
        rewrite_llm: LLMClient | None = None,
    ) -> None:
        self._supabase = supabase
        self._embed_llm = embed_llm
        self._rewrite_llm = rewrite_llm
        self._hybrid_unavailable = False

    @property
    def supabase(self) -> SupabaseService:
        """Lazy Supabase client."""
        return self._supabase or SupabaseService()

    @property
    def embed_llm(self) -> LLMClient:
        """Lazy embedding client."""
        return self._embed_llm or LLMClient(config_key="LLM_EMBEDDING_MODEL")

    @property
    def rewrite_llm(self) -> LLMClient:
        """Lazy fast-model client for rewriting and reranking."""
        return self._rewrite_llm or LLMClient(config_key="LLM_FAST_MODEL")

    # ------------------------------------------------------------------ main

    @retrieval_trace.retrieve
    def retrieve(
        self,
        user_id: str,
        query: str,
        media: list[dict[str, Any]],
        history: list[dict[str, str]] | None = None,
        *,
        options: RetrievalOptions | None = None,
    ) -> RetrievalResult:
        """Run the full pipeline for ``query`` over the given media records.

        ``media`` are the indexed media rows in scope (``id`` + ``file_name``
        are read). ``history`` feeds the rewrite step only.
        """
        opts = options or RetrievalOptions.from_config()
        t_start = time.perf_counter()
        diag: dict[str, Any] = {"query_original": query}
        names = {
            str(m["id"]): str(m.get("file_name") or "document") for m in media
        }
        media_ids = list(names)

        rewrite = self._rewrite(query, history, names, opts, diag)
        chunks = self._search_all(
            user_id, media_ids, names, rewrite, opts, diag
        )
        chunks = self._select(rewrite.query, chunks, opts, diag)

        neighbors: list[RetrievedChunk] = []
        if chunks and opts.neighbor_window > 0:
            neighbors = self._neighbors(user_id, chunks, names, opts)
        diag["neighbors_added"] = len(neighbors)
        excerpts = merge_neighbors(chunks, neighbors, opts.chunk_overlap_chars)
        context, sources, markers = build_context(
            excerpts, max_chars=opts.context_max_chars
        )
        coverage = [] if excerpts else self._coverage(user_id, media_ids)

        diag.update({
            "query_used": rewrite.query,
            "kept": len(chunks),
            "excerpts": len(excerpts),
            "top_similarity": round(
                max((c.similarity for c in chunks), default=0.0), 3
            ),
            "docs_searched": len(media_ids),
            "docs_hit": len({c.media_id for c in chunks}),
            "context_chars": len(context),
            "total_ms": _ms(t_start),
        })
        logger.info(
            "Retrieval | mode=%s exact=%s candidates=%s kept=%d excerpts=%d "
            "top_sim=%.3f rewritten=%s reranked=%s | %dms",
            diag.get("mode"),
            diag.get("exact_scan"),
            diag.get("candidates"),
            len(chunks),
            len(excerpts),
            diag["top_similarity"],
            diag.get("rewritten"),
            diag.get("reranked"),
            diag["total_ms"],
        )
        return RetrievalResult(
            chunks=chunks,
            excerpts=excerpts,
            sources=sources,
            context_text=context,
            allowed_markers=markers,
            query_used=rewrite.query,
            diagnostics=diag,
            coverage=coverage,
        )

    # --------------------------------------------------------------- rewrite

    @retrieval_trace.rewrite
    def _rewrite(
        self,
        query: str,
        history: list[dict[str, str]] | None,
        names: dict[str, str],
        opts: RetrievalOptions,
        diag: dict[str, Any],
    ) -> _Rewrite:
        """Resolve follow-ups into a standalone query (+ keywords/paraphrases).

        Called when the message needs conversation context, or whenever
        multi-query is on (the paraphrases come from the same call). Any
        failure falls back to the raw message — retrieval never breaks here.
        """
        wants_rewrite = opts.rewrite and needs_rewrite(query, history)
        diag["is_followup"] = wants_rewrite
        if not wants_rewrite and not opts.multi_query:
            diag["rewritten"] = False
            return _Rewrite(query=query)

        turns = (history or [])[-opts.rewrite_history_turns :]
        recent = "\n".join(
            f"{t.get('role', 'user')}: "
            f"{(t.get('content') or '')[:_RECENT_TURN_CHARS]}"
            for t in turns
        ) or "(no earlier turns)"
        rendered = prompts.PromptBuilder.build(
            prompts.QUERY_REWRITE_TEMPLATE,
            RECENT_TURNS=recent,
            FILE_NAMES=", ".join(names.values()) or "(none)",
            USER_MESSAGE=query,
            PARAPHRASE_RULE=(
                prompts.PARAPHRASE_RULE_ON
                if opts.multi_query
                else prompts.PARAPHRASE_RULE_OFF
            ),
        )
        t_rewrite = time.perf_counter()
        try:
            data = self.rewrite_llm.generate_structured(
                rendered.user_message,
                prompts.QUERY_REWRITE_SCHEMA,
                system_prompt=rendered.system_prompt,
                log_label="rag_rewrite",
            )
        except Exception:  # noqa: BLE001 - degrade to the raw query
            logger.warning("Query rewrite failed; using the raw message")
            diag["rewritten"] = False
            diag["rewrite_ms"] = _ms(t_rewrite)
            return _Rewrite(query=query)
        diag["rewrite_ms"] = _ms(t_rewrite)

        standalone = str(data.get("standalone_query") or "").strip()
        if not wants_rewrite:
            # Only paraphrases were wanted; keep the student's own words.
            standalone = query
        result = _Rewrite(
            query=standalone or query,
            keywords=[
                str(k).strip()
                for k in (data.get("keywords") or [])
                if str(k).strip()
            ][:_MAX_KEYWORDS],
            paraphrases=[
                str(p).strip()
                for p in (data.get("paraphrases") or [])
                if str(p).strip()
            ][:_MAX_PARAPHRASES]
            if opts.multi_query
            else [],
        )
        diag["rewritten"] = result.query != query
        diag["keywords"] = result.keywords
        diag["paraphrases"] = result.paraphrases
        return result

    # ---------------------------------------------------------------- search

    @retrieval_trace.search
    def _search_all(
        self,
        user_id: str,
        media_ids: list[str],
        names: dict[str, str],
        rewrite: _Rewrite,
        opts: RetrievalOptions,
        diag: dict[str, Any],
    ) -> list[RetrievedChunk]:
        """Embed every query variant, search each, fuse into one ranking."""
        queries = [rewrite.query, *rewrite.paraphrases]
        t_embed = time.perf_counter()
        vectors = self.embed_llm.embed(
            queries,
            task_type="RETRIEVAL_QUERY",
            output_dimensionality=opts.embedding_dim,
        )
        diag["embed_ms"] = _ms(t_embed)
        diag["query_variants"] = len(vectors)

        keyword_query = (
            fts_query(rewrite.query, rewrite.keywords) if opts.hybrid else ""
        )
        diag["fts_query"] = keyword_query or None

        rows_by_id: dict[str, dict[str, Any]] = {}
        rankings: list[list[str]] = []
        t_search = time.perf_counter()
        for vector in vectors:
            rows = self._search(
                vector, keyword_query, user_id, media_ids, opts, diag
            )
            rankings.append([str(r["id"]) for r in rows])
            for row in rows:
                rows_by_id.setdefault(str(row["id"]), row)
        diag["search_ms"] = _ms(t_search)

        if len(rankings) > 1:
            fused = rrf_fuse(rankings, opts.rrf_k)
        else:
            fused = {
                cid: float(
                    rows_by_id[cid].get("rrf_score")
                    or 1.0 / (opts.rrf_k + rank)
                )
                for rank, cid in enumerate(rankings[0] if rankings else [], 1)
            }
        chunks = [
            self._to_chunk(rows_by_id[cid], names, score)
            for cid, score in fused.items()
        ]
        chunks.sort(key=lambda c: c.score, reverse=True)
        diag["candidates"] = len(chunks)
        return chunks

    @retrieval_trace.search_variant
    def _search(
        self,
        vector: list[float],
        keyword_query: str,
        user_id: str,
        media_ids: list[str],
        opts: RetrievalOptions,
        diag: dict[str, Any],
    ) -> list[dict[str, Any]]:
        """One search call: hybrid RPC, or vector-only when unavailable."""
        candidates = max(opts.vector_candidates, opts.fts_candidates)
        if opts.hybrid and not self._hybrid_unavailable:
            try:
                rows = self.supabase.search_chunks_hybrid(
                    vector,
                    keyword_query,
                    user_id,
                    media_ids or None,
                    top_k=candidates,
                    vector_candidates=opts.vector_candidates,
                    fts_candidates=opts.fts_candidates,
                    rrf_k=opts.rrf_k,
                    exact_scan_max=opts.exact_scan_max,
                    ef_search=opts.ef_search,
                )
            except Exception:  # noqa: BLE001 - migration 023 not applied
                logger.warning(
                    "Hybrid search RPC unavailable; falling back to vector "
                    "search (apply migration 023_rag_hybrid.sql)",
                    exc_info=True,
                )
                self._hybrid_unavailable = True
            else:
                diag["mode"] = "hybrid"
                if rows:
                    diag["exact_scan"] = bool(rows[0].get("exact_scan"))
                return rows
        diag["mode"] = "vector_fallback" if opts.hybrid else "vector"
        return self.supabase.match_chunks(
            vector, user_id, media_ids=media_ids or None, top_k=candidates
        )

    @staticmethod
    def _to_chunk(
        row: dict[str, Any], names: dict[str, str], score: float
    ) -> RetrievedChunk:
        """Convert an RPC row into a ``RetrievedChunk``."""
        vector_rank = row.get("vector_rank")
        text_rank = row.get("text_rank")
        if vector_rank is not None and text_rank is not None:
            origin = ORIGIN_BOTH
        elif text_rank is not None:
            origin = ORIGIN_FTS
        else:
            origin = ORIGIN_VECTOR
        media_id = str(row["media_id"])
        return RetrievedChunk(
            id=str(row["id"]),
            media_id=media_id,
            document_name=names.get(media_id, "document"),
            chunk_index=int(row.get("chunk_index") or 0),
            content=str(row.get("content") or ""),
            page_number=row.get("page_number"),
            section=row.get("section") or None,
            similarity=float(row.get("similarity") or 0.0),
            score=score,
            fts_rank=row.get("fts_rank"),
            vector_rank=vector_rank,
            text_rank=text_rank,
            origin=origin,
        )

    # ---------------------------------------------------------------- select

    def _select(
        self,
        query: str,
        chunks: list[RetrievedChunk],
        opts: RetrievalOptions,
        diag: dict[str, Any],
    ) -> list[RetrievedChunk]:
        """Threshold, per-document quota, optional rerank, final cut."""
        chunks = apply_threshold(
            chunks,
            min_similarity=opts.min_similarity,
            floor_similarity=opts.floor_similarity,
            min_results=opts.min_results,
        )
        diag["after_threshold"] = len(chunks)
        use_rerank = opts.rerank == RERANK_LLM and len(chunks) > 1
        limit = opts.rerank_candidates if use_rerank else opts.top_k
        chunks = diversify_by_document(chunks, limit, opts.per_doc_min)
        diag["after_quota"] = len(chunks)
        if use_rerank:
            chunks = self._rerank(query, chunks, opts, diag)
        else:
            diag["reranked"] = False
        return chunks[: opts.top_k]

    @retrieval_trace.rerank
    def _rerank(
        self,
        query: str,
        chunks: list[RetrievedChunk],
        opts: RetrievalOptions,
        diag: dict[str, Any],
    ) -> list[RetrievedChunk]:
        """Listwise rerank on the fast model with a hard timeout.

        Runs in a worker thread so ``future.result(timeout)`` bounds the
        wait; on timeout or any error the pre-rerank order is kept and the
        (still running) call is abandoned.
        """
        excerpts = "\n\n".join(
            f"[{i}] {c.content[:_RERANK_EXCERPT_CHARS]}"
            for i, c in enumerate(chunks)
        )
        rendered = prompts.PromptBuilder.build(
            prompts.RERANK_TEMPLATE, QUERY=query, EXCERPTS=excerpts
        )
        app = current_app._get_current_object()  # type: ignore[attr-defined]  # noqa: SLF001
        llm = self.rewrite_llm

        @retrieval_trace.rerank_call
        def call() -> dict[str, Any]:
            with app.app_context():
                return llm.generate_structured(
                    rendered.user_message,
                    prompts.RERANK_SCHEMA,
                    system_prompt=rendered.system_prompt,
                    log_label="rag_rerank",
                )

        t_rerank = time.perf_counter()
        pool = ThreadPoolExecutor(max_workers=1)
        try:
            data = pool.submit(call).result(timeout=opts.rerank_timeout_s)
        except FutureTimeoutError:
            logger.warning("Rerank timed out; keeping retrieval order")
            diag["reranked"] = False
            diag["rerank_timeout"] = True
            return chunks
        except Exception:  # noqa: BLE001 - keep the pre-rerank order
            logger.warning("Rerank failed; keeping retrieval order")
            diag["reranked"] = False
            return chunks
        finally:
            pool.shutdown(wait=False)
            diag["rerank_ms"] = _ms(t_rerank)

        scores: dict[int, float] = {}
        for item in data.get("scores") or []:
            if not isinstance(item, dict):
                continue
            try:
                index = int(item.get("index"))  # type: ignore[arg-type]
                score = float(item.get("score"))  # type: ignore[arg-type]
            except (TypeError, ValueError):
                continue
            if 0 <= index < len(chunks):
                scores[index] = score
        if not scores:
            diag["reranked"] = False
            return chunks
        order = sorted(
            range(len(chunks)), key=lambda i: (-scores.get(i, -1.0), i)
        )
        diag["reranked"] = True
        return [chunks[i] for i in order]

    # ------------------------------------------------------------ neighbours

    def _neighbors(
        self,
        user_id: str,
        chunks: list[RetrievedChunk],
        names: dict[str, str],
        opts: RetrievalOptions,
    ) -> list[RetrievedChunk]:
        """Fetch chunk_index ± window around every hit (not already held)."""
        anchors = [(c.media_id, c.chunk_index) for c in chunks]
        held = {c.id for c in chunks}
        try:
            rows = self.supabase.fetch_adjacent_chunks(
                user_id, anchors, opts.neighbor_window
            )
        except Exception:  # noqa: BLE001 - neighbours are a nicety
            logger.warning("Neighbour fetch failed; using hits only")
            return []
        return [
            replace(self._to_chunk(row, names, 0.0), origin=ORIGIN_NEIGHBOR)
            for row in rows
            if str(row.get("id")) not in held
        ]

    def _coverage(self, user_id: str, media_ids: list[str]) -> list[str]:
        """Distinct section titles the searched files cover (for the UX)."""
        try:
            rows = self.supabase.list_chunk_sections(user_id, media_ids)
        except Exception:  # noqa: BLE001 - purely cosmetic
            return []
        seen: list[str] = []
        for row in rows:
            section = str(row.get("section") or "").strip()
            if section and section not in seen:
                seen.append(section)
            if len(seen) >= _COVERAGE_SECTIONS:
                break
        return seen
