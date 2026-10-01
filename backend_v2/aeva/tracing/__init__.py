"""Execution tracing for the chat AI engine (Admin → Traces).

Records what actually happened while answering one message — the routing
decision, every prompt that was built, every LLM call with its input and
output, each tool run, retrieval, and how they nest — and stores it after the
answer was delivered. See ``recorder`` for the model and the rules.

Usage from instrumented code::

    from aeva import tracing

    with tracing.span(tracing.KIND_TOOL, step.tool, input=step.params) as sp:
        result = run()
        sp.set(output=result)

    tracing.event(tracing.KIND_DECISION, "web_upgrade", output={...})

Every function is a cheap no-op when no trace is being recorded, and none of
them can raise into the caller.
"""

from aeva.tracing.recorder import (
    KIND_CONTEXT,
    KIND_DECISION,
    KIND_EMBEDDING,
    KIND_LLM,
    KIND_PERSIST,
    KIND_PROMPT,
    KIND_RETRIEVAL,
    KIND_ROUTER,
    KIND_TOOL,
    KIND_TURN,
    STATUS_ABORTED,
    STATUS_ERROR,
    STATUS_OK,
    STATUS_SKIPPED,
    STATUS_TIMEOUT,
    TRACE_ABORTED,
    TRACE_CLARIFICATION,
    TRACE_COMPLETED,
    TRACE_ERROR,
    TRACE_PARTIAL,
    TRACE_QUIZ_SETUP,
    Binding,
    SpanHandle,
    abort_turn,
    annotate,
    begin,
    bound,
    capture,
    carry,
    current,
    discard_turn,
    error_below,
    event,
    fail_turn,
    finish_turn,
    is_active,
    llm_call,
    note_llm_response,
    note_prompt_addition,
    record_prompt,
    root,
    span,
    start_turn,
    state,
    template_hash,
    trace_id,
)
