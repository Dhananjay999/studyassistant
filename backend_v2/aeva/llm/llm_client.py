"""Provider-agnostic LLM facade.

``LLMClient`` is the stable interface the app calls. It resolves a concrete
provider from config and delegates to it, so swapping models or vendors never
touches call sites. ``format_sse_chunk`` lives here because SSE framing is
transport, not vendor, specific.
"""

import json
from collections.abc import Generator
from typing import Any

from aeva.llm.providers.base import LLMProvider
from aeva.llm.providers.factory import create_provider


class LLMClient:
    """Facade over a config-selected :class:`LLMProvider`."""

    def __init__(
        self,
        model: str | None = None,
        *,
        config_key: str = "LLM_MODEL",
        provider_key: str | None = None,
    ) -> None:
        self._provider: LLMProvider = create_provider(
            config_key=config_key,
            model=model,
            provider_key=provider_key,
        )

    @property
    def model(self) -> str:
        """Resolved model name of the underlying provider."""
        return self._provider.model

    @property
    def last_sources(self) -> list[dict[str, str]]:
        """Grounding citations captured from the most recent call."""
        return self._provider.last_sources

    def generate(
        self,
        user_message: str,
        system_prompt: str | None = None,
        attachments: list[dict[str, Any]] | None = None,
        history: list[dict[str, str]] | None = None,
        use_search: bool = False,
    ) -> str:
        """Generate a response (optionally grounded with web search)."""
        return self._provider.generate(
            user_message,
            system_prompt=system_prompt,
            attachments=attachments,
            history=history,
            use_search=use_search,
        )

    def generate_structured(
        self,
        user_message: str,
        response_schema: dict[str, Any],
        *,
        system_prompt: str | None = None,
        attachments: list[dict[str, Any]] | None = None,
        history: list[dict[str, str]] | None = None,
        use_search: bool = False,
    ) -> dict[str, Any]:
        """Generate JSON matching the given schema."""
        return self._provider.generate_structured(
            user_message,
            response_schema,
            system_prompt=system_prompt,
            attachments=attachments,
            history=history,
            use_search=use_search,
        )

    def generate_stream(
        self,
        user_message: str,
        system_prompt: str | None = None,
        attachments: list[dict[str, Any]] | None = None,
        history: list[dict[str, str]] | None = None,
        use_search: bool = False,
    ) -> Generator[str, None, None]:
        """Stream the response, yielding text chunks as they arrive."""
        return self._provider.generate_stream(
            user_message,
            system_prompt=system_prompt,
            attachments=attachments,
            history=history,
            use_search=use_search,
        )

    @staticmethod
    def format_sse_chunk(
        content: str,
        done: bool = False,
        extra: dict[str, Any] | None = None,
    ) -> str:
        """Format a chunk as SSE data."""
        payload: dict[str, Any] = {"content": content, "done": done}
        if extra:
            payload.update(extra)
        return f"data: {json.dumps(payload)}\n\n"
