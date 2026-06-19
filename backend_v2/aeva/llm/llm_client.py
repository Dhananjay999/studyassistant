"""Simple Gemini LLM client."""

import io
import json
from collections.abc import Generator
from typing import Any

from flask import current_app
from google import genai
from google.genai import types

from aeva.llm import prompts


class LLMClient:
    """Minimal Google Gemini client (model from env or constructor)."""

    def __init__(
        self,
        model: str | None = None,
        *,
        config_key: str = "LLM_MODEL",
    ) -> None:
        self.model = model or current_app.config[config_key]
        self.client = genai.Client(
            api_key=current_app.config["GEMINI_API_KEY"]
        )
        # Grounding sources captured from the most recent call.
        self.last_sources: list[dict[str, str]] = []

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
        return json.loads(text)

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

    def build_web_search_prompt(self, query: str) -> str:
        """Build prompt for web search mode."""
        return prompts.WEB_SEARCH_PROMPT.format(query=query)

    def build_media_prompt(self, query: str) -> str:
        """Build prompt for media mode."""
        return prompts.MEDIA_PROMPT.format(query=query)

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
