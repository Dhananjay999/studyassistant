"""Tracing services: everything the AI engine's files call to be traced.

The engine's own modules (orchestrator, agent runner, tools, retrieval, LLM
client) contain no tracing logic. Each imports one module from here and adds
decorators or one-line calls; what to record, how to word it, and the guards
that keep a tracing fault away from the turn all live in this package.

* ``turn_trace`` — the turn: lifecycle, context, routing, outcome, messages.
* ``agent_trace`` — steps run by the agent runner, model resolution.
* ``tool_trace`` — decisions specific to one tool.
* ``retrieval_trace`` — retrieval and grounding.
* ``llm_trace`` — LLM and embedding calls.
* ``prompt_trace`` — which user detail produced which prompt line.
"""
