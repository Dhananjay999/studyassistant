"""Config-driven LLM provider selection.

A capability picks its provider through a ``LLM_*_PROVIDER`` config key
(falling back to ``LLM_PROVIDER``) and its model through the matching
``LLM_*_MODEL`` key. To add a vendor: implement :class:`LLMProvider`, add it to
``PROVIDERS``, and set its API key in config.
"""

from flask import current_app

from aeva.common.errors import ERROR_CODES, CustomError
from aeva.llm.providers.base import LLMProvider
from aeva.llm.providers.gemini import GeminiProvider

# Registry of available providers keyed by their config name.
PROVIDERS: dict[str, type[LLMProvider]] = {
    "gemini": GeminiProvider,
}


def _provider_key_for(config_key: str) -> str:
    """Map a model config key to its provider config key.

    ``LLM_WEB_SEARCH_MODEL`` -> ``LLM_WEB_SEARCH_PROVIDER``;
    ``LLM_MODEL`` -> ``LLM_PROVIDER``.
    """
    if config_key.endswith("_MODEL"):
        return config_key[: -len("_MODEL")] + "_PROVIDER"
    return "LLM_PROVIDER"


def create_provider(
    *,
    config_key: str = "LLM_MODEL",
    model: str | None = None,
    provider_key: str | None = None,
) -> LLMProvider:
    """Instantiate the configured provider for a capability."""
    provider_key = provider_key or _provider_key_for(config_key)
    provider_name = current_app.config.get(
        provider_key, current_app.config["LLM_PROVIDER"]
    )
    model_name = model or current_app.config[config_key]

    provider_cls = PROVIDERS.get(provider_name)
    if not provider_cls:
        raise CustomError(
            ERROR_CODES["LLM_ERROR"],
            details=f"Unknown LLM provider: {provider_name}",
        )
    return provider_cls(model=model_name)
