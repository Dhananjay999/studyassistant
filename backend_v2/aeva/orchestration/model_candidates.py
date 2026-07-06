"""Per-tool candidate model lists for planner-driven model selection.

Each tool exposes a set of candidate models through a ``<TOOL>_LLM_MODELS``
config value, listed in **any order** — position carries no meaning. The
orchestrator shows the set to the planner, which picks the cheapest model that
can still answer well by judging each model from its own knowledge, not from
list order. :func:`models_for` is the single source of truth for what a tool is
allowed to run; :func:`resolve_model` clamps the planner's pick to that set,
falling back to the tool's configured default model (its ``LLM_*_MODEL``) — not
a positional guess — whenever the pick is missing or invalid.

Keeping the model policy here — not in the tools or the prompt — is what lets a
deployment retune routing (add GPT-5 to quizzes, drop it from flashcards) by
changing config alone, with no code change.
"""

from flask import current_app

# Tool name -> (candidate-list config key, single-model fallback config key).
# ``general`` shares the web-search model family (it is web_search minus the
# grounding call), so it falls back to the same single model.
_TOOL_MODELS: dict[str, tuple[str, str]] = {
    "general": ("GENERAL_LLM_MODELS", "LLM_WEB_SEARCH_MODEL"),
    "web_search": ("WEB_SEARCH_LLM_MODELS", "LLM_WEB_SEARCH_MODEL"),
    "media_llm": ("MEDIA_LLM_MODELS", "LLM_MEDIA_MODEL"),
    "quiz_generator": ("QUIZ_LLM_MODELS", "LLM_QUIZ_MODEL"),
    "flashcard_generator": ("FLASHCARD_LLM_MODELS", "LLM_FLASHCARD_MODEL"),
}


def _split_models(raw: str | None) -> list[str]:
    """Parse a comma-separated model list into clean single-model names.

    Comma-tolerant so a list works in EITHER the ``*_LLM_MODELS`` key or the
    single ``LLM_*_MODEL`` key — a multi-model string must never survive as one
    bogus "model name" and reach a provider.
    """
    return [m.strip() for m in (raw or "").split(",") if m.strip()]


def models_for(tool_name: str) -> list[str]:
    """Candidate models a tool may run, in the order configured (no ranking).

    Falls back to the tool's single ``LLM_*_MODEL`` when no candidate list is
    configured, so existing single-model deployments keep working unchanged.
    Both keys are comma-tolerant, so a list placed in either one is parsed the
    same way. Returns ``[]`` for a tool with no model choice, which the caller
    treats as "use the tool's own default".
    """
    keys = _TOOL_MODELS.get(tool_name)
    if not keys:
        return []
    list_key, single_key = keys
    models = _split_models(current_app.config.get(list_key))
    if models:
        return models
    return _split_models(current_app.config.get(single_key))


def default_model_for(tool_name: str) -> str | None:
    """Return the tool's single default model (first of its ``LLM_*_MODEL``).

    The safe fallback when the planner's pick is unusable — always exactly ONE
    real model. If the single key mistakenly holds a comma list, only its first
    entry is used, so a multi-model string can never reach a provider.
    """
    keys = _TOOL_MODELS.get(tool_name)
    if not keys:
        return None
    _, single_key = keys
    models = _split_models(current_app.config.get(single_key))
    return models[0] if models else None


def resolve_model(tool_name: str, chosen: str | None) -> str | None:
    """Clamp the planner's chosen model to the tool's allowed set.

    The planner is free-text and may emit a model that is misspelled, retired,
    or simply not in this tool's set — never trust it blind. Returns ``chosen``
    only when it is a valid candidate. Otherwise falls back to the tool's
    configured default model (``default_model_for``); candidate order carries no
    meaning, so there is no "first = cheapest" guess. Returns ``None`` when the
    tool has no configured candidates (caller uses the tool's own default).
    """
    allowed = models_for(tool_name)
    if not allowed:
        return None
    if chosen in allowed:
        return chosen
    return default_model_for(tool_name) or allowed[0]
