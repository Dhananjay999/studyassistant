"""Per-tool candidate model lists for planner-driven model selection.

Each tool exposes an ordered list of candidate models (cheapest -> strongest)
through a ``<TOOL>_LLM_MODELS`` config value. The orchestrator shows this list
to the planner, which returns the cheapest model that can still answer well;
:func:`models_for` is the single source of truth for what a tool is allowed to
run, and its first entry is the cheapest default used whenever the planner's
choice is missing or invalid.

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


def models_for(tool_name: str) -> list[str]:
    """Ordered candidate models (cheapest first) a tool may run.

    Falls back to the tool's single ``LLM_*_MODEL`` when no candidate list is
    configured, so existing single-model deployments keep working unchanged.
    Returns ``[]`` for a tool with no model choice (e.g. one not routed through
    the selector), which the caller treats as "use the tool's own default".
    """
    keys = _TOOL_MODELS.get(tool_name)
    if not keys:
        return []
    list_key, single_key = keys
    raw = current_app.config.get(list_key) or ""
    models = [m.strip() for m in raw.split(",") if m.strip()]
    if models:
        return models
    single = current_app.config.get(single_key)
    return [single] if single else []


def resolve_model(tool_name: str, chosen: str | None) -> str | None:
    """Clamp the planner's chosen model to the tool's allowed list.

    The planner is free-text and may emit a model that is misspelled, retired,
    or simply not in this tool's list — never trust it blind. Returns ``chosen``
    only when it is a valid candidate; otherwise the cheapest candidate, or
    ``None`` when the tool has no configured candidates (use its own default).
    """
    allowed = models_for(tool_name)
    if not allowed:
        return None
    if chosen in allowed:
        return chosen
    return allowed[0]
