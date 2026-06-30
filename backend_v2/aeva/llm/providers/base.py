"""Provider-agnostic LLM interface.

Any vendor (Gemini, OpenAI, Anthropic, ...) implements this interface. Method
signatures mirror what the app already calls on ``LLMClient`` so swapping a
provider never changes call sites. ``response_schema`` is a
provider-independent JSON Schema; each provider is responsible for translating
it into its own structured-output mechanism so the returned shape stays
identical across vendors.
"""

from abc import ABC, abstractmethod
from collections.abc import Generator
from typing import Any


class LLMProvider(ABC):
    """A single LLM vendor capable of text and structured generation."""

    def __init__(self, model: str) -> None:
        self.model = model
        # Grounding citations captured from the most recent call (if any).
        self.last_sources: list[dict[str, str]] = []

    @abstractmethod
    def generate(
        self,
        user_message: str,
        system_prompt: str | None = None,
        attachments: list[dict[str, Any]] | None = None,
        history: list[dict[str, str]] | None = None,
        use_search: bool = False,
    ) -> str:
        """Generate a free-text response."""

    @abstractmethod
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
        """Generate JSON matching ``response_schema``."""

    @abstractmethod
    def generate_stream(
        self,
        user_message: str,
        system_prompt: str | None = None,
        attachments: list[dict[str, Any]] | None = None,
        history: list[dict[str, str]] | None = None,
        use_search: bool = False,
    ) -> Generator[str, None, None]:
        """Stream the response, yielding text chunks as they arrive."""

    def embed(
        self,
        texts: list[str],
        *,
        task_type: str = "RETRIEVAL_DOCUMENT",
        output_dimensionality: int = 768,
    ) -> list[list[float]]:
        """Return one embedding vector per input text.

        Only providers backing the RAG retrieval layer implement this; the
        default refuses so a misconfigured embedding provider fails loudly
        rather than silently returning nothing.
        """
        msg = f"{type(self).__name__} does not support embeddings"
        raise NotImplementedError(msg)
