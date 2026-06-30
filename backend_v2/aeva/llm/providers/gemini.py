"""Google Gemini provider."""

import io
import json
import math
from collections.abc import Generator
from typing import Any

from flask import current_app
from google import genai
from google.genai import types

from aeva.llm import prompts
from aeva.llm.providers.base import LLMProvider

# Gemini caps the number of texts accepted per embed_content call; batch under
# it so a large document's chunks embed across several requests.
_EMBED_BATCH_SIZE = 100


def _l2_normalize(values: list[float]) -> list[float]:
    """Scale a vector to unit length.

    Gemini embeddings are pre-normalized only at the default 3072 dimensions;
    truncated outputs (e.g. 768) are not, so cosine search needs an explicit
    L2 normalization here to stay correct.
    """
    norm = math.sqrt(sum(v * v for v in values))
    if norm == 0:
        return values
    return [v / norm for v in values]


def _batched(texts: list[str], size: int) -> Generator[list[str], None, None]:
    """Yield successive slices of ``texts`` of at most ``size`` items."""
    for start in range(0, len(texts), size):
        yield texts[start : start + size]


class GeminiProvider(LLMProvider):
    """LLM provider backed by Google Gemini (google-genai)."""

    def __init__(self, model: str) -> None:
        super().__init__(model)
        self.client = genai.Client(
            api_key=current_app.config["GEMINI_API_KEY"]
        )

    def _contents(
        self,
        user_message: str,
        attachments: list[dict[str, Any]] | None = None,
        history: list[dict[str, str]] | None = None,
    ) -> list[Any]:
        """Build contents: history + uploaded files + current message."""
        contents: list[Any] = []

        for item in history or []:
            role = "user" if item["role"] == "user" else "model"
            contents.append(
                types.Content(
                    role=role,
                    parts=[types.Part.from_text(text=item["content"])],
                )
            )

        parts: list[Any] = []
        for att in attachments or []:
            uploaded = self.client.files.upload(
                file=io.BytesIO(att["data"]),
                config=types.UploadFileConfig(mime_type=att["mime_type"]),
            )
            parts.append(
                types.Part.from_uri(
                    file_uri=uploaded.uri,
                    mime_type=uploaded.mime_type,
                )
            )
        parts.append(types.Part.from_text(text=user_message))
        contents.append(types.Content(role="user", parts=parts))
        return contents

    def _config(
        self,
        system_prompt: str | None,
        use_search: bool,
        response_schema: dict[str, Any] | None = None,
    ) -> types.GenerateContentConfig:
        """Build generation config."""
        tools = (
            [types.Tool(google_search=types.GoogleSearch())]
            if use_search
            else None
        )
        kwargs: dict[str, Any] = {
            "system_instruction": system_prompt or prompts.SYSTEM_PROMPT,
            "tools": tools,
        }
        if response_schema:
            kwargs["response_mime_type"] = "application/json"
            kwargs["response_schema"] = response_schema
        return types.GenerateContentConfig(**kwargs)

    @staticmethod
    def _extract_sources(response: Any) -> list[dict[str, str]]:
        """Pull grounding citations (title + url) from a response."""
        sources: list[dict[str, str]] = []
        try:
            metadata = response.candidates[0].grounding_metadata
            chunks = metadata.grounding_chunks or []
        except (AttributeError, IndexError, TypeError):
            return sources

        seen: set[str] = set()
        for chunk in chunks:
            web = getattr(chunk, "web", None)
            if not web or not web.uri or web.uri in seen:
                continue
            seen.add(web.uri)
            sources.append({"title": web.title or web.uri, "url": web.uri})
        return sources

    def generate(
        self,
        user_message: str,
        system_prompt: str | None = None,
        attachments: list[dict[str, Any]] | None = None,
        history: list[dict[str, str]] | None = None,
        use_search: bool = False,
    ) -> str:
        """Generate a response (optionally grounded with Google Search)."""
        self.last_sources = []
        response = self.client.models.generate_content(
            model=self.model,
            contents=self._contents(user_message, attachments, history),
            config=self._config(system_prompt, use_search),
        )
        self.last_sources = self._extract_sources(response)
        return response.text or ""

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
        self.last_sources = []
        response = self.client.models.generate_content(
            model=self.model,
            contents=self._contents(user_message, attachments, history),
            config=self._config(
                system_prompt,
                use_search,
                response_schema=response_schema,
            ),
        )
        self.last_sources = self._extract_sources(response)
        text = response.text or "{}"
        data: dict[str, Any] = json.loads(text)
        return data

    def generate_stream(
        self,
        user_message: str,
        system_prompt: str | None = None,
        attachments: list[dict[str, Any]] | None = None,
        history: list[dict[str, str]] | None = None,
        use_search: bool = False,
    ) -> Generator[str, None, None]:
        """Stream the response, yielding text chunks as they arrive."""
        self.last_sources = []
        stream = self.client.models.generate_content_stream(
            model=self.model,
            contents=self._contents(user_message, attachments, history),
            config=self._config(system_prompt, use_search),
        )
        for chunk in stream:
            sources = self._extract_sources(chunk)
            if sources:
                self.last_sources = sources
            if chunk.text:
                yield chunk.text

    def embed(
        self,
        texts: list[str],
        *,
        task_type: str = "RETRIEVAL_DOCUMENT",
        output_dimensionality: int = 768,
    ) -> list[list[float]]:
        """Embed texts with Gemini, L2-normalized for cosine search.

        ``task_type`` is ``RETRIEVAL_DOCUMENT`` when indexing chunks and
        ``RETRIEVAL_QUERY`` for a search query; matching them improves recall.
        """
        vectors: list[list[float]] = []
        for batch in _batched(texts, _EMBED_BATCH_SIZE):
            response = self.client.models.embed_content(
                model=self.model,
                contents=batch,  # type: ignore[arg-type]
                config=types.EmbedContentConfig(
                    task_type=task_type,
                    output_dimensionality=output_dimensionality,
                ),
            )
            vectors.extend(
                _l2_normalize(list(embedding.values or []))
                for embedding in response.embeddings or []
            )
        return vectors
