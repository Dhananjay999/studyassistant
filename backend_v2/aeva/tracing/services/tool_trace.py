"""Tracing of the decisions individual tools make.

The tools under ``aeva.mcp.tools`` contain no tracing logic: each imports
this module and adds a decorator, or one call, where it makes a decision
worth recording. What is recorded and how it is worded lives here. Every
decision lands under the ``tool`` span of the step that is running
(``agent_trace``)::

    web_search      decision "search_intent"   @search_intent   ._render
    product_info    decision "planner_query"   @planner_query   .execute /
                                                                .execute_stream
    image_generator decision "image_skill"     image_skill(...) in .execute
    quiz_generator  decision "quiz_params"     quiz_params(locals())
                    decision "quiz_normalize"  @quiz_repairs
                                               _normalize_questions
    flashcard_gen.  decision "flashcard_params" flashcard_params(locals())
    media_llm       decision "media_prepare"   @media_prepare   ._prepare
                                               @media_whole_files
                                               @media_retrieval (its inputs)
    any tool        persist "quiz" / "flashcard_set", and the source and
                    citation counts on the tool span: read off the step's
                    result by ``agent_trace`` (``persisted``, ``result_meta``)

Rules everything here keeps:

* no trace being recorded → the wrapped function is called and nothing else
  happens;
* the wrapped function's result and exceptions pass through unchanged;
* the bookkeeping cannot raise into the turn (``_quiet``);
* nothing is kept on a tool (tools are process-wide singletons): what one
  call must tell another travels in ``tracing.state()``, in a slot owned by
  the running thread.
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

# Mirror ``aeva.llm.prompts.image_skills.DEFAULT_SKILL_ID`` and
# ``aeva.mcp.tools.media_llm._IN_PROGRESS_STATUSES`` (not imported: those
# modules are imported by the tools, which import this one). A test keeps
# each pair equal.
DEFAULT_IMAGE_SKILL = "illustration"
IN_PROGRESS_STATUSES = frozenset(
    {"pending", "parsing", "extracting", "chunking", "embedding", "indexing"}
)

# ``tracing.state()`` slots, one per thread.
_MEDIA = "media"
_FLASHCARDS = "flashcards"

# Why a media turn was answered without calling the answer model.
_EARLY_NO_MEDIA = "no_media"
_EARLY_NOTHING_RETRIEVABLE = "nothing_retrievable"
_EARLY_STILL_PROCESSING = "still_processing"
_EARLY_NOTHING_USABLE = "nothing_usable"
_EARLY_REASONS = {
    _EARLY_NO_MEDIA: "No files are in scope for this turn.",
    _EARLY_NOTHING_RETRIEVABLE: (
        "The indexed files were searched but no excerpt matched, and "
        "nothing is attached whole."
    ),
    _EARLY_STILL_PROCESSING: (
        "Nothing is indexed yet and nothing can be attached: the files are "
        "still being processed."
    ),
    _EARLY_NOTHING_USABLE: (
        "Nothing is indexed and nothing can be attached (failed or empty "
        "files)."
    ),
}


@dataclass
class _MediaCall:
    """What one running ``MediaLLMTool._prepare`` call did on the way."""

    # ``_whole_file_attachments`` ran: there were files to partition.
    partitioned: bool = False
    images: list[Any] = field(default_factory=list)
    raw_docs: list[Any] = field(default_factory=list)
    attachments: int = 0
    labels: list[str] = field(default_factory=list)
    # ``_retrieve`` ran: there were indexed documents to search.
    searched: bool = False
    indexed: list[Any] = field(default_factory=list)
    excerpts: int = 0


# ------------------------------------------------------------------ plumbing


def _quiet(func: Callable[_P, None]) -> Callable[_P, None]:
    """Make a bookkeeping function unable to raise into the turn."""

    @functools.wraps(func)
    def safe(*args: _P.args, **kwargs: _P.kwargs) -> None:
        try:
            func(*args, **kwargs)
        except Exception:  # noqa: BLE001 — tracing must never break a turn.
            logger.debug("tool trace failed", exc_info=True)

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
    return f"tool_trace.{slot}.{threading.get_ident()}"


def _put(slot: str, value: object) -> object:
    """Put ``value`` in the thread's slot; returns what was there."""
    try:
        state = tracing.state()
        previous = state.get(_key(slot))
        state[_key(slot)] = value
    except Exception:  # noqa: BLE001 — tracing must never break a turn.
        logger.debug("tool trace failed", exc_info=True)
        return None
    return previous


def _get(slot: str) -> Any:
    """Return what the thread's slot holds (``None`` when empty)."""
    try:
        return tracing.state().get(_key(slot))
    except Exception:  # noqa: BLE001 — tracing must never break a turn.
        logger.debug("tool trace failed", exc_info=True)
        return None


def _restore(slot: str, previous: object) -> None:
    """Put back what ``_put`` replaced."""
    try:
        state = tracing.state()
        if previous is None:
            state.pop(_key(slot), None)
        else:
            state[_key(slot)] = previous
    except Exception:  # noqa: BLE001 — tracing must never break a turn.
        logger.debug("tool trace failed", exc_info=True)


def _observed(
    func: Callable[_P, _R],
    note: Callable[[dict[str, Any], Any], None],
) -> Callable[_P, _R]:
    """Wrap ``func`` so ``note(arguments, result)`` runs after each call."""
    signature = inspect.signature(func)

    @functools.wraps(func)
    def wrapper(*args: _P.args, **kwargs: _P.kwargs) -> _R:
        result = func(*args, **kwargs)
        if tracing.is_active():
            note(_arguments(signature, args, kwargs), result)
        return result

    return wrapper


def _wants_media(tool: Any, params: Mapping[str, Any], ctx: Any) -> Any:
    """Ask the generator's own ``_wants_media`` what it answers here.

    Asked again rather than re-derived: it is a pure function of the same
    ``params`` and ``ctx`` the tool just passed it.
    """
    probe = getattr(tool, "_wants_media", None)
    return bool(probe(params, ctx)) if callable(probe) else None


def _wants_media_source(params: Mapping[str, Any], ctx: Any) -> str:
    """Which of the generator's rules decided ``wants_media``."""
    if not ctx.media_ids:
        return "no_files"
    return "params.use_media" if "use_media" in params else "message_wording"


def _history_reason(*, grounded: bool) -> str:
    """Why a generator did, or did not, send the chat history."""
    if grounded:
        return "Grounded in source material, so chat history is not sent."
    return "No source material: generated from the topic and the chat history."


# --------------------------------------------------------------- web_search


def search_intent(func: Callable[_P, _R]) -> Callable[_P, _R]:
    """Record where the search intent of a web answer came from.

    For ``WebSearchTool._render(ctx, params)``, which returns
    ``(rendered, query, intent)``: an intent equal to the planner's own
    ``search_intent`` was taken from it, anything else was guessed.
    """
    return _observed(func, _note_search_intent)


@_quiet
def _note_search_intent(given: dict[str, Any], rendered: Any) -> None:
    """Record the ``search_intent`` decision of one ``_render`` call."""
    params = given["params"]
    _prompt, query, intent = rendered
    asked = params.get("search_intent")
    from_planner = isinstance(asked, str) and asked == intent
    tracing.event(
        tracing.KIND_DECISION,
        "search_intent",
        input={
            "search_intent": asked,
            "query": query,
            "query_source": (
                "params.query" if params.get("query") else "message"
            ),
        },
        output={
            "search_intent": intent,
            "source": "planner_params" if from_planner else "regex_fallback",
        },
        meta={
            "reason": (
                "The planner supplied a valid search_intent."
                if from_planner
                else "The planner gave no valid search_intent, so it was "
                "guessed from the wording of the query."
            )
        },
    )


# ------------------------------------------------------------- product_info


def planner_query(func: Callable[_P, _R]) -> Callable[_P, _R]:
    """Record that the planner's query replaced the student's message.

    For ``ProductInfoTool.execute`` / ``.execute_stream(self, ctx, params)``:
    unlike the other answer tools, a planner ``query`` is sent to the model
    INSTEAD of the message. Nothing is recorded when there is no query.
    """
    signature = inspect.signature(func)

    @functools.wraps(func)
    def wrapper(*args: _P.args, **kwargs: _P.kwargs) -> _R:
        if tracing.is_active():
            _note_planner_query(_arguments(signature, args, kwargs))
        return func(*args, **kwargs)

    return wrapper


@_quiet
def _note_planner_query(given: dict[str, Any]) -> None:
    """Record the ``planner_query`` decision when the params hold a query."""
    query = given["params"].get("query")
    if not query:
        return
    tracing.event(
        tracing.KIND_DECISION,
        "planner_query",
        input={"message": given["ctx"].enriched_message},
        output={"user_message": query, "source": "params.query"},
        meta={
            "reason": (
                "product_info sends the planner's restated query to the "
                "model instead of the student's own message."
            )
        },
    )


# ---------------------------------------------------------- image_generator


def image_skill(skill: Any, style: object) -> None:
    """Record which image skill was picked, and by which rule.

    Called by ``ImageGeneratorTool.execute`` with the skill ``pick_skill``
    returned and the planner's ``style``. ``pick_skill`` does not say which
    rule fired, so it is derived: a valid planner ``style`` always wins;
    otherwise the wording matched a keyword, unless the result is the
    default skill (then either could be true).
    """
    if tracing.is_active():
        _note_image_skill(skill, style)


@_quiet
def _note_image_skill(skill: Any, style: object) -> None:
    """Record the ``image_skill`` decision."""
    if style and style == skill.id:
        source = "planner_style"
        reason = "The planner chose this style."
    elif skill.id != DEFAULT_IMAGE_SKILL:
        source = "keyword_match"
        reason = "The wording of the request matched this skill's keywords."
    else:
        source = "default"
        reason = (
            "No valid planner style and no more specific keyword match: the "
            "default skill."
        )
    tracing.event(
        tracing.KIND_DECISION,
        "image_skill",
        input={"style": style},
        output={
            "skill": skill.id,
            "label": skill.label,
            "aspect": skill.aspect,
            "source": source,
        },
        meta={"reason": reason},
    )


# ----------------------------------------------------------- quiz_generator


def quiz_params(scope: Mapping[str, Any]) -> None:
    """Record what a quiz is generated with, next to what was asked for.

    Called by ``QuizGeneratorTool.execute`` with its ``locals()`` once the
    request is resolved: the clamped count, the question types and where
    they came from, whether the files are used, whether history is sent.
    """
    if tracing.is_active():
        _note_quiz_params(scope)


@_quiet
def _note_quiz_params(scope: Mapping[str, Any]) -> None:
    """Record the ``quiz_params`` decision."""
    params, ctx = scope["params"], scope["ctx"]
    grounding = scope["grounding"]
    tracing.event(
        tracing.KIND_DECISION,
        "quiz_params",
        input={
            "topic": params.get("topic"),
            "question_count": params.get("question_count"),
            "difficulty": params.get("difficulty"),
            "question_types": params.get("question_types"),
            "exam_config": params.get("exam_config"),
            "use_media": params.get("use_media"),
        },
        output={
            "topic": scope.get("topic"),
            "question_count": scope.get("count"),
            "difficulty": scope.get("difficulty"),
            "question_types": scope.get("types"),
            "question_types_source": (
                "params"
                if params.get("question_types")
                else "exam_pattern"
                if scope.get("default_type")
                else "default"
            ),
            "exam_config": scope.get("exam_config"),
            "wants_media": _wants_media(scope.get("self"), params, ctx),
            "wants_media_source": _wants_media_source(params, ctx),
            "history_dropped": grounding.grounded,
            "history_turns": len(scope.get("history") or []),
            "attachments": len(scope.get("attachments") or []),
        },
        meta={"reason": _history_reason(grounded=grounding.grounded)},
    )


def quiz_repairs(func: Callable[_P, _R]) -> Callable[_P, _R]:
    """Record what the quiz normaliser had to repair in the model's output.

    For ``_normalize_questions(questions)``: its argument is what the model
    returned, its result is what gets saved.
    """
    return _observed(func, _note_quiz_repairs)


@_quiet
def _note_quiz_repairs(given: dict[str, Any], normalized: Any) -> None:
    """Record the ``quiz_normalize`` decision of one normaliser call."""
    repairs: list[dict[str, Any]] = []
    pairs = zip(given["questions"], normalized, strict=False)
    for index, (before, after) in enumerate(pairs):
        options = [str(o) for o in before.get("options") or []]
        correct = list(before.get("correct_answers") or [])
        if options == after["options"] and correct == after["correct_answers"]:
            continue
        repairs.append(
            {
                "index": index,
                "type": before.get("type", "single_select"),
                "options_reset": options != after["options"],
                "correct_before": correct,
                "correct_after": after["correct_answers"],
            }
        )
    tracing.event(
        tracing.KIND_DECISION,
        "quiz_normalize",
        output={
            "questions": len(normalized),
            "repaired": len(repairs),
            "repairs": repairs,
        },
        meta={
            "reason": (
                "The model's answers broke a per-type rule and were repaired "
                "before saving."
                if repairs
                else "Every question already satisfied the per-type rules."
            )
        },
    )


# ------------------------------------------------------ flashcard_generator


def flashcard_params(scope: Mapping[str, Any]) -> None:
    """Record what a flashcard set is generated with.

    Called by ``FlashcardGeneratorTool.execute`` with its ``locals()`` once
    the request is resolved.
    """
    if tracing.is_active():
        _note_flashcard_params(scope)


@_quiet
def _note_flashcard_params(scope: Mapping[str, Any]) -> None:
    """Record the ``flashcard_params`` decision."""
    params, ctx = scope["params"], scope["ctx"]
    grounding = scope["grounding"]
    source_type = scope.get("source_type")
    # The saved set's ``persist`` event repeats it (see ``persisted``).
    _put(_FLASHCARDS, source_type)
    tracing.event(
        tracing.KIND_DECISION,
        "flashcard_params",
        input={
            "topic": params.get("topic"),
            "count": params.get("count"),
            "use_media": params.get("use_media"),
        },
        output={
            "topic": scope.get("topic"),
            "count": scope.get("count"),
            "wants_media": _wants_media(scope.get("self"), params, ctx),
            "wants_media_source": _wants_media_source(params, ctx),
            "source_type": source_type,
            "history_dropped": grounding.grounded,
            "history_turns": len(scope.get("history") or []),
            "attachments": len(scope.get("attachments") or []),
        },
        meta={"reason": _history_reason(grounded=grounding.grounded)},
    )


# ---------------------------------------------------------------- media_llm


def media_prepare(func: Callable[_P, _R]) -> Callable[_P, _R]:
    """Record how a media turn was prepared (``media_prepare``).

    For ``MediaLLMTool._prepare(self, ctx, params)``. One decision per
    turn: the file partition, the retrieval query and where it came from,
    and, when the turn is answered without the model, which early-answer
    branch fired. The partition is what ``@media_whole_files`` and
    ``@media_retrieval`` saw the call pass on.
    """
    signature = inspect.signature(func)

    @functools.wraps(func)
    def wrapper(*args: _P.args, **kwargs: _P.kwargs) -> _R:
        if not tracing.is_active():
            return func(*args, **kwargs)
        call = _MediaCall()
        previous = _put(_MEDIA, call)
        try:
            prepared = func(*args, **kwargs)
        finally:
            _restore(_MEDIA, previous)
        _note_media_prepare(_arguments(signature, args, kwargs), call, prepared)
        return prepared

    return wrapper


def media_whole_files(func: Callable[_P, _R]) -> Callable[_P, _R]:
    """Note the files a media turn sends whole, for ``media_prepare``.

    For ``MediaLLMTool._whole_file_attachments(self, ctx, images,
    raw_docs)``, which returns ``(attachments, labels)``.
    """
    return _observed(func, _note_media_whole_files)


@_quiet
def _note_media_whole_files(given: dict[str, Any], attached: Any) -> None:
    """Keep the images / unindexed documents and what was attached."""
    call = _get(_MEDIA)
    if not isinstance(call, _MediaCall):
        return
    attachments, labels = attached
    call.partitioned = True
    call.images = list(given["images"])
    call.raw_docs = list(given["raw_docs"])
    call.attachments = len(attachments)
    call.labels = [str(label) for label in labels]


def media_retrieval(func: Callable[_P, _R]) -> Callable[_P, _R]:
    """Note the documents a media turn searched, for ``media_prepare``.

    For ``MediaLLMTool._retrieve(self, ctx, query, indexed)``. The search
    itself is the ``retrieve`` span (``retrieval_trace``).
    """
    return _observed(func, _note_media_retrieval)


@_quiet
def _note_media_retrieval(given: dict[str, Any], retrieved: Any) -> None:
    """Keep the indexed documents and how many excerpts came back."""
    call = _get(_MEDIA)
    if not isinstance(call, _MediaCall):
        return
    call.searched = True
    call.indexed = list(given["indexed"])
    call.excerpts = len(retrieved.excerpts)


def _file_names(records: list[Any]) -> list[str]:
    """File names of media records."""
    return [str(r.get("file_name") or r.get("id") or "") for r in records]


def _early_answer(call: _MediaCall, prepared: Any) -> str | None:
    """Which early-answer branch of ``_prepare`` fired, if any."""
    if prepared.early_answer is None:
        return None
    if not call.partitioned:
        return _EARLY_NO_MEDIA
    if call.searched:
        return _EARLY_NOTHING_RETRIEVABLE
    still_processing = any(
        str(r.get("processing_status") or "") in IN_PROGRESS_STATUSES
        for r in call.raw_docs
    )
    return (
        _EARLY_STILL_PROCESSING if still_processing else _EARLY_NOTHING_USABLE
    )


@_quiet
def _note_media_prepare(
    given: dict[str, Any], call: _MediaCall, prepared: Any
) -> None:
    """Record the ``media_prepare`` decision of one ``_prepare`` call."""
    ctx, params = given["ctx"], given["params"]
    early = _early_answer(call, prepared)
    from_params = bool(params.get("query"))
    tracing.event(
        tracing.KIND_DECISION,
        "media_prepare",
        input={
            "query": params.get("query") or ctx.message,
            "query_source": "params.query" if from_params else "message",
            "media_ids": params.get("media_ids") or ctx.media_ids,
            "media_ids_source": (
                "params.media_ids"
                if params.get("media_ids")
                else "request"
                if ctx.media_ids
                else "session_files"
            ),
        },
        output={
            "indexed": _file_names(call.indexed),
            "images": _file_names(call.images),
            "raw_docs": _file_names(call.raw_docs),
            # Labels exist for every file that should travel whole; they
            # count only when something was really attached.
            "attached_whole": call.labels
            if call.attachments and early is None
            else [],
            "excerpts": call.excerpts,
            "early_answer": early,
            "llm_call": early is None,
        },
        meta={
            "reason": _EARLY_REASONS[early]
            if early
            else (
                "The answer model is called with the retrieved excerpts "
                "and any whole-file attachments."
            )
        },
    )


# ----------------------------------------------------- a finished step's result


def result_meta(result: Any) -> dict[str, Any]:
    """Facts about a step's result worth a place on its ``tool`` span.

    The number of sources behind an answer and, for an answer grounded in
    the student's files, how many citation markers the model wrote that
    were kept and dropped (the visible answer differs from the raw model
    text by exactly the dropped ones). Never raises.
    """
    meta: dict[str, Any] = {}
    try:
        if not isinstance(result, Mapping):
            return meta
        sources = result.get("sources")
        if isinstance(sources, list):
            meta["sources"] = len(sources)
        retrieval = result.get("_retrieval")
        if isinstance(retrieval, Mapping) and "citations_used" in retrieval:
            meta["citations_used"] = retrieval["citations_used"]
            meta["citations_dropped"] = retrieval.get("citations_dropped")
    except Exception:  # noqa: BLE001 — tracing must never break a turn.
        logger.debug("tool trace failed", exc_info=True)
    return meta


@_quiet
def persisted(result: Any) -> None:
    """Record what a generator step saved, from the ids in its result.

    A quiz result carries ``quiz_id``, a flashcard result ``set_id``; any
    other result saved nothing worth an event.
    """
    source_type = _put(_FLASHCARDS, None)
    _restore(_FLASHCARDS, None)
    if not isinstance(result, Mapping):
        return
    if result.get("quiz_id") is not None:
        tracing.event(
            tracing.KIND_PERSIST,
            "quiz",
            output={
                "quiz_id": result.get("quiz_id"),
                "title": result.get("title"),
                "questions": len(result.get("questions") or []),
            },
        )
    if result.get("set_id") is not None:
        tracing.event(
            tracing.KIND_PERSIST,
            "flashcard_set",
            output={
                "set_id": result.get("set_id"),
                "title": result.get("title"),
                "cards": len(result.get("cards") or []),
                "source_type": source_type,
            },
        )
