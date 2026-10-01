"""Tracing of retrieval and of generator grounding.

``aeva.media.retrieval`` and ``aeva.media.grounding`` contain no tracing
logic: they import this module and put one decorator on each function that
is a step of the trace. The decorators read a step's arguments, the ``diag``
dict the pipeline already fills, and the value the step returns; what is
recorded and how it is worded lives here::

    retrieval "retrieve"          @retrieve         RetrievalService.retrieve
    ├─ retrieval "rewrite"        @rewrite          ._rewrite
    ├─ embedding "embed"          (the LLM client records it)
    ├─ retrieval "search"         @search           ._search_all
    │                             @search_variant   ._search (one per variant)
    └─ retrieval "rerank"         @rerank           ._rerank
                                  @rerank_call      its worker-thread call
    decision "grounding"          @grounding        ground_generator

Rules every decorator here keeps:

* no trace being recorded → the wrapped function is called and nothing else
  happens;
* the wrapped function's result and exceptions pass through unchanged;
* the bookkeeping cannot raise into the turn (``_quiet``);
* spans hold references only (chunk ids, scores, sizes): never chunk text,
  query vectors or attachment bytes;
* nothing is kept on the retrieval service, which is a process-wide
  singleton: what one step must tell another travels in ``tracing.state()``,
  in a slot owned by the running thread.
"""

import functools
import inspect
import logging
import threading
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any, ParamSpec, TypeVar

from aeva import tracing

logger = logging.getLogger(__name__)

_P = ParamSpec("_P")
_R = TypeVar("_R")

# Mirrors ``aeva.media.retrieval.RERANK_LLM`` (not imported: that module
# imports this one). A test keeps the two equal.
RERANK_LLM = "llm"

# ``tracing.state()`` slots, one per kind of call and per thread.
_RETRIEVE = "retrieve"
_SEARCH = "search"
_RERANK = "rerank"
_GROUNDING = "grounding"

# The exception behind a failed rewrite is swallowed inside ``_rewrite``; a
# decorator cannot see it, so the span says where to find it.
_REWRITE_FAILED = (
    "The rewrite call failed, so the raw message was used. The error itself "
    "is on the LLM call inside this step."
)


@dataclass
class _RetrieveCall:
    """One running ``retrieve`` call."""

    span: tracing.SpanHandle
    payload: dict[str, Any] = field(default_factory=dict)
    # The resolved ``RetrievalOptions`` (known once the first stage ran).
    options: Any = None
    rerank_ran: bool = False


@dataclass
class _SearchCall:
    """One running ``_search_all`` call: its span and per-variant results."""

    queries: list[str] = field(default_factory=list)
    span: tracing.SpanHandle | None = None
    variants: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class _RerankCall:
    """What the rerank model call did on its worker thread."""

    finished: bool = False
    data: Any = None
    error: BaseException | None = None


@dataclass
class _GroundingCall:
    """What the retrieval inside one ``ground_generator`` call searched."""

    query: str | None = None
    searched: list[str] | None = None


# ------------------------------------------------------------------ plumbing


def _quiet(func: Callable[_P, None]) -> Callable[_P, None]:
    """Make a bookkeeping function unable to raise into the turn."""

    @functools.wraps(func)
    def safe(*args: _P.args, **kwargs: _P.kwargs) -> None:
        try:
            func(*args, **kwargs)
        except Exception:  # noqa: BLE001 — tracing must never break a turn.
            logger.debug("retrieval trace failed", exc_info=True)

    return safe


def _arguments(
    signature: inspect.Signature,
    args: tuple[object, ...],
    kwargs: Mapping[str, object],
) -> dict[str, Any]:
    """Map the wrapped call's arguments by parameter name (``{}`` if odd)."""
    try:
        bound = signature.bind(*args, **kwargs)
        bound.apply_defaults()
        return dict(bound.arguments)
    except Exception:  # noqa: BLE001 — the wrapped call reports a bad call.
        return {}


def _key(slot: str) -> str:
    """``tracing.state()`` key of ``slot`` for the running thread."""
    return f"retrieval_trace.{slot}.{threading.get_ident()}"


def _push(slot: str, value: object) -> object:
    """Put ``value`` in the thread's slot; returns what was there."""
    try:
        state = tracing.state()
        previous = state.get(_key(slot))
        state[_key(slot)] = value
    except Exception:  # noqa: BLE001 — tracing must never break a turn.
        return None
    return previous


def _pop(slot: str, previous: object) -> None:
    """Give the thread's slot back to whoever held it before ``_push``."""
    try:
        if previous is None:
            tracing.state().pop(_key(slot), None)
        else:
            tracing.state()[_key(slot)] = previous
    except Exception:  # noqa: BLE001 — tracing must never break a turn.
        logger.debug("retrieval trace failed", exc_info=True)


def _peek(slot: str) -> Any:
    """Return what the running thread holds in ``slot`` (else ``None``)."""
    try:
        return tracing.state().get(_key(slot))
    except Exception:  # noqa: BLE001 — tracing must never break a turn.
        return None


def _chunk_ids(chunks: Any) -> list[str]:
    """Ids of a ranking, in order (``[]`` when it cannot be read)."""
    try:
        return [chunk.id for chunk in chunks]
    except Exception:  # noqa: BLE001 — tracing must never break a turn.
        return []


def _chunk_refs(chunks: Any) -> list[dict[str, Any]]:
    """Trace view of a ranking: ids, scores and origin — never the text."""
    return [
        {
            "id": chunk.id,
            "media_id": chunk.media_id,
            "chunk_index": chunk.chunk_index,
            "score": round(chunk.score, 5),
            "origin": chunk.origin,
            "similarity": round(chunk.similarity, 3),
            "page_number": chunk.page_number,
        }
        for chunk in chunks
    ]


def _file_names(records: Any) -> list[str]:
    """File names of media records."""
    return [
        str(record.get("file_name") or record.get("id") or "")
        for record in records or []
    ]


# ------------------------------------------------------------------ retrieve


def retrieve(func: Callable[_P, _R]) -> Callable[_P, _R]:
    """Record ``RetrievalService.retrieve`` as a ``retrieve`` span.

    The stages decorated below nest under it. Output: references to what
    was kept (see ``_retrieve_output``) and the pipeline's diagnostics.
    """
    signature = inspect.signature(func)

    @functools.wraps(func)
    def wrapper(*args: _P.args, **kwargs: _P.kwargs) -> _R:
        if not tracing.is_active():
            return func(*args, **kwargs)
        given = _arguments(signature, args, kwargs)
        with tracing.span(tracing.KIND_RETRIEVAL, "retrieve") as span:
            call = _RetrieveCall(span=span)
            previous = _push(_RETRIEVE, call)
            _retrieve_started(call, given)
            try:
                result = func(*args, **kwargs)
            finally:
                _pop(_RETRIEVE, previous)
            _retrieve_finished(call, result)
            return result

    return wrapper


@_quiet
def _retrieve_started(call: _RetrieveCall, given: dict[str, Any]) -> None:
    """Record the input of a ``retrieve`` call."""
    media = given.get("media") or []
    names = {
        str(record["id"]): str(record.get("file_name") or "document")
        for record in media
    }
    call.options = given.get("options")
    call.payload = {
        "query": given.get("query"),
        "media": [
            {"id": media_id, "name": name} for media_id, name in names.items()
        ],
        # ``None`` until the first stage shows the options read from config.
        "options": call.options,
        "history_turns": len(given.get("history") or []),
    }
    call.span.set(input=call.payload)
    owner = _peek(_GROUNDING)
    if isinstance(owner, _GroundingCall):
        # Called by ``ground_generator``: its decision names these files.
        owner.query = str(given.get("query") or "")
        owner.searched = _file_names(media)


@_quiet
def _options_resolved(options: Any) -> None:
    """Put the options a stage received on the running ``retrieve`` span."""
    call = _peek(_RETRIEVE)
    if not isinstance(call, _RetrieveCall) or call.options is not None:
        return
    call.options = options
    call.payload["options"] = options
    call.span.set(input=call.payload)


@_quiet
def _retrieve_finished(call: _RetrieveCall, result: Any) -> None:
    """Record what a ``retrieve`` call produced."""
    diag = result.diagnostics
    if not call.rerank_ran and "rerank_ms" not in diag:
        off = getattr(call.options, "rerank", None) != RERANK_LLM
        tracing.event(
            tracing.KIND_RETRIEVAL,
            "rerank",
            output={"reranked": False, "candidates": diag.get("after_quota")},
            meta={
                "reason": (
                    "reranking is off for this call"
                    if off
                    else "fewer than two chunks to order"
                )
            },
            status=tracing.STATUS_SKIPPED,
        )
    call.span.set(output=_retrieve_output(result))


def _retrieve_output(result: Any) -> dict[str, Any]:
    """Summarise a ``RetrievalResult`` for the trace.

    References and scores only: the excerpt text itself is already in the
    prompt of the LLM call that consumes it.
    """
    return {
        "query_used": result.query_used,
        "chunks": _chunk_refs(result.chunks),
        "excerpts": [
            {
                "media_id": excerpt.media_id,
                "document_name": excerpt.document_name,
                "page_number": excerpt.page_number,
                "section": excerpt.section,
                "chunk_ids": list(excerpt.chunk_ids),
                "first_index": excerpt.first_index,
                "last_index": excerpt.last_index,
                "score": round(excerpt.score, 5),
                "origins": list(excerpt.origins),
                "chars": len(excerpt.content),
            }
            for excerpt in result.excerpts
        ],
        "sources": [
            {k: v for k, v in source.items() if k != "snippet"}
            for source in result.sources
        ],
        "context_chars": len(result.context_text),
        "coverage": result.coverage,
        "diagnostics": result.diagnostics,
    }


# ------------------------------------------------------------------- rewrite


def rewrite(func: Callable[_P, _R]) -> Callable[_P, _R]:
    """Record ``RetrievalService._rewrite`` as a ``rewrite`` span.

    Which of its three outcomes happened (no model call, a failed call that
    fell back to the raw message, a rewritten query) is read from ``diag``.
    """
    signature = inspect.signature(func)

    @functools.wraps(func)
    def wrapper(*args: _P.args, **kwargs: _P.kwargs) -> _R:
        if not tracing.is_active():
            return func(*args, **kwargs)
        given = _arguments(signature, args, kwargs)
        _options_resolved(given.get("opts"))
        with tracing.span(tracing.KIND_RETRIEVAL, "rewrite") as span:
            try:
                result = func(*args, **kwargs)
            finally:
                _rewrite_input(span, given)
            _rewrite_output(span, given, result)
            return result

    return wrapper


@_quiet
def _rewrite_input(span: tracing.SpanHandle, given: dict[str, Any]) -> None:
    """Record what the rewrite step was asked (known once it has run)."""
    diag = given.get("diag") or {}
    span.set(
        input={
            "query": given.get("query"),
            "history_turns": len(given.get("history") or []),
            "needs_context": diag.get("is_followup"),
            "multi_query": getattr(given.get("opts"), "multi_query", None),
        }
    )


@_quiet
def _rewrite_output(
    span: tracing.SpanHandle, given: dict[str, Any], result: Any
) -> None:
    """Record how the rewrite step ended."""
    query = given.get("query")
    diag = given.get("diag") or {}
    if "rewrite_ms" not in diag:
        span.set(
            output={"llm_called": False, "query": query},
            meta={
                "reason": (
                    "the message needs no conversation context (or "
                    "rewriting is off) and multi-query is off"
                )
            },
            status=tracing.STATUS_SKIPPED,
        )
        return
    if "keywords" not in diag:
        # The call raised and ``_rewrite`` fell back to the raw message.
        span.set(
            output={"llm_called": True, "fallback": True, "query": query},
            status=tracing.STATUS_ERROR,
            error=_REWRITE_FAILED,
        )
        return
    span.set(
        output={
            "llm_called": True,
            "query": result.query,
            "rewritten": result.query != query,
            "keywords": result.keywords,
            "paraphrases": result.paraphrases,
            # False: the call was made for paraphrases only and the
            # model's standalone query was discarded.
            "standalone_used": bool(diag.get("is_followup")),
        }
    )


# -------------------------------------------------------------------- search


def search(func: Callable[_P, _R]) -> Callable[_P, _R]:
    """Record ``RetrievalService._search_all`` as one ``search`` span.

    The span itself opens at the first per-variant search (see
    ``search_variant``), so the embedding call that precedes it stays a
    sibling under ``retrieve`` and is not counted as search time.
    """
    signature = inspect.signature(func)

    @functools.wraps(func)
    def wrapper(*args: _P.args, **kwargs: _P.kwargs) -> _R:
        if not tracing.is_active():
            return func(*args, **kwargs)
        given = _arguments(signature, args, kwargs)
        call = _SearchCall()
        _search_started(call, given)
        previous = _push(_SEARCH, call)
        try:
            chunks = func(*args, **kwargs)
        except BaseException as exc:
            _search_failed(call, exc)
            raise
        finally:
            _pop(_SEARCH, previous)
        _search_finished(call, given, chunks)
        return chunks

    return wrapper


def search_variant(func: Callable[_P, _R]) -> Callable[_P, _R]:
    """Note one ``RetrievalService._search`` call on the ``search`` span.

    ``diag["mode"]`` is overwritten per variant; this keeps each one.
    Outside a ``_search_all`` call it records nothing.
    """
    signature = inspect.signature(func)

    @functools.wraps(func)
    def wrapper(*args: _P.args, **kwargs: _P.kwargs) -> _R:
        if not tracing.is_active():
            return func(*args, **kwargs)
        call = _peek(_SEARCH)
        if not isinstance(call, _SearchCall):
            return func(*args, **kwargs)
        given = _arguments(signature, args, kwargs)
        _search_opened(call, given)
        rows = func(*args, **kwargs)
        _search_variant(call, given, rows)
        return rows

    return wrapper


@_quiet
def _search_started(call: _SearchCall, given: dict[str, Any]) -> None:
    """Remember the query variants about to be searched."""
    rewritten = given["rewrite"]
    call.queries = [rewritten.query, *rewritten.paraphrases]


def _search_input(call: _SearchCall, given: dict[str, Any]) -> dict[str, Any]:
    """Input of the ``search`` span (the query texts, never the vectors)."""
    opts = given.get("opts")
    diag = given.get("diag") or {}
    return {
        "queries": call.queries,
        "fts_query": diag.get("fts_query"),
        "hybrid": getattr(opts, "hybrid", None),
        "media_ids": given.get("media_ids"),
        "candidates_per_query": max(
            getattr(opts, "vector_candidates", 0),
            getattr(opts, "fts_candidates", 0),
        ),
    }


@_quiet
def _search_opened(call: _SearchCall, given: dict[str, Any]) -> None:
    """Open the ``search`` span when the first variant is searched."""
    if call.span is None:
        call.span = tracing.begin(
            tracing.KIND_RETRIEVAL, "search", input=_search_input(call, given)
        )


@_quiet
def _search_variant(
    call: _SearchCall, given: dict[str, Any], rows: Any
) -> None:
    """Record what one query variant returned."""
    index = len(call.variants)
    diag = given.get("diag") or {}
    call.variants.append(
        {
            "query": call.queries[index] if index < len(call.queries) else None,
            "mode": diag.get("mode"),
            "rows": len(rows),
        }
    )


@_quiet
def _search_failed(call: _SearchCall, error: BaseException) -> None:
    """Close the ``search`` span of a search that raised."""
    if call.span is not None:
        call.span.end(status=tracing.STATUS_ERROR, error=error)


@_quiet
def _search_finished(
    call: _SearchCall, given: dict[str, Any], chunks: Any
) -> None:
    """Record the fused ranking and close the ``search`` span."""
    try:
        diag = given.get("diag") or {}
        output = {
            "mode": diag.get("mode"),
            "exact_scan": diag.get("exact_scan"),
            "variants": call.variants,
            "fusion": "rrf" if len(call.variants) > 1 else "single",
            "candidates": len(chunks),
            "ranking": _chunk_refs(chunks),
        }
        # Sticky per process: one failed hybrid RPC downgrades every later
        # search to vector-only until a restart.
        meta = {
            "hybrid_unavailable": bool(
                getattr(given.get("self"), "_hybrid_unavailable", False)
            )
        }
        if call.span is None:
            # No variant was searched (the embedding returned no vector).
            tracing.event(
                tracing.KIND_RETRIEVAL,
                "search",
                input=_search_input(call, given),
                output=output,
                meta=meta,
            )
        else:
            call.span.end(output=output, meta=meta)
    finally:
        # Whatever happened above, the trace position must leave the span.
        if call.span is not None:
            call.span.end()


# -------------------------------------------------------------------- rerank


def rerank(func: Callable[_P, _R]) -> Callable[_P, _R]:
    """Record ``RetrievalService._rerank`` as a ``rerank`` span.

    Ends ``timeout`` when the pool gave up waiting and ``error`` when the
    model call raised; in both cases retrieval keeps its own order.
    """
    signature = inspect.signature(func)

    @functools.wraps(func)
    def wrapper(*args: _P.args, **kwargs: _P.kwargs) -> _R:
        if not tracing.is_active():
            return func(*args, **kwargs)
        given = _arguments(signature, args, kwargs)
        before = _chunk_ids(given.get("chunks"))
        with tracing.span(
            tracing.KIND_RETRIEVAL,
            "rerank",
            input=_rerank_input(given, before),
        ) as span:
            call = _RerankCall()
            _rerank_started()
            previous = _push(_RERANK, call)
            try:
                result = func(*args, **kwargs)
            finally:
                _pop(_RERANK, previous)
            _rerank_finished(span, call, given, before, result)
            return result

    return wrapper


def _rerank_input(given: dict[str, Any], before: list[str]) -> dict[str, Any]:
    """Describe what the rerank step was asked to reorder."""
    try:
        return {
            "query": given.get("query"),
            "candidates": before,
            "timeout_s": getattr(given.get("opts"), "rerank_timeout_s", None),
        }
    except Exception:  # noqa: BLE001 — tracing must never break a turn.
        logger.debug("retrieval trace failed", exc_info=True)
        return {"candidates": before}


def rerank_call(func: Callable[_P, _R]) -> Callable[_P, _R]:
    """Carry the trace into the rerank model call's worker thread.

    Decorates the function ``_rerank`` submits to its pool: the LLM span it
    records nests under the ``rerank`` span although it runs on another
    thread, and what the call returned or raised is kept for that span. It
    may finish after ``_rerank`` stopped waiting; nothing here blocks on it.
    Returns ``func`` itself when no trace is being recorded.
    """
    if not tracing.is_active():
        return func
    call = _peek(_RERANK)
    carried = tracing.carry(func)

    @functools.wraps(func)
    def runner(*args: _P.args, **kwargs: _P.kwargs) -> _R:
        try:
            data = carried(*args, **kwargs)
        except BaseException as exc:
            if isinstance(call, _RerankCall):
                call.error = exc
            raise
        if isinstance(call, _RerankCall):
            call.data = data
            call.finished = True
        return data

    return runner


@_quiet
def _rerank_started() -> None:
    """Tell the running ``retrieve`` call that reranking was attempted."""
    call = _peek(_RETRIEVE)
    if isinstance(call, _RetrieveCall):
        call.rerank_ran = True


def _rerank_output(
    before: list[str],
    after: list[str],
    *,
    reranked: bool = False,
    scores: dict[str, float] | None = None,
    timed_out: bool = False,
) -> dict[str, Any]:
    """Trace output of the rerank step (chunk ids, in ranking order)."""
    return {
        "reranked": reranked,
        "timed_out": timed_out,
        "order_before": before,
        "order_after": after,
        "scores": scores or {},
    }


def _rerank_scores(
    data: Any, before: list[str], after: list[str]
) -> dict[str, float]:
    """Return the model's usable scores by chunk id.

    Read from the model's answer the way ``_rerank`` reads it; left out
    (``{}``) if they do not explain the order ``_rerank`` returned.
    """
    if not isinstance(data, dict):
        return {}
    scores: dict[int, float] = {}
    for item in data.get("scores") or []:
        if not isinstance(item, dict):
            continue
        try:
            index = int(item.get("index"))  # type: ignore[arg-type]
            score = float(item.get("score"))  # type: ignore[arg-type]
        except (TypeError, ValueError):
            continue
        if 0 <= index < len(before):
            scores[index] = score
    order = sorted(range(len(before)), key=lambda i: (-scores.get(i, -1.0), i))
    if [before[i] for i in order] != after:
        return {}
    return {before[i]: score for i, score in scores.items()}


@_quiet
def _rerank_finished(
    span: tracing.SpanHandle,
    call: _RerankCall,
    given: dict[str, Any],
    before: list[str],
    result: Any,
) -> None:
    """Record how the rerank step ended."""
    diag = given.get("diag") or {}
    if diag.get("rerank_timeout"):
        # The abandoned call keeps running; if it finishes before the turn
        # does, its LLM span still lands under this one. ``error`` is set
        # only when the call itself raised (a timeout error of its own is
        # treated by retrieval exactly like the pool giving up).
        span.set(
            output=_rerank_output(before, before, timed_out=True),
            status=tracing.STATUS_TIMEOUT,
            error=call.error,
        )
    elif call.error is not None:
        span.set(
            output=_rerank_output(before, before),
            status=tracing.STATUS_ERROR,
            error=call.error,
        )
    elif diag.get("reranked"):
        after = _chunk_ids(result)
        span.set(
            output=_rerank_output(
                before,
                after,
                reranked=True,
                scores=_rerank_scores(call.data, before, after),
            )
        )
    else:
        span.set(
            output=_rerank_output(before, before),
            meta={
                "reason": "the model returned no usable scores"
                if call.finished
                else "the rerank call failed or returned no usable scores"
            },
        )


# ----------------------------------------------------------------- grounding


def grounding(func: Callable[_P, _R]) -> Callable[_P, _R]:
    """Record which material ``ground_generator`` chose, as a decision.

    ``source`` is the winner in priority order: ``prior_output`` (an
    earlier agent's hand-off), ``retrieved_excerpts``, ``whole_files``
    (attachments only) or ``none``.
    """
    signature = inspect.signature(func)

    @functools.wraps(func)
    def wrapper(*args: _P.args, **kwargs: _P.kwargs) -> _R:
        if not tracing.is_active():
            return func(*args, **kwargs)
        call = _GroundingCall()
        previous = _push(_GROUNDING, call)
        try:
            result = func(*args, **kwargs)
        finally:
            _pop(_GROUNDING, previous)
        _grounding_decided(call, _arguments(signature, args, kwargs), result)
        return result

    return wrapper


def _grounding_source(result: Any) -> str:
    """Name the material that won, in the generator's priority order."""
    if result.from_prior:
        return "prior_output"
    if result.source_context:
        return "retrieved_excerpts"
    if result.attachments:
        return "whole_files"
    return "none"


def _grounding_reason(
    source: str,
    ctx: Any,
    *,
    wants_media: bool,
    prior_chars: int,
    searched: bool,
) -> str:
    """Say in one sentence why ``source`` is the material."""
    if source == "prior_output":
        return (
            "An earlier agent of this turn produced text, which always wins "
            "over the student's files."
            if prior_chars
            else "An earlier agent ran but produced no text; its empty "
            "hand-off still replaced the student's files."
        )
    if source == "retrieved_excerpts":
        return "Excerpts retrieved from the indexed files are the material."
    if source == "whole_files":
        return (
            "Retrieval found nothing in the indexed files, so they are "
            "attached whole."
            if searched
            else "Nothing in scope is indexed: the files are attached whole."
        )
    if not wants_media:
        return (
            "No prior agent output, and the generator was not asked to use "
            "files."
        )
    if not ctx.media_ids:
        return "No prior agent output and no files in scope."
    return "The files in scope gave no excerpts and no attachments."


@_quiet
def _grounding_decided(
    call: _GroundingCall, given: dict[str, Any], result: Any
) -> None:
    """Record the grounding decision of one ``ground_generator`` call."""
    ctx = given["ctx"]
    wants_media = bool(given.get("wants_media"))
    prior = list(ctx.prior_results or [])
    # What the hand-off really carried (blank text is skipped by the
    # block builder, which then renders its header alone).
    prior_chars = sum(len((item.text or "").strip()) for item in prior)
    diagnostics = result.diagnostics
    searched = call.searched is not None or diagnostics is not None
    query = call.query
    if query is None and isinstance(diagnostics, dict):
        query = diagnostics.get("query_original")
    attachments = result.attachments or []
    source = _grounding_source(result)
    reason = _grounding_reason(
        source,
        ctx,
        wants_media=wants_media,
        prior_chars=prior_chars,
        searched=searched,
    )
    files: dict[str, Any] = {}
    if searched or attachments:
        files = {
            # Files the retrieval searched, and what was attached whole
            # (type and size only: the bytes never enter the trace).
            "indexed": call.searched or [],
            "attached": [
                {
                    "mime_type": item.get("mime_type"),
                    "bytes": len(item.get("data") or b""),
                }
                for item in attachments
            ],
        }
    tracing.event(
        tracing.KIND_DECISION,
        "grounding",
        input={
            "topic": given.get("topic"),
            "wants_media": wants_media,
            "media_ids": ctx.media_ids,
            "prior_results": [item.tool for item in prior],
        },
        output={
            "source": source,
            "retrieval_query": query,
            "source_context_chars": len(result.source_context),
            "prior_text_chars": prior_chars,
            "attachments": len(attachments),
            "source_media_ids": result.source_media_ids,
            "files": files,
            "grounded": result.grounded,
        },
        meta={"reason": reason},
    )
