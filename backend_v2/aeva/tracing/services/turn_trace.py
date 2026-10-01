"""Tracing of the turn itself: lifecycle, context, routing, outcome, messages.

Everything the execution trace records about *one chat turn as a whole* is
decided here, so the engine's own files stay as they are:

* ``AssistantOrchestrator`` carries one decorator per method that takes part
  in a turn, plus a handful of one-line calls (``context_loaded``,
  ``user_message``, ``link``) where a decorator cannot see the value.
* ``AssistantRepository.process`` (the JSON endpoint) carries
  ``flush_after_response``; the two stream controllers call ``flush`` after
  the last frame.

How the decorators work: each one wraps a method, looks at its arguments
before the call and at its result after it, and records what that says about
the turn (which routing branch matched, which rule rewrote the plan, how the
turn ended). The wrapped method is called exactly as before: same arguments,
same return value, same exceptions. With no trace being recorded a decorator
only calls through.

Rules kept by this module: nothing here does I/O (the one exception is the
flush, which runs after the answer was delivered), nothing here can raise
into the turn, and what has to be remembered between two points of a turn
lives in ``tracing.state()``, never on the orchestrator.
"""

import functools
import inspect
import logging
from collections.abc import Callable, Generator
from typing import Any, ParamSpec, TypeVar

from aeva import tracing
from aeva.tracing.services import prompt_trace

logger = logging.getLogger(__name__)

_P = ParamSpec("_P")
_R = TypeVar("_R")
_T = TypeVar("_T")
_Y = TypeVar("_Y")
_S = TypeVar("_S")

# Keys of ``tracing.state()`` used between two points of one turn.
_CONTEXT = "turn.context_span"
_CONTEXT_OUTPUT = "turn.context_output"
_MESSAGE = "turn.enriched_message"
_RUN = "turn.resumed_run"
_USER_SAVED = "turn.user_message_saved"
_ROUTE = "turn.route_span"
_CHECKED = "turn.route_checked"
_NAMED_FILES = "turn.named_files"
_CLARIFY = "turn.clarify_plan"
_FAILED_STEPS = "turn.failed_steps"
# Reset when ``_setup_and_plan`` starts (it runs once per turn).
_PER_SETUP = (
    _CONTEXT_OUTPUT,
    _MESSAGE,
    _RUN,
    _USER_SAVED,
    _ROUTE,
    _CHECKED,
    _NAMED_FILES,
    _CLARIFY,
)

# The message is searched for the cue behind a web upgrade only this far:
# the sentence is a trace detail and must stay cheap on a long paste.
_CUE_SCAN_CHARS = 4_000

# Why ``_fallback_tool_plan`` picked each tool: its rules are keyed by the
# tool they return, so the tool names the rule that applied.
_FALLBACK_RULES = {
    "flashcard_generator": (
        'flashcard_generator because the message mentions "flashcard"'
    ),
    "quiz_generator": (
        "quiz_generator because the message contains a quiz word "
        "(quiz / practice test / test me)"
    ),
    "media_llm": "media_llm because files are selected",
    "web_search": (
        "web_search because the message needs fresh information and web "
        "search is enabled"
    ),
    "general": (
        "general because no flashcard, quiz, file or freshness rule matched"
    ),
}

Before = Callable[[dict[str, Any]], Any]
After = Callable[[dict[str, Any], Any, Any], None]
Failed = Callable[[dict[str, Any], Any, BaseException], None]


# ------------------------------------------------------------- plumbing


def _guard(func: Callable[..., _T], *args: Any, **kwargs: Any) -> _T | None:
    """Run trace bookkeeping; a bug in it costs a detail, never the turn."""
    try:
        return func(*args, **kwargs)
    except Exception:  # noqa: BLE001 — trace detail only.
        logger.debug("Turn trace detail failed", exc_info=True)
        return None


def _arguments(
    signature: inspect.Signature | None,
    args: tuple[Any, ...],
    kwargs: dict[str, Any],
) -> dict[str, Any]:
    """Arguments of a call by parameter name (defaults filled in)."""
    if signature is None:
        return {}
    bound = signature.bind(*args, **kwargs)
    bound.apply_defaults()
    return dict(bound.arguments)


def _observe(
    func: Callable[_P, _R],
    *,
    before: Before | None = None,
    after: After | None = None,
    failed: Failed | None = None,
) -> Callable[_P, _R]:
    """Wrap ``func`` so the trace sees its arguments and its result.

    ``before(arguments)`` runs first and may return a value to remember;
    ``after(arguments, remembered, result)`` runs once the call returned;
    ``failed(arguments, remembered, error)`` when it raised. None of them
    can change what ``func`` receives, returns or raises.
    """
    signature = _guard(inspect.signature, func)

    @functools.wraps(func)
    def wrapper(*args: _P.args, **kwargs: _P.kwargs) -> _R:
        if not tracing.is_active():
            return func(*args, **kwargs)
        call = _guard(_arguments, signature, args, kwargs) or {}
        remembered = _guard(before, call) if before is not None else None
        try:
            result = func(*args, **kwargs)
        except Exception as exc:
            if failed is not None:
                _guard(failed, call, remembered, exc)
            raise
        if after is not None:
            _guard(after, call, remembered, result)
        return result

    return wrapper


def _engine() -> Any:
    """Return the orchestrator module (imported late: it imports this one)."""
    from aeva.orchestration import assistant_orchestrator

    return assistant_orchestrator


def _steps(plan: Any) -> list[dict[str, Any]]:
    """Step dicts of a plan, read the way the orchestrator reads them."""
    steps: list[dict[str, Any]] = _engine().AssistantOrchestrator._plan_steps(  # noqa: SLF001
        plan
    )
    return steps


def _answer_step(plan: Any) -> dict[str, Any] | None:
    """Return the plan's answer step (the one that streams text), if any."""
    steps = _steps(plan)
    index = _engine().AssistantOrchestrator._answer_index(steps)  # noqa: SLF001
    return steps[index] if index is not None else None


def _primary_tool(plan: Any) -> str:
    """Tool that defines a plan's intent: the answer step, else the first."""
    step = _answer_step(plan)
    if step is None:
        steps = _steps(plan)
        step = steps[0] if steps else {}
    return str(step.get("tool") or "")


def _decide(
    name: str, reason: str, *, before: Any = None, after: Any = None
) -> None:
    """Record a rule that fired: what it changed and, in words, why."""
    tracing.event(
        tracing.KIND_DECISION,
        name,
        input=before,
        output=after,
        meta={"reason": reason},
    )


def _saved_message(role: str, row: Any, **details: Any) -> None:
    """Record a persisted chat message and link its id to the trace."""
    message_id = row.get("id") if isinstance(row, dict) else None
    if not isinstance(message_id, str):
        message_id = None
    tracing.event(
        tracing.KIND_PERSIST,
        f"{role}_message",
        output={"message_id": message_id, **details},
    )
    if message_id:
        tracing.annotate(**{f"{role}_message_id": message_id})


# ------------------------------------------------------- turn lifecycle


def _turn_input(ctx: Any) -> dict[str, Any]:
    """Build the root span's input: what the client sent."""
    return {
        "message": ctx.message,
        "media_ids": ctx.media_ids,
        "run_id": ctx.run_id,
        "clarification": ctx.clarification,
        "quiz_options": ctx.quiz_options,
        "flashcard_options": ctx.flashcard_options,
        "source_content_chars": len(ctx.source_content or ""),
    }


def _start(
    signature: inspect.Signature | None,
    args: tuple[Any, ...],
    kwargs: dict[str, Any],
    endpoint: str,
) -> None:
    """Begin recording the turn a ``run`` / ``run_stream`` call serves."""
    ctx = _arguments(signature, args, kwargs)["ctx"]
    tracing.start_turn(
        user_id=ctx.user_id,
        message=ctx.message,
        endpoint=endpoint,
        input=_turn_input(ctx),
    )


def turn(func: Callable[_P, _R]) -> Callable[_P, _R]:
    """Record a non-streaming turn (on ``AssistantOrchestrator.run``).

    The turn is recorded in memory from the first line of ``run``; a failure
    marks the trace as failed and propagates unchanged. The trace is written
    later, by ``flush_after_response``.
    """
    signature = _guard(inspect.signature, func)

    @functools.wraps(func)
    def wrapper(*args: _P.args, **kwargs: _P.kwargs) -> _R:
        _guard(_start, signature, args, kwargs, "sync")
        try:
            return func(*args, **kwargs)
        except Exception as exc:
            tracing.fail_turn(exc)
            raise

    return wrapper


def turn_stream(
    func: Callable[_P, Generator[_Y, _S, _R]],
) -> Callable[_P, Generator[_Y, _S, _R]]:
    """Record a streaming turn (on ``AssistantOrchestrator.run_stream``).

    Recording starts on the first ``next()``, i.e. inside the controller's
    app context. Frames, ``send`` / ``throw`` / ``close`` and the return
    value pass through untouched; a consumer that stops reading marks the
    trace as aborted, an exception marks it as failed. The controller writes
    the trace (``flush``) after the last frame.
    """
    signature = _guard(inspect.signature, func)

    @functools.wraps(func)
    def wrapper(*args: _P.args, **kwargs: _P.kwargs) -> Generator[_Y, _S, _R]:
        _guard(_start, signature, args, kwargs, "stream")
        try:
            return (yield from func(*args, **kwargs))
        except GeneratorExit:
            # The client stopped reading (disconnect / stop button).
            tracing.abort_turn()
            raise
        except Exception as exc:
            tracing.fail_turn(exc)
            raise

    return wrapper


def flush() -> None:
    """Write the turn's trace; the stream controllers call this last.

    The only tracing I/O. It must run after every frame (the error frame
    included) was handed to the client, still inside the app context.
    Does nothing when no turn was recorded; never raises.
    """
    tracing.finish_turn()


def _flush_bound(binding: tracing.Binding | None) -> None:
    """Write the trace captured in ``binding``, whichever thread runs this."""
    current = tracing.capture()
    if binding is None or (current is not None and current[0] is binding[0]):
        tracing.finish_turn()
        return
    with tracing.bound(binding):
        tracing.finish_turn()


def finish_after_response() -> None:
    """Write the turn's trace once the HTTP response has been sent.

    For the JSON endpoints, which have no "after the last frame" moment of
    their own: the write is hung on the response's close hook, which the
    server calls after the body went out. If that cannot be arranged (no
    request is being served, Flask refuses) the trace is thrown away: a
    lost trace is acceptable, a delayed answer is not.
    """
    if not tracing.is_active():
        return
    try:
        from flask import after_this_request, current_app

        app = current_app._get_current_object()  # type: ignore[attr-defined]  # noqa: SLF001
        binding = tracing.capture()

        def write() -> None:
            # The request's own app context is gone by now; Supabase needs one.
            with app.app_context():
                _flush_bound(binding)

        def hang_on(response: Any) -> Any:
            response.call_on_close(write)
            return response

        after_this_request(hang_on)
    except Exception:  # noqa: BLE001 — no request to hang the write on.
        logger.debug("Trace dropped: no response to flush after")
        tracing.discard_turn()


def flush_after_response(func: Callable[_P, _R]) -> Callable[_P, _R]:
    """Write the trace after the JSON response went out (on ``process``).

    Whether the wrapped handler returns or raises, the trace of the turn it
    ran is written only after the client has the response (see
    ``finish_after_response``).
    """

    @functools.wraps(func)
    def wrapper(*args: _P.args, **kwargs: _P.kwargs) -> _R:
        try:
            return func(*args, **kwargs)
        finally:
            finish_after_response()

    return wrapper


def link() -> dict[str, str]:
    """Return ``{"trace_id": id}`` to stamp on what this turn saves.

    Spread into an assistant message's metadata (and the Developer Mode
    debug block) so the Admin session view can open the trace behind it.
    Empty when the turn is not being traced, so nothing is added then.
    """
    trace_id = tracing.trace_id()
    return {"trace_id": trace_id} if trace_id else {}


# -------------------------------------------------------------- context


def _setup_before(call: dict[str, Any]) -> None:
    """Open ``load_context``; forget what an earlier cascade left behind."""
    state = tracing.state()
    for key in _PER_SETUP:
        state.pop(key, None)
    state[_CONTEXT] = tracing.begin(
        tracing.KIND_CONTEXT,
        "load_context",
        input={"session_id": getattr(call.get("ctx"), "session_id", None)},
    )


def _route_output(plan: Any) -> dict[str, Any]:
    """Build the ``route`` span's output: the FINAL plan and its source."""
    return {
        "source": plan.get("_source"),
        "action": plan.get("action"),
        "steps": [
            {
                "tool": step.get("tool"),
                "model": step.get("model"),
                "params": step.get("params") or {},
            }
            for step in _steps(plan)
        ],
        "plan": plan,
    }


def _setup_after(call: dict[str, Any], _none: Any, result: Any) -> None:  # noqa: ARG001
    """Close ``route`` with the final plan and note where it came from."""
    plan = result[3]
    route = tracing.state().pop(_ROUTE, None)
    if route is not None:
        output = _guard(_route_output, plan)
        if output is None:
            route.end()
        else:
            route.end(output=output)
    tracing.annotate(
        plan_source=plan.get("_source"), plan_action=plan.get("action")
    )


def _setup_failed(
    call: dict[str, Any],
    _none: Any,
    error: BaseException,
) -> None:
    """Close whichever of ``route`` / ``load_context`` the failure left open."""
    state = tracing.state()
    for key in (_ROUTE, _CONTEXT):
        handle = state.get(key)
        if handle is not None:
            handle.end(status=tracing.STATUS_ERROR, error=error)
    orchestrator = call.get("self")
    if _CONTEXT_OUTPUT not in state and getattr(
        orchestrator, "_debug_enabled", False
    ):
        # Failed before the context was recorded, but after the profile was
        # read: the ``debug_users`` scope needs this to keep the turn.
        tracing.annotate(is_debug_user=True)


def setup(func: Callable[_P, _R]) -> Callable[_P, _R]:
    """Record loading the context and routing (on ``_setup_and_plan``).

    Opens ``load_context`` when the method starts and closes ``route`` with
    the plan it returns; in between, ``context_loaded``, ``user_message``
    and the decorators on the routing methods fill them in.
    """
    return _observe(
        func, before=_setup_before, after=_setup_after, failed=_setup_failed
    )


def session_loaded(ctx: Any) -> None:
    """Link the trace to the session, once it was loaded for this user.

    Called right after the session check: the trace's session column
    references ``sessions``, so the id of a session that does not exist (or
    is not the user's) must never be stored. Linking here rather than when
    the whole context is ready keeps the link on a turn that fails in
    between (an expired clarification, a failed history read).
    """
    if tracing.is_active():
        _guard(_link_session, ctx)


def _link_session(ctx: Any) -> None:
    """Store the verified session id on the trace."""
    tracing.annotate(session_id=getattr(ctx, "session_id", None))


def _resumed_after(call: dict[str, Any], _none: Any, run: Any) -> None:
    """Remember the pending run a clarification reply resumes."""
    if not run:
        return
    # Only now: the run was found, so its id is safe to store on the trace.
    tracing.annotate(run_id=call.get("run_id"))
    tracing.state()[_RUN] = run


def resumed_run(func: Callable[_P, _R]) -> Callable[_P, _R]:
    """Note the clarification run this turn answers (on ``_get_run``)."""
    return _observe(func, after=_resumed_after)


def _resume(ctx: Any, run: Any) -> dict[str, Any] | None:
    """Describe the clarification this turn replies to, if it does."""
    if not (ctx.run_id and ctx.clarification) or run is None:
        return None
    plan = run.get("plan") or {}
    return {
        "run_id": ctx.run_id,
        "original_message": run.get("original_message"),
        "response": ctx.clarification,
        "plan_kind": plan.get("kind"),
        # Filled in when routing resolves a "which file?" answer.
        "media_choice_ids": None,
    }


def _context_loaded(
    ctx: Any,
    session: Any,
    profile: Any,
    history: Any,
    personalization: str,
    enriched_message: str,
) -> None:
    """Close ``load_context`` with what the turn runs on."""
    state = tracing.state()
    state[_MESSAGE] = enriched_message
    is_debug_user = bool((profile or {}).get("is_debug_user"))
    tracing.annotate(is_debug_user=is_debug_user)
    if not tracing.is_active():
        return  # a turn that will not be kept (``debug_users`` scope)
    space = session.get("study_spaces")
    standing = _guard(
        _engine()._standing_language_request,  # noqa: SLF001
        ctx.message,
    )
    output = {
        "session": {
            "id": session.get("id"),
            "title": session.get("title"),
            "space_id": session.get("space_id"),
            "space_name": (
                space.get("name") if isinstance(space, dict) else None
            ),
        },
        "is_debug_user": is_debug_user,
        "preferred_language": (profile or {}).get("preferred_language"),
        # Set when the message asked to switch language for good.
        "standing_language_request": standing,
        "history_messages": len(history),
        "personalization": personalization,
        # The same text broken down: which part was added, why, and which
        # user detail produced each line.
        "personalization_parts": _guard(prompt_trace.explain, profile, space),
        "enriched_message": enriched_message,
        "source_content": bool(ctx.source_content),
        "clarification_resume": _guard(_resume, ctx, state.get(_RUN)),
    }
    state[_CONTEXT_OUTPUT] = output
    handle = state.get(_CONTEXT)
    if handle is None:
        tracing.event(
            tracing.KIND_CONTEXT,
            "load_context",
            input={"session_id": ctx.session_id},
            output=output,
        )
    else:
        handle.end(output=output)


def context_loaded(
    ctx: Any,
    session: Any,
    profile: Any,
    history: Any,
    personalization: str,
    enriched_message: str,
) -> None:
    """Record what the turn runs on, once ``_setup_and_plan`` loaded it.

    Called with the values the method just computed: the verified session,
    the profile row (after a standing language request patched it), the
    history, the personalization text and the message the tools will see.
    """
    if not tracing.is_active():
        return
    _guard(
        _context_loaded,
        ctx,
        session,
        profile,
        history,
        personalization,
        enriched_message,
    )
    # Closed here as well (a no-op when it already is): routing must not
    # end up nested under the context if recording its details failed.
    handle = tracing.state().get(_CONTEXT)
    if handle is not None:
        handle.end()


def user_message(row: _T) -> _T:
    """Record the user message that was just saved; returns ``row`` as is.

    Wrapped around the insert so the saved row's id links the message to
    the trace.
    """
    if tracing.is_active():
        _guard(_saved_message, "user", row)
        tracing.state()[_USER_SAVED] = True
    return row


# -------------------------------------------------------------- routing


def _route_begin(call: dict[str, Any]) -> None:
    """Open ``route``: the cascade starts with the forced-plan check."""
    state = tracing.state()
    if state.get(_ROUTE) is not None:
        return
    ctx = call["ctx"]
    choice = call.get("media_choice_ids")
    output = state.get(_CONTEXT_OUTPUT)
    resume = output.get("clarification_resume") if output else None
    context = state.get(_CONTEXT)
    if resume is not None and choice is not None and context is not None:
        resume["media_choice_ids"] = choice
        context.set(output=output)
    if not state.get(_USER_SAVED) and ctx.run_id and ctx.clarification:
        tracing.event(
            tracing.KIND_PERSIST,
            "user_message",
            status=tracing.STATUS_SKIPPED,
            meta={
                "reason": "A clarification reply is folded into the "
                "original message; no user bubble is saved."
            },
        )
    state[_CHECKED] = []
    state[_ROUTE] = tracing.begin(
        tracing.KIND_ROUTER,
        "route",
        input={
            "message": state.get(_MESSAGE, ctx.message),
            "media_ids": ctx.media_ids,
            "has_clarification": ctx.clarification is not None,
        },
    )


def _checked(branch: str, *, matched: bool) -> None:
    """Add a branch to the list of those the cascade evaluated, in order."""
    state = tracing.state()
    checked = state.setdefault(_CHECKED, [])
    seen = {item["branch"] for item in checked}
    if (
        branch == "continuation"
        and "forced" in seen
        and "media_choice" not in seen
    ):
        # The file-choice branch only runs with several files selected and
        # no clarification reply; not reaching it is "did not match".
        checked.append({"branch": "media_choice", "matched": False})
    checked.append({"branch": branch, "matched": matched})
    route = state.get(_ROUTE)
    if route is not None:
        # Updated at every branch so a failure shows how far it got.
        route.set(meta={"checked": checked})


def _why_forced(ctx: Any, media_choice_ids: Any) -> str:
    """One sentence naming the condition that forced the plan."""
    if media_choice_ids is not None:
        return (
            'This turn answers a "which file?" clarification, resolved '
            f"to {len(media_choice_ids)} file(s), so media_llm runs on "
            "that choice with the original question as the query."
        )
    if ctx.flashcard_options is not None:
        return (
            "The request carries flashcard_options (the Create "
            "Flashcards action), which forces flashcard_generator."
        )
    return (
        "The request carries quiz_options (the quiz setup form was "
        "submitted), which forces quiz_generator."
    )


def _forced_after(call: dict[str, Any], _none: Any, plan: Any) -> None:
    """Record whether a forced plan applied, and which condition forced it."""
    _checked("forced", matched=plan is not None)
    if plan is not None:
        _decide(
            "forced_plan",
            _why_forced(call["ctx"], call.get("media_choice_ids")),
            after=plan,
        )


def branch_forced(func: Callable[_P, _R]) -> Callable[_P, _R]:
    """Record the first routing branch (on ``_forced_plan``).

    It is the first step of the cascade, so the ``route`` span opens here.
    """
    return _observe(func, before=_route_begin, after=_forced_after)


def _named_after(call: dict[str, Any], _none: Any, named: Any) -> None:
    """Remember which selected files the message named."""
    tracing.state()[_NAMED_FILES] = (call.get("files"), named)


def named_files(func: Callable[_P, _R]) -> Callable[_P, _R]:
    """Note the files a message names (on ``_names_in_message``).

    Kept for the ``media_choice`` decision, which explains itself with the
    file names.
    """
    return _observe(func, after=_named_after)


def _names(files: Any) -> str:
    """Comma-separated names of a list of selected files."""
    return ", ".join(str(item["name"]) for item in files)


def _why_media_choice(plan: Any) -> str:
    """One sentence saying why the file-choice branch produced ``plan``."""
    files, named = tracing.state().pop(_NAMED_FILES, (None, None))
    if plan.get("action") == "clarify":
        files = files or plan.get("files") or []
        return (
            f"{len(files)} files are selected ({_names(files)}) and the "
            "message names none of them, so the turn asks which file "
            "to use instead of planning."
        )
    if not files or not named:
        return (
            "The message names some of the selected files, so media_llm "
            "runs on the named file(s) only."
        )
    return (
        f"The message names {_names(named)} out of the {len(files)} "
        f"selected files ({_names(files)}), so media_llm runs on the "
        "named file(s) only."
    )


def _media_choice_after(call: dict[str, Any], _none: Any, plan: Any) -> None:  # noqa: ARG001
    """Record whether the file-choice branch decided the turn."""
    _checked("media_choice", matched=plan is not None)
    if plan is not None:
        _decide("media_choice", _why_media_choice(plan), after=plan)


def branch_media_choice(func: Callable[_P, _R]) -> Callable[_P, _R]:
    """Record the "which file?" branch (on ``_disambiguate_media``)."""
    return _observe(func, after=_media_choice_after)


def _continuation_after(call: dict[str, Any], _none: Any, plan: Any) -> None:
    """Record whether the message repeats the last generator tool."""
    _checked("continuation", matched=plan is not None)
    if plan is None:
        return
    match = _engine()._REPEAT_RE.search(str(call["message"]).lower())  # noqa: SLF001
    phrase = match.group(0) if match else ""
    _decide(
        "continuation",
        f'The message has the repeat cue "{phrase}", names no quiz or '
        "flashcard keyword and comes with no files, and the last "
        f"tool-bearing assistant turn used {_primary_tool(plan)}, so "
        "that tool runs again.",
        after=plan,
    )


def branch_continuation(func: Callable[_P, _R]) -> Callable[_P, _R]:
    """Record the "do it again" branch (on ``_continuation_plan``)."""
    return _observe(func, after=_continuation_after)


def _fast_path_after(call: dict[str, Any], _none: Any, plan: Any) -> None:  # noqa: ARG001
    """Record whether the turn skipped the planner as pure small talk."""
    _checked("fast_path", matched=plan is not None)
    if plan is None:
        return
    key = plan.get("model_config_key")
    _decide(
        "fast_path",
        "The whole message is small talk (a greeting, thanks or an "
        "acknowledgement) with no files, no clarification reply and "
        "no quiz, flashcard or image keyword, so the planner LLM call "
        f"is skipped and {_primary_tool(plan)} answers"
        + (f" on the fast model ({key})." if key else "."),
        after=plan,
    )


def branch_fast_path(func: Callable[_P, _R]) -> Callable[_P, _R]:
    """Record the small-talk branch (on ``_fast_path_plan``)."""
    return _observe(func, after=_fast_path_after)


def _planner_before(call: dict[str, Any]) -> None:  # noqa: ARG001
    """Note that the planner was reached (before it can fail)."""
    _checked("planner", matched=True)


def _planner_after(call: dict[str, Any], _none: Any, plan: Any) -> None:  # noqa: ARG001
    """Keep the planner's own answer, before any rule rewrites it."""
    _decide(
        "planner_output",
        "No deterministic branch matched, so the planner LLM decided. "
        "The rules that follow may still rewrite this plan.",
        after=plan,
    )


def branch_planner(func: Callable[_P, _R]) -> Callable[_P, _R]:
    """Record the planner branch and its RAW plan (on ``_plan_turn``)."""
    return _observe(func, before=_planner_before, after=_planner_after)


# --------------------------------------------------- rules on the plan


def _clarify_before(call: dict[str, Any]) -> None:
    """Remember a plan that asks to clarify: a rule may override it."""
    plan = call["plan"]
    if plan.get("action") == "clarify":
        tracing.state()[_CLARIFY] = (plan, call["ctx"])


def _clarify_overridden(plan_now: Any) -> bool:
    """Record that a clarify plan was replaced by the rule-based fallback.

    ``plan_now`` is the plan that goes on; when it still is the planner's
    clarify plan, the clarification stands and nothing is recorded. Returns
    whether an override was recorded.
    """
    pending = tracing.state().pop(_CLARIFY, None)
    if pending is None:
        return False
    asked, ctx = pending
    if plan_now is asked:
        return False
    tool = _primary_tool(plan_now)
    rule = _FALLBACK_RULES.get(tool, tool)
    if ctx.clarification is not None:
        _decide(
            "clarify_blocked",
            "The planner asked to clarify, but the user already "
            "responded to a clarification this turn, so the turn must "
            "answer: the plan is replaced by the rule-based fallback, "
            f"{rule}.",
            before=asked,
            after=plan_now,
        )
        return True
    _decide(
        "clarify_skipped",
        "The planner asked to clarify, but the message has no "
        "unresolved reference and the over-clarification guard "
        "judged a question unnecessary, so the plan is replaced by "
        f"the rule-based fallback, {rule}.",
        before=asked,
        after=plan_now,
    )
    return True


def _clarify_after(call: dict[str, Any], _none: Any, plan: Any) -> None:  # noqa: ARG001
    """Record an override that ended ``_refine_plan`` (repeat clarify)."""
    _clarify_overridden(plan)


def _clarify_failed(
    call: dict[str, Any],  # noqa: ARG001
    _none: Any,
    error: BaseException,  # noqa: ARG001
) -> None:
    """Forget the pending clarify plan of a refinement that failed."""
    tracing.state().pop(_CLARIFY, None)


def rule_clarify(func: Callable[_P, _R]) -> Callable[_P, _R]:
    """Record the over-clarification rules (on ``_refine_plan``).

    ``clarify_blocked`` when the planner asked again after the user already
    replied, ``clarify_skipped`` when the guard judged the question
    unnecessary. Nothing when the plan did not ask, or the question stands.
    """
    return _observe(
        func,
        before=_clarify_before,
        after=_clarify_after,
        failed=_clarify_failed,
    )


def _web_upgrade_before(call: dict[str, Any]) -> Any:
    """Snapshot the answer step before the rule may replace it."""
    plan = call["plan"]
    # ``_refine_plan`` hands its fallback plan to this rule: record that
    # override first, with the plan as it is before any upgrade.
    fallback = bool(_guard(_clarify_overridden, plan))
    return _answer_step(plan), fallback


def _web_upgrade_after(call: dict[str, Any], noted: Any, plan: Any) -> None:
    """Record a ``general`` answer step promoted to ``web_search``."""
    before, fallback = noted
    after = _answer_step(plan)
    if (
        before is None
        or after is None
        or before.get("tool") != "general"
        or after.get("tool") != "web_search"
    ):
        return
    engine = _engine()
    scanned = str(call["message"])[:_CUE_SCAN_CHARS]
    product = engine._PRODUCT_INTENT_RE.search(scanned)  # noqa: SLF001
    cue = product or engine._FRESH_INFO_RE.search(scanned)  # noqa: SLF001
    kind = "product/choice" if product else "fresh-information"
    found = (
        f'the {kind} cue "{cue.group(0)}"'
        if cue
        else "a product/choice or fresh-information cue"
    )
    intent = (after.get("params") or {}).get("search_intent")
    _decide(
        "web_upgrade",
        f"The {'fallback' if fallback else 'planner'} chose general, but "
        f"the message has {found} and web search is enabled, so the answer "
        "step is promoted to web_search with the guessed search_intent "
        f"{intent}.",
        before=before,
        after=after,
    )


def rule_web_upgrade(func: Callable[_P, _R]) -> Callable[_P, _R]:
    """Record the promotion to web search (on ``_web_upgrade``).

    Recorded only when the rule fired: the answer step was ``general``
    going in and is ``web_search`` coming out.
    """
    return _observe(func, before=_web_upgrade_before, after=_web_upgrade_after)


def _media_guard_before(call: dict[str, Any]) -> Any:
    """Snapshot the answer step before the guard may divert it."""
    return _answer_step(call["plan"])


def _media_guard_after(call: dict[str, Any], before: Any, plan: Any) -> None:
    """Record an answer step diverted to the selected files."""
    after = _answer_step(plan)
    if before is None or after is None:
        return
    name = before.get("tool")
    if name not in ("general", "web_search"):
        return
    if after.get("tool") != "media_llm":
        return
    ctx = call["ctx"]
    _decide(
        "media_guard",
        f"{len(ctx.media_ids)} file(s) are selected and the plan "
        f"answered with {name} although the message "
        + (
            "is not small talk"
            if name == "general"
            else "has no fresh-information cue"
        )
        + ", so the answer step is diverted to media_llm over the "
        "selected files.",
        before=before,
        after=after,
    )


def rule_media_guard(func: Callable[_P, _R]) -> Callable[_P, _R]:
    """Record the diversion to the files (on ``_media_routing_guard``).

    Recorded only when the guard fired: the answer step was ``general`` or
    ``web_search`` going in and is ``media_llm`` coming out.
    """
    return _observe(func, before=_media_guard_before, after=_media_guard_after)


# -------------------------------------------------------------- outcome


def _why_quiz_setup(plan: Any, message: str) -> str:
    """One sentence saying why the quiz setup popover opens."""
    steps = _steps(plan)
    tools = [str(step.get("tool") or "") for step in steps]
    if tools and tools[0] == "quiz_generator":
        params = steps[0].get("params") or {}
        missing = " and ".join(
            key
            for key in ("question_count", "difficulty")
            if not params.get(key)
        )
        return (
            "The plan's only step is quiz_generator and its params carry "
            f"no {missing}, so the settings are collected in the setup "
            "popover before a quiz is generated."
        )
    text = message.lower()
    words = _engine()._QUIZ_WORDS  # noqa: SLF001
    word = next((item for item in words if item in text), "")
    return (
        f'The message contains "{word}" while the plan is '
        f"{plan.get('action')} {tools or '(no steps)'}, so the quiz "
        "setup popover opens instead of running that plan."
    )


def _quiz_setup_after(call: dict[str, Any], _none: Any, opens: Any) -> None:
    """Record how the turn goes on: quiz setup, or running the tools."""
    plan = call["plan"]
    if opens:
        orchestrator = call["self"]
        tracing.event(
            tracing.KIND_DECISION,
            "outcome",
            output={
                "outcome": "quiz_setup",
                "reason": _guard(_why_quiz_setup, plan, call["message"]),
                "data": _guard(
                    orchestrator._quiz_setup_data,  # noqa: SLF001
                    plan,
                    call["ctx"],
                ),
            },
        )
        tracing.annotate(status=tracing.TRACE_QUIZ_SETUP)
        return
    if plan.get("action") == "clarify":
        return  # recorded by ``outcome_clarification``
    tools = [str(step.get("tool") or "") for step in _steps(plan)]
    tracing.event(
        tracing.KIND_DECISION,
        "outcome",
        output={
            "outcome": "run_tools",
            "reason": (
                f"The plan is {plan.get('action')} with "
                f"{tools or 'no steps (general answers by default)'}; "
                "neither the quiz setup popover nor a clarification "
                "applies, so the agents run."
            ),
        },
    )


def outcome_quiz_setup(func: Callable[_P, _R]) -> Callable[_P, _R]:
    """Record how the turn ends (on ``_should_open_quiz_setup``).

    That check is where the turn's three endings part: ``quiz_setup`` when
    it says yes, ``run_tools`` when it says no and the plan does not ask to
    clarify. The clarification ending is recorded where it is handled.
    """
    return _observe(func, after=_quiz_setup_after)


def _clarification_before(call: dict[str, Any]) -> Any:  # noqa: ARG001
    """Open the ``outcome`` step before the questions are saved."""
    return tracing.begin(tracing.KIND_DECISION, "outcome")


def _clarification_after(call: dict[str, Any], outcome: Any, clar: Any) -> None:
    """Close ``outcome`` with the saved run; note the saved message."""
    plan = call["plan"]
    request = clar.clarification
    outcome.end(
        output={
            "outcome": "clarification",
            "reason": (
                "The final plan's action is clarify (source: "
                f"{plan.get('_source')}), so the questions were saved as "
                "a pending run and the turn waits for the user's reply."
            ),
            "run_id": clar.run_id,
            "clarification_reason": request.reason if request else "",
            "questions": request.questions if request else [],
        }
    )
    tracing.annotate(status=tracing.TRACE_CLARIFICATION)
    # The reply to these questions arrives as a new turn carrying this id.
    if isinstance(clar.run_id, str):
        tracing.annotate(run_id=clar.run_id)
    tracing.root().set(
        output={
            "display_text": clar.display_text,
            "tool_used": None,
            "tools_used": [],
        }
    )
    # The insert's row is not kept by the method, so the message is linked
    # to this trace by the ``trace_id`` in its metadata (see ``link``).
    tracing.event(
        tracing.KIND_PERSIST,
        "assistant_message",
        output={
            "message_id": None,
            "status": "clarification_required",
            "linked_by": "metadata.trace_id",
        },
    )


def _clarification_failed(
    call: dict[str, Any],  # noqa: ARG001
    outcome: Any,
    error: BaseException,
) -> None:
    """Close ``outcome`` when saving the clarification failed."""
    if outcome is not None:
        outcome.end(status=tracing.STATUS_ERROR, error=error)


def outcome_clarification(func: Callable[_P, _R]) -> Callable[_P, _R]:
    """Record a turn that ends by asking (on ``_handle_clarification``)."""
    return _observe(
        func,
        before=_clarification_before,
        after=_clarification_after,
        failed=_clarification_failed,
    )


# ------------------------------------------------------------ step roster


def _roster_before(call: dict[str, Any]) -> Any:
    """Snapshot the planned steps (and any earlier ``_dropped`` note)."""
    plan = call["plan"]
    return _steps(plan), plan.get("_dropped")


def _roster_meta(
    planned: list[dict[str, Any]], roster: list[Any], dropped: list[str]
) -> dict[str, Any]:
    """Work out what normalising changed, from the plan and the roster.

    Only what shaped the roster is reported: a degrade is the planned
    answer tool running as another one, a clamp is a requested model that
    was not used.
    """
    engine = _engine()
    names = [str(item.get("tool") or "") for item in planned]
    answer = next((step for step in roster if step.id == "answer"), None)
    generators = {step.tool: step for step in roster if step is not answer}
    # The first planned answer tool is the one that became the answer step.
    origin = next(
        (
            item
            for item, name in zip(planned, names, strict=True)
            if name in engine.ANSWER_TOOLS
        ),
        None,
    )
    planned_model = None
    if answer is not None:
        planned_model = engine.resolve_model(
            answer.tool, origin.get("model") if origin else None
        )
    degraded: list[dict[str, Any]] = []
    clamped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item, name in zip(planned, names, strict=True):
        if item is origin and answer is not None:
            tool, used = answer.tool, planned_model
            if name != tool:
                # Answer tool switched off by a feature flag -> general.
                degraded.append({"tool": name, "to": tool, "why": "flag off"})
        elif name in generators and name not in seen:
            seen.add(name)
            tool, used = name, generators[name].model
        else:
            continue
        requested = item.get("model")
        if requested and used != requested:
            # The planner asked for a model outside the tool's candidates.
            clamped.append({"tool": tool, "requested": requested, "used": used})
    in_roster = {step.tool for step in roster}
    meta: dict[str, Any] = {
        "degraded": degraded,
        "clamped": clamped,
        # Tools that did not make the roster for another reason: unknown
        # name, a second answer tool, a generator over the cap.
        "ignored": [
            name
            for name in names
            if name not in dropped
            and name not in in_roster
            and not any(item["tool"] == name for item in degraded)
        ],
    }
    if answer is not None and origin is None:
        meta["defaulted"] = "general (the plan had no runnable step)"
    if answer is not None and answer.config_key:
        # Fast path: the answer runs on a dedicated model/provider pair.
        meta["overridden"] = {
            "tool": answer.tool,
            "planned_model": planned_model,
            "model": answer.model,
            "config_key": answer.config_key,
        }
    if answer is None and roster:
        meta["generator_input"] = "message (no answer step to build on)"
    return meta


def _roster_after(call: dict[str, Any], before: Any, roster: Any) -> None:
    """Record plan -> final agent roster and everything that changed."""
    planned, earlier = before
    noted = call["plan"].get("_dropped")
    # ``_dropped`` is only written when something was dropped this time.
    dropped = list(noted) if noted and noted is not earlier else []
    tracing.event(
        tracing.KIND_DECISION,
        "normalize_steps",
        input=planned,
        output={"steps": roster, "dropped": dropped},
        meta=_guard(_roster_meta, planned, list(roster), dropped),
    )


def roster(func: Callable[_P, _R]) -> Callable[_P, _R]:
    """Record the final step roster (on ``_normalize_steps``).

    What was degraded, clamped, ignored, defaulted or overridden is worked
    out by comparing the plan's steps with the roster the method returned.
    """
    return _observe(func, before=_roster_before, after=_roster_after)


# ------------------------------------------------------------ completion


def _failed_steps(outcome: Any) -> list[dict[str, Any]]:
    """List the steps of a finished turn that failed or timed out."""
    return [
        {
            "step_id": agent.step.id,
            "tool": agent.step.tool,
            "error": agent.error or "failed",
        }
        for agent in outcome.agents
        if agent.status == "failed"
    ]


def _finish_after(call: dict[str, Any], _none: Any, result: Any) -> None:
    """Record what ``_finish_turn`` stamped on the result."""
    _display_text, badge = result
    outcome = call["outcome"]
    content = outcome.result
    tracing.state()[_FAILED_STEPS] = _guard(_failed_steps, outcome)
    tracing.event(
        tracing.KIND_DECISION,
        "finish_turn",
        output={
            "response_type": content.get("response_type"),
            "available_actions": content.get("available_actions"),
            "suggested_followups": content.get("suggested_followups"),
            "dropped": call["plan"].get("_dropped") or [],
            "badge": bool(badge),
            "model": outcome.primary_model,
            "config_key": outcome.primary_config_key,
        },
        meta={
            "planning_ms": call["planning_ms"],
            "tool_ms": call["tool_ms"],
            "streamed": outcome.streamed,
        },
    )


def finish(func: Callable[_P, _R]) -> Callable[_P, _R]:
    """Record actions, follow-ups, badge, dropped tools (on ``_finish_turn``).

    Also notes which steps failed or timed out, for the turn's final status.
    """
    return _observe(func, after=_finish_after)


def _answer_before(call: dict[str, Any]) -> Any:
    """Tell whether saving this answer also titles a fresh session."""
    return call["session"]["title"] == "New chat"


def _answer_after(call: dict[str, Any], title_updated: Any, row: Any) -> None:
    """Record the saved answer and the turn's final status."""
    _saved_message("assistant", row, title_updated=title_updated)
    failed = tracing.state().get(_FAILED_STEPS) or []
    if failed:
        # Answered and saved, but a step failed or timed out on the way.
        tracing.annotate(
            status=tracing.TRACE_PARTIAL,
            error="; ".join(
                f"{item['tool']}: {item['error']}" for item in failed
            ),
            failed_steps=failed,
        )
    else:
        tracing.annotate(status=tracing.TRACE_COMPLETED)
    tool = call["tool_name"]
    tracing.root().set(
        output={
            "display_text": call["display_text"],
            "tool_used": tool,
            "tools_used": list(call.get("tools_used") or [tool]),
        }
    )


def answer_saved(func: Callable[_P, _R]) -> Callable[_P, _R]:
    """Record the saved answer and close the turn (on ``_persist_answer``).

    Links the assistant message's id to the trace, keeps what the user
    received as the turn's output and sets the final status: ``completed``,
    or ``partial`` when the answer was saved although a step failed or
    timed out. A failing write is left to the turn's failure handling.
    """
    return _observe(func, before=_answer_before, after=_answer_after)


__all__ = [
    "answer_saved",
    "branch_continuation",
    "branch_fast_path",
    "branch_forced",
    "branch_media_choice",
    "branch_planner",
    "context_loaded",
    "finish",
    "finish_after_response",
    "flush",
    "flush_after_response",
    "link",
    "named_files",
    "outcome_clarification",
    "outcome_quiz_setup",
    "resumed_run",
    "roster",
    "rule_clarify",
    "rule_media_guard",
    "rule_web_upgrade",
    "session_loaded",
    "setup",
    "turn",
    "turn_stream",
    "user_message",
]
