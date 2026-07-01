"""Provider-agnostic LLM facade.

``LLMClient`` is the stable interface the app calls. It resolves a concrete
provider from config and delegates to it, so swapping models or vendors never
touches call sites. ``format_sse_chunk`` lives here because SSE framing is
transport, not vendor, specific.
"""

import json
import logging
import time
from collections.abc import Generator
from contextlib import contextmanager
from typing import Any

from aeva.common.logging_config import log_full_llm_requests, preview
from aeva.llm import prompts
from aeva.llm.providers.base import LLMProvider
from aeva.llm.providers.factory import create_provider

logger = logging.getLogger(__name__)


class LLMClient:
    """Facade over a config-selected :class:`LLMProvider`.

    Every call is logged here — the one choke point all capabilities share —
    with the model, provider, input size, and duration at INFO, and the prompt
    and result previews at DEBUG.
    """

    def __init__(
        self,
        model: str | None = None,
        *,
        config_key: str = "LLM_MODEL",
        provider_key: str | None = None,
    ) -> None:
        self._config_key = config_key
        self._provider: LLMProvider = create_provider(
            config_key=config_key,
            model=model,
            provider_key=provider_key,
        )
        logger.debug(
            "LLMClient ready | key=%s model=%s provider=%s",
            config_key,
            self.model,
            self._provider_name,
        )

    @property
    def model(self) -> str:
        """Resolved model name of the underlying provider."""
        return self._provider.model

    @property
    def _provider_name(self) -> str:
        """Short vendor name for logs (e.g. 'gemini', 'groq')."""
        return type(self._provider).__name__.replace("Provider", "").lower()

    @contextmanager
    def _timed(
        self, label: str, in_text: str, extra: str = ""
    ) -> Generator[None, None, None]:
        """Log the start, end, and duration of one LLM call."""
        logger.info(
            "LLM %s → model=%s provider=%s | in=%dchars%s",
            label,
            self.model,
            self._provider_name,
            len(in_text or ""),
            extra,
        )
        start = time.perf_counter()
        try:
            yield
        except Exception:
            logger.exception(
                "LLM %s ✗ model=%s (%.0fms)",
                label,
                self.model,
                (time.perf_counter() - start) * 1000,
            )
            raise
        logger.info(
            "LLM %s ✓ model=%s (%.0fms)",
            label,
            self.model,
            (time.perf_counter() - start) * 1000,
        )

    def _log_request(
        self,
        label: str,
        user_message: str,
        *,
        system_prompt: str | None = None,
        attachments: list[dict[str, Any]] | None = None,
        history: list[dict[str, str]] | None = None,
        use_search: bool = False,
        response_schema: dict[str, Any] | None = None,
    ) -> None:
        """Log the request the provider is about to send.

        When ``LOG_LLM_REQUESTS`` is enabled the complete final prompt — the
        resolved system prompt, every history turn, attachment metadata, the
        user message, and any structured-output schema — is emitted uncapped at
        INFO. Otherwise a length-capped preview is logged at DEBUG, matching the
        rest of the logging config.
        """
        if not log_full_llm_requests():
            if logger.isEnabledFor(logging.DEBUG):
                logger.debug("LLM %s prompt: %s", label, preview(user_message))
            return

        lines = [
            f"LLM {label} full request | model={self.model} "
            f"provider={self._provider_name} search={use_search}",
            f"── system prompt ──\n{system_prompt or prompts.SYSTEM_PROMPT}",
        ]
        for i, item in enumerate(history or []):
            role = item.get("role", "?")
            content = item.get("content", "")
            lines.append(f"── history[{i}] {role} ──\n{content}")
        for i, att in enumerate(attachments or []):
            mime = att.get("mime_type", "?")
            size = len(att.get("data", b"") or b"")
            lines.append(f"── attachment[{i}] ──\nmime={mime} bytes={size}")
        lines.append(f"── user message ──\n{user_message}")
        if response_schema is not None:
            schema_json = json.dumps(response_schema)
            lines.append(f"── response schema ──\n{schema_json}")
        logger.info("\n".join(lines))

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
        extra = (
            f" search={use_search} attach={len(attachments or [])}"
            f" hist={len(history or [])}"
        )
        self._log_request(
            "generate",
            user_message,
            system_prompt=system_prompt,
            attachments=attachments,
            history=history,
            use_search=use_search,
        )
        with self._timed("generate", user_message, extra):
            result = self._provider.generate(
                user_message,
                system_prompt=system_prompt,
                attachments=attachments,
                history=history,
                use_search=use_search,
            )
        if logger.isEnabledFor(logging.DEBUG):
            logger.debug("LLM generate result: %s", preview(result))
        return result

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
        self._log_request(
            "structured",
            user_message,
            system_prompt=system_prompt,
            attachments=attachments,
            history=history,
            use_search=use_search,
            response_schema=response_schema,
        )
        with self._timed("structured", user_message, " (json)"):
            result = self._provider.generate_structured(
                user_message,
                response_schema,
                system_prompt=system_prompt,
                attachments=attachments,
                history=history,
                use_search=use_search,
            )
        if logger.isEnabledFor(logging.DEBUG):
            logger.debug("LLM structured result: %s", preview(result))
        return result

    def generate_stream(
        self,
        user_message: str,
        system_prompt: str | None = None,
        attachments: list[dict[str, Any]] | None = None,
        history: list[dict[str, str]] | None = None,
        use_search: bool = False,
    ) -> Generator[str, None, None]:
        """Stream the response, yielding text chunks as they arrive."""
        logger.info(
            "LLM stream → model=%s provider=%s | in=%dchars search=%s",
            self.model,
            self._provider_name,
            len(user_message or ""),
            use_search,
        )
        self._log_request(
            "stream",
            user_message,
            system_prompt=system_prompt,
            attachments=attachments,
            history=history,
            use_search=use_search,
        )
        start = time.perf_counter()

        def _streamed() -> Generator[str, None, None]:
            chunks = 0
            chars = 0
            try:
                for chunk in self._provider.generate_stream(
                    user_message,
                    system_prompt=system_prompt,
                    attachments=attachments,
                    history=history,
                    use_search=use_search,
                ):
                    chunks += 1
                    chars += len(chunk)
                    yield chunk
            except Exception:
                logger.exception(
                    "LLM stream ✗ model=%s (%.0fms)",
                    self.model,
                    (time.perf_counter() - start) * 1000,
                )
                raise
            logger.info(
                "LLM stream ✓ model=%s | %d chunks, %d chars (%.0fms)",
                self.model,
                chunks,
                chars,
                (time.perf_counter() - start) * 1000,
            )

        return _streamed()

    def embed(
        self,
        texts: list[str],
        *,
        task_type: str = "RETRIEVAL_DOCUMENT",
        output_dimensionality: int = 768,
    ) -> list[list[float]]:
        """Embed texts via the underlying provider (RAG retrieval layer)."""
        logger.info(
            "LLM embed → model=%s provider=%s | %d texts, dim=%d, task=%s",
            self.model,
            self._provider_name,
            len(texts),
            output_dimensionality,
            task_type,
        )
        start = time.perf_counter()
        try:
            vectors = self._provider.embed(
                texts,
                task_type=task_type,
                output_dimensionality=output_dimensionality,
            )
        except Exception:
            logger.exception(
                "LLM embed ✗ model=%s (%.0fms)",
                self.model,
                (time.perf_counter() - start) * 1000,
            )
            raise
        logger.info(
            "LLM embed ✓ model=%s | %d vectors (%.0fms)",
            self.model,
            len(vectors),
            (time.perf_counter() - start) * 1000,
        )
        return vectors

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
