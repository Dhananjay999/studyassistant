"""Groq provider backed by Groq's OpenAI-compatible API.

Groq exposes an OpenAI-compatible Chat Completions endpoint, so this provider
drives it through the ``openai`` SDK pointed at the Groq base URL. Two vendor
differences are handled here so call sites stay provider-agnostic:

- ``use_search`` (Google Search grounding) has no Groq equivalent; it is
  accepted and ignored, and ``last_sources`` stays empty.
- Structured output is produced via JSON-object response mode with the target
  JSON Schema embedded in the system prompt, which works across Groq models
  without relying on per-model strict-schema support.
"""

import base64
import json
from collections.abc import Generator
from typing import TYPE_CHECKING, Any, cast

from flask import current_app
from openai import OpenAI

from aeva.llm import prompts
from aeva.llm.providers.base import LLMProvider

if TYPE_CHECKING:
    from openai.types.chat import ChatCompletionMessageParam
    from openai.types.shared_params import ResponseFormatJSONObject


class GroqProvider(LLMProvider):
    """LLM provider backed by Groq (OpenAI-compatible Chat Completions)."""

    def __init__(self, model: str) -> None:
        super().__init__(model)
        self.client = OpenAI(
            api_key=current_app.config["GROQ_API_KEY"],
            base_url=current_app.config["GROQ_BASE_URL"],
        )
        self.max_tokens: int = current_app.config["GROQ_MAX_TOKENS"]
        self.reasoning_effort: str = current_app.config["GROQ_REASONING_EFFORT"]

    def _params(self) -> dict[str, Any]:
        """Per-call generation params shared by every endpoint.

        ``max_completion_tokens`` is always sent: reasoning-capable models (e.g.
        openai/gpt-oss-20b) spend completion tokens on reasoning and otherwise
        truncate long structured output mid-document, which Groq surfaces as a
        ``json_validate_failed`` 400. It is reserved against the account's
        tokens-per-minute limit, so the cap stays modest (``GROQ_MAX_TOKENS``).
        ``reasoning_effort`` is sent only when configured -- lowering it frees
        token budget for the answer, and non-reasoning models reject it.
        """
        params: dict[str, Any] = {"max_completion_tokens": self.max_tokens}
        if self.reasoning_effort:
            params["reasoning_effort"] = self.reasoning_effort
        return params

    @staticmethod
    def _user_content(
        user_message: str,
        attachments: list[dict[str, Any]] | None,
    ) -> str | list[dict[str, Any]]:
        """Build the user turn, inlining image attachments as data URLs.

        Groq vision models accept images as base64 data URLs. Non-image
        attachments (e.g. PDFs) have no Groq equivalent, so they are skipped and
        a note is appended so the model can tell the user it could not read
        them rather than silently ignoring the request.
        """
        if not attachments:
            return user_message

        parts: list[dict[str, Any]] = []
        skipped: list[str] = []
        for att in attachments:
            mime = att.get("mime_type", "")
            if mime.startswith("image/"):
                encoded = base64.b64encode(att["data"]).decode("ascii")
                parts.append({
                    "type": "image_url",
                    "image_url": {"url": f"data:{mime};base64,{encoded}"},
                })
            else:
                skipped.append(mime or "unknown")

        text = user_message
        if skipped:
            text += (
                "\n\n[Note: attached file(s) of type "
                f"{', '.join(skipped)} are not supported by this provider "
                "and were not included.]"
            )
        parts.insert(0, {"type": "text", "text": text})
        return parts

    def _messages(
        self,
        user_message: str,
        system_prompt: str | None,
        attachments: list[dict[str, Any]] | None,
        history: list[dict[str, str]] | None,
        schema_hint: str | None = None,
    ) -> list[dict[str, Any]]:
        """Build OpenAI-style chat messages: system + history + user turn."""
        system = system_prompt or prompts.SYSTEM_PROMPT
        if schema_hint:
            system = f"{system}\n\n{schema_hint}"

        messages: list[dict[str, Any]] = [
            {"role": "system", "content": system}
        ]
        for item in history or []:
            role = "user" if item["role"] == "user" else "assistant"
            messages.append({"role": role, "content": item["content"]})
        messages.append({
            "role": "user",
            "content": self._user_content(user_message, attachments),
        })
        return messages

    def generate(
        self,
        user_message: str,
        system_prompt: str | None = None,
        attachments: list[dict[str, Any]] | None = None,
        history: list[dict[str, str]] | None = None,
        use_search: bool = False,  # noqa: ARG002 — no Groq grounding equivalent.
    ) -> str:
        """Generate a free-text response (search grounding is unavailable)."""
        self.last_sources = []
        response = self.client.chat.completions.create(
            model=self.model,
            messages=cast(
                "list[ChatCompletionMessageParam]",
                self._messages(
                    user_message, system_prompt, attachments, history
                ),
            ),
            **self._params(),
        )
        return response.choices[0].message.content or ""

    def generate_structured(
        self,
        user_message: str,
        response_schema: dict[str, Any],
        *,
        system_prompt: str | None = None,
        attachments: list[dict[str, Any]] | None = None,
        history: list[dict[str, str]] | None = None,
        use_search: bool = False,  # noqa: ARG002 — no Groq grounding equivalent.
    ) -> dict[str, Any]:
        """Generate JSON matching the given schema via JSON-object mode."""
        self.last_sources = []
        schema_hint = (
            "Respond with a single JSON object that conforms to this JSON "
            "Schema. Output only the JSON object, with no prose and no code "
            f"fences:\n{json.dumps(response_schema)}"
        )
        response = self.client.chat.completions.create(
            model=self.model,
            messages=cast(
                "list[ChatCompletionMessageParam]",
                self._messages(
                    user_message,
                    system_prompt,
                    attachments,
                    history,
                    schema_hint=schema_hint,
                ),
            ),
            response_format=cast(
                "ResponseFormatJSONObject", {"type": "json_object"}
            ),
            **self._params(),
        )
        text = response.choices[0].message.content or "{}"
        data: dict[str, Any] = json.loads(text)
        return data

    def generate_stream(
        self,
        user_message: str,
        system_prompt: str | None = None,
        attachments: list[dict[str, Any]] | None = None,
        history: list[dict[str, str]] | None = None,
        use_search: bool = False,  # noqa: ARG002 — no Groq grounding equivalent.
    ) -> Generator[str, None, None]:
        """Stream the response, yielding text chunks as they arrive."""
        self.last_sources = []
        stream = self.client.chat.completions.create(
            model=self.model,
            messages=cast(
                "list[ChatCompletionMessageParam]",
                self._messages(
                    user_message, system_prompt, attachments, history
                ),
            ),
            stream=True,
            **self._params(),
        )
        for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta.content
            if delta:
                yield delta
