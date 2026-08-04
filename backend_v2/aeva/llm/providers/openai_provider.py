"""OpenAI provider backed by OpenAI's Chat Completions and Embeddings APIs.

Uses the ``openai`` SDK against OpenAI's own endpoint (``OPENAI_BASE_URL``
overrides it for Azure/OpenAI-compatible gateways). It is a close sibling of
:class:`~aeva.llm.providers.groq.GroqProvider` -- both speak the OpenAI Chat
Completions wire format -- with three OpenAI-specific differences:

- Embeddings are supported natively (``text-embedding-3-*`` with the
  ``dimensions`` parameter), so the RAG retrieval layer can run on OpenAI.
- ``use_search`` is implemented via OpenAI's Responses API ``web_search`` tool
  (Chat Completions has no grounding). When set, ``generate`` /
  ``generate_stream`` route through the Responses API and populate
  ``last_sources`` from the answer's ``url_citation`` annotations, matching the
  ``{"title", "url"}`` shape the rest of the app expects.
- ``max_completion_tokens`` / ``reasoning_effort`` are sent only when
  configured. Unlike Groq (where a cap guards against reasoning truncation),
  they default to unset so OpenAI is free to size the completion itself.

Structured output uses JSON-object response mode with the target JSON Schema
embedded in the system prompt (as Groq does) rather than native ``json_schema``
strict mode, so the app's shared schemas -- which are not all strict-compatible
(missing ``additionalProperties: false`` / not-all-required) -- work unchanged.
"""

import base64
import json
import math
from collections.abc import Generator
from typing import TYPE_CHECKING, Any, cast

from flask import current_app
from openai import OpenAI

from aeva.llm import prompts
from aeva.llm.providers.base import LLMProvider

if TYPE_CHECKING:
    from openai.types.chat import ChatCompletionMessageParam
    from openai.types.shared_params import ResponseFormatJSONObject

# OpenAI's embeddings endpoint accepts many inputs per call; batch under a
# conservative cap so a large document's chunks embed across several requests.
_EMBED_BATCH_SIZE = 100


def _l2_normalize(values: list[float]) -> list[float]:
    """Scale a vector to unit length for cosine search.

    OpenAI embeddings are unit-length at their native size, but reducing the
    dimension via the ``dimensions`` parameter drops that guarantee, so an
    explicit L2 normalization keeps cosine similarity correct.
    """
    norm = math.sqrt(sum(v * v for v in values))
    if norm == 0:
        return values
    return [v / norm for v in values]


def _batched(texts: list[str], size: int) -> Generator[list[str], None, None]:
    """Yield successive slices of ``texts`` of at most ``size`` items."""
    for start in range(0, len(texts), size):
        yield texts[start : start + size]


class OpenAIProvider(LLMProvider):
    """LLM provider backed by OpenAI (Chat Completions + Embeddings)."""

    def __init__(self, model: str) -> None:
        super().__init__(model)
        self.client = OpenAI(
            api_key=current_app.config["OPENAI_API_KEY"],
            base_url=current_app.config["OPENAI_BASE_URL"] or None,
        )
        self.max_tokens: int = current_app.config["OPENAI_MAX_TOKENS"]
        self.reasoning_effort: str = current_app.config[
            "OPENAI_REASONING_EFFORT"
        ]

    def _params(self) -> dict[str, Any]:
        """Per-call generation params shared by every endpoint.

        Both are optional for OpenAI: ``max_completion_tokens`` is sent only
        when ``OPENAI_MAX_TOKENS`` is a positive value (0 lets OpenAI size the
        completion), and ``reasoning_effort`` is sent only when configured --
        reasoning models accept it while non-reasoning models reject it.
        """
        params: dict[str, Any] = {}
        if self.max_tokens > 0:
            params["max_completion_tokens"] = self.max_tokens
        if self.reasoning_effort:
            params["reasoning_effort"] = self.reasoning_effort
        return params

    @staticmethod
    def _user_content(
        user_message: str,
        attachments: list[dict[str, Any]] | None,
    ) -> str | list[dict[str, Any]]:
        """Build the user turn, inlining image attachments as data URLs.

        OpenAI vision models accept images as base64 data URLs. Other
        attachment types (e.g. PDFs) are skipped and noted so the model can
        tell the user it could not read them rather than silently ignoring
        the request.
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

    def _search_input(
        self,
        user_message: str,
        history: list[dict[str, str]] | None,
    ) -> list[dict[str, str]]:
        """Build the Responses API ``input`` list (history + user turn).

        The system prompt travels via the Responses ``instructions`` param, so
        it is not included here.
        """
        items: list[dict[str, str]] = []
        for item in history or []:
            role = "user" if item["role"] == "user" else "assistant"
            items.append({"role": role, "content": item["content"]})
        items.append({"role": "user", "content": user_message})
        return items

    def _capture_sources(self, response: Any) -> None:
        """Extract ``url_citation`` annotations into ``last_sources``.

        Mirrors Gemini's grounding shape (``{"title", "url"}``), deduping by
        URL. Missing/oddly-shaped fields are tolerated — grounding metadata is
        best-effort and must never break the answer.
        """
        sources: list[dict[str, str]] = []
        seen: set[str] = set()
        try:
            for item in response.output or []:
                if getattr(item, "type", None) != "message":
                    continue
                for part in getattr(item, "content", None) or []:
                    for ann in getattr(part, "annotations", None) or []:
                        if getattr(ann, "type", None) != "url_citation":
                            continue
                        url = getattr(ann, "url", None)
                        if not url or url in seen:
                            continue
                        seen.add(url)
                        sources.append(
                            {"title": getattr(ann, "title", None) or url, "url": url}
                        )
        except (AttributeError, TypeError):
            pass
        self.last_sources = sources

    def _generate_search(
        self,
        user_message: str,
        system_prompt: str | None,
        history: list[dict[str, str]] | None,
    ) -> str:
        """Answer with the Responses API ``web_search`` tool, capturing sources.

        The tool is *forced* (``tool_choice``) so the model always searches and
        emits ``url_citation`` annotations — this path is only reached when the
        planner already decided web grounding is wanted, and leaving the tool
        optional let the model answer from its own weights with no sources.
        """
        response = self.client.responses.create(
            model=self.model,
            tools=[{"type": "web_search"}],
            tool_choice={"type": "web_search"},
            instructions=system_prompt or prompts.SYSTEM_PROMPT,
            input=cast("Any", self._search_input(user_message, history)),
        )
        self._capture_sources(response)
        return response.output_text or ""

    def generate(
        self,
        user_message: str,
        system_prompt: str | None = None,
        attachments: list[dict[str, Any]] | None = None,
        history: list[dict[str, str]] | None = None,
        use_search: bool = False,
    ) -> str:
        """Generate a free-text response.

        With ``use_search`` the answer is grounded via the Responses API
        ``web_search`` tool (and ``last_sources`` is populated); otherwise it
        uses plain Chat Completions.
        """
        self.last_sources = []
        if use_search:
            return self._generate_search(user_message, system_prompt, history)
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
        use_search: bool = False,  # noqa: ARG002 — no OpenAI grounding here.
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

    def _stream_search(
        self,
        user_message: str,
        system_prompt: str | None,
        history: list[dict[str, str]] | None,
    ) -> Generator[str, None, None]:
        """Stream a Responses API ``web_search`` answer, capturing sources.

        Text arrives as ``response.output_text.delta`` events; the final
        ``response.completed`` event carries the full response, from which the
        citation annotations are extracted.
        """
        stream = self.client.responses.create(
            model=self.model,
            tools=[{"type": "web_search"}],
            tool_choice={"type": "web_search"},
            instructions=system_prompt or prompts.SYSTEM_PROMPT,
            input=cast("Any", self._search_input(user_message, history)),
            stream=True,
        )
        for event in stream:
            etype = getattr(event, "type", "")
            if etype == "response.output_text.delta":
                delta = getattr(event, "delta", "")
                if delta:
                    yield delta
            elif etype == "response.completed":
                self._capture_sources(getattr(event, "response", None))

    def generate_stream(
        self,
        user_message: str,
        system_prompt: str | None = None,
        attachments: list[dict[str, Any]] | None = None,
        history: list[dict[str, str]] | None = None,
        use_search: bool = False,
    ) -> Generator[str, None, None]:
        """Stream the response, yielding text chunks as they arrive.

        With ``use_search`` the stream is grounded via the Responses API
        ``web_search`` tool (and ``last_sources`` is populated at the end).
        """
        self.last_sources = []
        if use_search:
            yield from self._stream_search(user_message, system_prompt, history)
            return
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

    def generate_image(self, prompt: str) -> tuple[bytes, str, str]:
        """Generate one image via OpenAI's Images API.

        ``gpt-image-1`` always returns base64 (and rejects the
        ``response_format`` parameter); DALL·E models default to URLs, so
        base64 is requested explicitly for them. The Images API produces no
        accompanying text — the caption is always empty and the tool supplies
        its own answer line.
        """
        kwargs: dict[str, Any] = {
            "model": self.model,
            "prompt": prompt,
            "n": 1,
            "size": "1024x1024",
        }
        if self.model.startswith("dall-e"):
            kwargs["response_format"] = "b64_json"
        response = self.client.images.generate(**kwargs)
        data = (response.data or [None])[0]
        if data is None or not data.b64_json:
            msg = "OpenAI returned no image data"
            raise ValueError(msg)
        return base64.b64decode(data.b64_json), "image/png", ""

    def embed(
        self,
        texts: list[str],
        *,
        task_type: str = "RETRIEVAL_DOCUMENT",  # noqa: ARG002 — Gemini-only.
        output_dimensionality: int = 768,
    ) -> list[list[float]]:
        """Embed texts with OpenAI, L2-normalized for cosine search.

        ``task_type`` is a Gemini concept with no OpenAI equivalent, so it is
        accepted and ignored. ``output_dimensionality`` maps to OpenAI's
        ``dimensions`` parameter (supported by ``text-embedding-3-*``).
        """
        vectors: list[list[float]] = []
        for batch in _batched(texts, _EMBED_BATCH_SIZE):
            response = self.client.embeddings.create(
                model=self.model,
                input=batch,
                dimensions=output_dimensionality,
            )
            vectors.extend(
                _l2_normalize(list(item.embedding)) for item in response.data
            )
        return vectors
