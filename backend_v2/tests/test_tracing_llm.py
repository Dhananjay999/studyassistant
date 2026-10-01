"""Execution tracing at the LLM choke point: ``LLMClient`` and providers.

Each ``LLMClient`` method must add exactly one span to the running trace —
with the request as sent, the raw result, and sizes instead of bytes or
vectors — and must behave exactly as before when no turn is being traced.
The recording itself lives in ``aeva.tracing.services.llm_trace``: decorators
on the client's methods and one-line reports from the providers.
"""

import inspect
import json
import logging
import time
from types import SimpleNamespace

import pytest

from aeva import tracing
from aeva.llm import prompts
from aeva.llm.llm_client import LLMClient
from aeva.llm.prompts.builder import PromptBuilder, PromptTemplate
from aeva.llm.providers.gemini import GeminiProvider
from aeva.llm.providers.groq import GroqProvider
from aeva.llm.providers.openai_provider import OpenAIProvider
from aeva.tracing import recorder, store
from aeva.tracing.services import llm_trace

IMAGE_BYTES = b"\x89PNG-raw-image-bytes" * 50
ATTACHMENT = {"mime_type": "application/pdf", "data": b"%PDF-secret-bytes" * 9}
VECTOR_VALUE = 0.123456789
SCHEMA = {"type": "object", "properties": {"answer": {"type": "string"}}}
HISTORY = [
    {"role": "user", "content": "hi"},
    {"role": "assistant", "content": "hello", "tool": "general"},
]

TEMPLATE = PromptTemplate(
    name="unit_answer",
    system="{SYSTEM_PROMPT}",
    user="Question: {USER_MESSAGE}",
    defaults={"SYSTEM_PROMPT": "You are a tutor."},
)
# Like the real image template: nothing on the system channel.
IMAGE_TEMPLATE = PromptTemplate(
    name="unit_image", system="", user="Draw: {USER_MESSAGE}"
)


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    """Each test starts unbound, with storage 'available'."""
    recorder._BINDING.set(None)
    monkeypatch.setattr(store, "_unavailable_until", 0.0)
    monkeypatch.setattr(store, "_known_prompt_versions", set())
    for key in (
        "AI_TRACE_ENABLED",
        "AI_TRACE_SCOPE",
        "AI_TRACE_SAMPLE_RATE",
        "AI_TRACE_MAX_FIELD_CHARS",
        "AI_TRACE_MAX_SPANS",
        "LOG_LLM_REQUESTS",
    ):
        monkeypatch.delenv(key, raising=False)
    yield
    recorder._BINDING.set(None)


@pytest.fixture
def saved(monkeypatch):
    """Capture what finish_turn would write instead of hitting Supabase."""
    box: dict = {}

    def fake_persist(trace_row, span_rows, prompt_rows):
        box["trace"] = trace_row
        box["spans"] = span_rows
        box["prompts"] = prompt_rows
        return True

    monkeypatch.setattr(store, "persist", fake_persist)
    return box


class FakeProvider:
    """A vendor stand-in: records what it was asked, returns canned data."""

    def __init__(self, *, chunks=("Hel", "lo ", "there"), fail=None):
        self.model = "fake-1"
        self.last_sources: list[dict[str, str]] = []
        self.calls: list[tuple] = []
        self.chunks = chunks
        # ("generate" | "structured" | "image" | "embed", exc) or
        # ("stream", exc, chunks_before_failure).
        self.fail = fail
        self.text = "Osmosis is diffusion of water."
        self.json = {"answer": "42", "steps": [1, 2]}
        self.image = (IMAGE_BYTES, "image/png", "a diagram")
        self.first_chunk_delay = 0.0

    def _maybe_fail(self, method):
        if self.fail and self.fail[0] == method:
            raise self.fail[1]

    def generate(
        self,
        user_message,
        *,
        system_prompt=None,
        attachments=None,
        history=None,
        use_search=False,
    ):
        self.calls.append(
            ("generate", user_message, system_prompt, attachments, history)
        )
        self._maybe_fail("generate")
        if use_search:
            self.last_sources = [{"title": "Wiki", "url": "https://w.org/o"}]
        return self.text

    def generate_structured(
        self,
        user_message,
        response_schema,
        *,
        system_prompt=None,
        attachments=None,
        history=None,
        use_search=False,
    ):
        self.calls.append(
            ("structured", user_message, system_prompt, response_schema)
        )
        self._maybe_fail("structured")
        return self.json

    def generate_stream(
        self,
        user_message,
        *,
        system_prompt=None,
        attachments=None,
        history=None,
        use_search=False,
    ):
        self.calls.append(
            ("stream", user_message, system_prompt, attachments, history)
        )
        if self.first_chunk_delay:
            time.sleep(self.first_chunk_delay)
        for index, chunk in enumerate(self.chunks):
            if self.fail and self.fail[0] == "stream" and index == self.fail[2]:
                raise self.fail[1]
            yield chunk
        if use_search:
            self.last_sources = [{"title": "Wiki", "url": "https://w.org/o"}]

    def generate_image(self, prompt, *, aspect="square"):
        self.calls.append(("image", prompt, aspect))
        self._maybe_fail("image")
        return self.image

    def embed(
        self,
        texts,
        *,
        task_type="RETRIEVAL_DOCUMENT",
        output_dimensionality=768,
    ):
        self.calls.append(("embed", texts, task_type, output_dimensionality))
        self._maybe_fail("embed")
        return [[VECTOR_VALUE] * 4 for _ in texts]


def _client(provider, config_key="LLM_UNIT_MODEL"):
    """An ``LLMClient`` over ``provider``, skipping the config-driven factory."""
    client = LLMClient.__new__(LLMClient)
    client._provider = provider
    client._config_key = config_key
    return client


def _start():
    return tracing.start_turn(
        user_id="u1", message="what is osmosis?", endpoint="stream"
    )


def _finish(saved):
    tracing.finish_turn()
    return saved["spans"]


def _of_kind(spans, kind):
    return [s for s in spans if s["kind"] == kind]


def _only(spans, kind):
    found = _of_kind(spans, kind)
    assert len(found) == 1, [(s["kind"], s["name"]) for s in spans]
    return found[0]


class TestGenerate:
    def test_records_request_result_and_identity(self, saved):
        provider = FakeProvider()
        client = _client(provider)
        _start()
        with tracing.span(tracing.KIND_TOOL, "general"):
            result = client.generate(
                "What is osmosis?",
                "Be brief.",
                attachments=[ATTACHMENT],
                history=HISTORY,
            )
        spans = _finish(saved)
        assert result is provider.text

        llm = _only(spans, "llm")
        tool = _only(spans, "tool")
        assert llm["parent_id"] == tool["id"]
        assert llm["name"] == "generate"
        assert llm["status"] == "ok"
        assert llm["provider"] == "fake"
        assert llm["model"] == "fake-1"
        assert llm["prompt_name"] is None
        assert llm["duration_ms"] is not None
        assert llm["input"] == {
            "system_prompt": "Be brief.",
            "history": [
                {"role": "user", "content": "hi"},
                {"role": "assistant", "content": "hello"},
            ],
            "user_message": "What is osmosis?",
            "attachments": [
                {
                    "mime_type": "application/pdf",
                    "bytes": len(ATTACHMENT["data"]),
                }
            ],
        }
        assert llm["output"] == {"text": provider.text}
        assert llm["meta"] == {
            "method": "generate",
            "label": "generate",
            "config_key": "LLM_UNIT_MODEL",
            "input_chars": len("Be brief.What is osmosis?hihello"),
            "history_turns": 2,
            "output_chars": len(provider.text),
        }
        assert saved["trace"]["llm_calls"] == 1
        assert saved["trace"]["models"] == ["fake-1"]
        assert "secret-bytes" not in json.dumps(saved)

    def test_missing_system_prompt_is_recorded_as_the_default(self, saved):
        provider = FakeProvider()
        _start()
        _client(provider).generate("hello", log_label="smalltalk")
        llm = _only(_finish(saved), "llm")
        # The trace shows what the provider sends ...
        assert llm["input"]["system_prompt"] == prompts.SYSTEM_PROMPT
        assert llm["meta"]["system_prompt_defaulted"] is True
        assert llm["name"] == "smalltalk"
        assert llm["meta"]["label"] == "smalltalk"
        # ... while the provider still gets the caller's own arguments.
        assert provider.calls == [("generate", "hello", None, None, None)]

    def test_search_call_records_sources(self, saved):
        _start()
        _client(FakeProvider()).generate("news?", "sys", use_search=True)
        llm = _only(_finish(saved), "llm")
        assert llm["input"]["use_search"] is True
        assert llm["meta"]["sources"] == [
            {"title": "Wiki", "url": "https://w.org/o"}
        ]
        assert "system_prompt_defaulted" not in llm["meta"]

    def test_provider_error_is_recorded_and_propagates(self, saved, caplog):
        boom = RuntimeError("vendor 500")
        client = _client(FakeProvider(fail=("generate", boom)))
        _start()
        with (
            caplog.at_level(logging.INFO, logger="aeva.llm.llm_client"),
            pytest.raises(RuntimeError) as raised,
        ):
            client.generate("hello", "sys")
        assert raised.value is boom
        # The span closed: later steps attach to the turn, not to the call.
        tracing.event(tracing.KIND_DECISION, "after")
        spans = _finish(saved)
        llm = _only(spans, "llm")
        assert llm["status"] == "error"
        assert llm["error"] == "RuntimeError: vendor 500"
        assert llm["output"] is None
        assert _only(spans, "decision")["parent_id"] == spans[0]["id"]
        assert any("LLM generate ✗" in r.getMessage() for r in caplog.records)


class TestStructured:
    def test_records_schema_and_json_result(self, saved):
        provider = FakeProvider()
        _start()
        result = _client(provider).generate_structured(
            "plan this",
            SCHEMA,
            system_prompt="You plan.",
            log_label="orchestrator",
        )
        llm = _only(_finish(saved), "llm")
        assert result is provider.json
        assert llm["name"] == "orchestrator"
        assert llm["input"]["response_schema"] == SCHEMA
        assert llm["input"]["system_prompt"] == "You plan."
        assert llm["output"] == {"json": {"answer": "42", "steps": [1, 2]}}
        assert llm["meta"]["method"] == "generate_structured"
        assert llm["meta"]["output_chars"] == len(json.dumps(provider.json))

    def test_result_is_snapshotted_before_the_caller_mutates_it(self, saved):
        provider = FakeProvider()
        _start()
        plan = _client(provider).generate_structured("plan", SCHEMA)
        plan["answer"] = "rewritten by the router"
        llm = _only(_finish(saved), "llm")
        assert llm["output"] == {"json": {"answer": "42", "steps": [1, 2]}}

    def test_links_to_the_template_that_built_the_prompt(self, saved):
        _start()
        rendered = PromptBuilder.build(TEMPLATE, USER_MESSAGE="why?")
        _client(FakeProvider()).generate_structured(
            rendered.user_message,
            SCHEMA,
            system_prompt=rendered.system_prompt,
            log_label="rag_rewrite",
        )
        spans = _finish(saved)
        prompt = _only(spans, "prompt")
        llm = _only(spans, "llm")
        assert llm["name"] == "unit_answer"
        assert llm["prompt_name"] == "unit_answer"
        assert llm["prompt_hash"] == prompt["prompt_hash"]
        assert llm["meta"]["prompt_span_id"] == prompt["id"]
        assert llm["meta"]["label"] == "rag_rewrite"

    def test_error_is_recorded_and_propagates(self, saved):
        boom = ValueError("bad json")
        client = _client(FakeProvider(fail=("structured", boom)))
        _start()
        with pytest.raises(ValueError, match="bad json") as raised:
            client.generate_structured("plan", SCHEMA)
        assert raised.value is boom
        llm = _only(_finish(saved), "llm")
        assert llm["status"] == "error"
        assert llm["error"] == "ValueError: bad json"


class TestStream:
    def test_full_stream_records_text_chunks_and_ttft(self, saved, caplog):
        provider = FakeProvider()
        provider.first_chunk_delay = 0.03
        client = _client(provider)
        _start()
        with (
            caplog.at_level(logging.INFO, logger="aeva.llm.llm_client"),
            tracing.span(tracing.KIND_TOOL, "general"),
        ):
            chunks = list(client.generate_stream("q?", "sys", history=HISTORY))
        spans = _finish(saved)
        assert chunks == ["Hel", "lo ", "there"]

        llm = _only(spans, "llm")
        assert llm["parent_id"] == _only(spans, "tool")["id"]
        assert llm["name"] == "stream"
        assert llm["status"] == "ok"
        assert llm["provider"] == "fake"
        assert llm["model"] == "fake-1"
        assert llm["output"] == {"text": "Hello there"}
        meta = llm["meta"]
        assert meta["method"] == "generate_stream"
        assert meta["label"] == "stream"
        assert meta["config_key"] == "LLM_UNIT_MODEL"
        assert meta["chunks"] == 3
        assert meta["output_chars"] == len("Hello there")
        assert meta["history_turns"] == 2
        # Time to first chunk, measured from the moment the span opened.
        assert isinstance(meta["ttft_ms"], int)
        assert 25 <= meta["ttft_ms"] <= llm["duration_ms"]
        assert "sources" not in meta
        messages = [r.getMessage() for r in caplog.records]
        assert any("LLM stream →" in m for m in messages)
        assert any("LLM stream ✓" in m and "3 chunks" in m for m in messages)

    def test_prompt_built_by_the_builder_is_linked(self, saved):
        _start()
        rendered = PromptBuilder.build(TEMPLATE, USER_MESSAGE="why?")
        with tracing.span(tracing.KIND_TOOL, "general"):
            text = "".join(
                _client(FakeProvider()).generate_stream(
                    rendered.user_message,
                    rendered.system_prompt,
                    history=HISTORY,
                )
            )
        spans = _finish(saved)
        assert text == "Hello there"
        prompt = _only(spans, "prompt")
        llm = _only(spans, "llm")
        assert prompt["name"] == "unit_answer"
        assert prompt["prompt_hash"] == tracing.template_hash(TEMPLATE)
        assert llm["name"] == "unit_answer"
        assert llm["prompt_name"] == prompt["prompt_name"] == "unit_answer"
        assert llm["prompt_hash"] == prompt["prompt_hash"]
        assert llm["meta"]["prompt_span_id"] == prompt["id"]
        assert llm["meta"]["label"] == "stream"
        assert llm["input"]["system_prompt"] == "You are a tutor."
        assert llm["input"]["user_message"] == "Question: why?"
        assert "system_prompt_defaulted" not in llm["meta"]
        assert saved["trace"]["prompt_names"] == ["unit_answer"]

    def test_span_opens_on_first_iteration_not_on_call(self, saved):
        provider = FakeProvider()
        _start()
        stream = _client(provider).generate_stream("q?", "sys")
        # Steps recorded before anyone iterates are not children of the call.
        tracing.event(tracing.KIND_DECISION, "before_iteration")
        assert provider.calls == []
        spans = _finish(saved)
        assert _of_kind(spans, "llm") == []
        assert _only(spans, "decision")["parent_id"] == spans[0]["id"]
        stream.close()

    def test_aborted_stream_keeps_the_partial_text(self, saved):
        _start()
        stream = _client(FakeProvider()).generate_stream(
            "q?", "sys", use_search=True
        )
        assert next(stream) == "Hel"
        # The consumer stops iterating, as on a client disconnect.
        stream.close()
        tracing.event(tracing.KIND_DECISION, "after")
        spans = _finish(saved)
        llm = _only(spans, "llm")
        assert llm["status"] == "aborted"
        assert llm["error"] is None
        assert llm["output"] == {"text": "Hel"}
        assert llm["meta"]["chunks"] == 1
        assert llm["meta"]["output_chars"] == 3
        assert isinstance(llm["meta"]["ttft_ms"], int)
        # Citations are only valid after a complete stream.
        assert "sources" not in llm["meta"]
        assert _only(spans, "decision")["parent_id"] == spans[0]["id"]

    def test_provider_error_mid_stream_is_recorded_and_propagates(
        self, saved, caplog
    ):
        boom = ConnectionError("stream dropped")
        client = _client(FakeProvider(fail=("stream", boom, 2)))
        _start()
        stream = client.generate_stream("q?", "sys")
        with caplog.at_level(logging.INFO, logger="aeva.llm.llm_client"):
            assert [next(stream), next(stream)] == ["Hel", "lo "]
            with pytest.raises(ConnectionError) as raised:
                next(stream)
        assert raised.value is boom
        llm = _only(_finish(saved), "llm")
        assert llm["status"] == "error"
        assert llm["error"] == "ConnectionError: stream dropped"
        assert llm["output"] == {"text": "Hello "}
        assert llm["meta"]["chunks"] == 2
        assert any("LLM stream ✗" in r.getMessage() for r in caplog.records)
        assert not any("LLM stream ✓" in r.getMessage() for r in caplog.records)

    def test_error_before_the_first_chunk_has_no_ttft(self, saved):
        boom = RuntimeError("401")
        client = _client(FakeProvider(fail=("stream", boom, 0)))
        _start()
        with pytest.raises(RuntimeError, match="401"):
            list(client.generate_stream("q?", "sys"))
        llm = _only(_finish(saved), "llm")
        assert llm["status"] == "error"
        assert llm["output"] == {"text": ""}
        assert llm["meta"]["chunks"] == 0
        assert "ttft_ms" not in llm["meta"]

    def test_search_stream_records_sources_after_exhaustion(self, saved):
        _start()
        text = "".join(
            _client(FakeProvider()).generate_stream("news?", use_search=True)
        )
        llm = _only(_finish(saved), "llm")
        assert text == "Hello there"
        assert llm["input"]["use_search"] is True
        assert llm["input"]["system_prompt"] == prompts.SYSTEM_PROMPT
        assert llm["meta"]["system_prompt_defaulted"] is True
        assert llm["meta"]["sources"] == [
            {"title": "Wiki", "url": "https://w.org/o"}
        ]

    def test_stream_that_outlives_its_trace_still_delivers(self, saved):
        _start()
        stream = _client(FakeProvider()).generate_stream("q?", "sys")
        assert next(stream) == "Hel"
        spans = _finish(saved)
        assert _only(spans, "llm")["status"] == "unfinished"
        # The turn was flushed; the rest of the answer must still arrive.
        assert list(stream) == ["lo ", "there"]
        assert not tracing.is_active()


class TestImage:
    def test_records_size_and_type_never_the_bytes(self, saved):
        provider = FakeProvider()
        _start()
        rendered = PromptBuilder.build(IMAGE_TEMPLATE, USER_MESSAGE="a cell")
        result = _client(provider, "LLM_IMAGE_MODEL").generate_image(
            rendered.user_message, aspect="landscape"
        )
        spans = _finish(saved)
        assert result == (IMAGE_BYTES, "image/png", "a diagram")
        assert result[0] is IMAGE_BYTES
        assert provider.calls == [("image", "Draw: a cell", "landscape")]

        llm = _only(spans, "llm")
        prompt = _only(spans, "prompt")
        assert llm["name"] == "unit_image"
        assert llm["prompt_name"] == "unit_image"
        assert llm["prompt_hash"] == prompt["prompt_hash"]
        # An image request carries no system prompt: none is recorded.
        assert llm["input"] == {
            "system_prompt": None,
            "history": [],
            "user_message": "Draw: a cell",
            "aspect": "landscape",
        }
        assert "system_prompt_defaulted" not in llm["meta"]
        assert llm["meta"]["method"] == "generate_image"
        assert llm["meta"]["label"] == "image"
        assert llm["meta"]["config_key"] == "LLM_IMAGE_MODEL"
        assert llm["output"] == {
            "image": {
                "bytes": len(IMAGE_BYTES),
                "mime_type": "image/png",
                "caption": "a diagram",
            }
        }
        dumped = json.dumps(saved)
        assert "raw-image-bytes" not in dumped
        assert "_bytes" not in dumped

    def test_error_is_recorded_and_propagates(self, saved):
        boom = ValueError("OpenAI returned no image data")
        client = _client(FakeProvider(fail=("image", boom)))
        _start()
        with pytest.raises(ValueError, match="no image data") as raised:
            client.generate_image("a cell")
        assert raised.value is boom
        llm = _only(_finish(saved), "llm")
        assert llm["name"] == "image"
        assert llm["status"] == "error"
        assert llm["output"] is None


class TestEmbed:
    def test_query_embedding_records_the_query_variants(self, saved):
        provider = FakeProvider()
        texts = ["what is osmosis", "osmosis definition"]
        _start()
        with tracing.span(tracing.KIND_RETRIEVAL, "retrieve"):
            vectors = _client(provider, "LLM_EMBEDDING_MODEL").embed(
                texts, task_type="RETRIEVAL_QUERY", output_dimensionality=256
            )
        spans = _finish(saved)
        assert vectors == [[VECTOR_VALUE] * 4, [VECTOR_VALUE] * 4]
        assert provider.calls == [("embed", texts, "RETRIEVAL_QUERY", 256)]

        row = _only(spans, "embedding")
        assert row["name"] == "embed"
        assert row["status"] == "ok"
        assert row["provider"] == "fake"
        assert row["model"] == "fake-1"
        assert row["parent_id"] == _only(spans, "retrieval")["id"]
        assert row["input"] == {
            "task_type": "RETRIEVAL_QUERY",
            "count": 2,
            "total_chars": len("what is osmosis") + len("osmosis definition"),
            "dim": 256,
            "texts": texts,
        }
        assert row["output"] == {"vectors": 2}
        assert row["meta"] == {
            "method": "embed",
            "config_key": "LLM_EMBEDDING_MODEL",
        }
        assert _of_kind(spans, "llm") == []
        assert saved["trace"]["llm_calls"] == 0
        assert saved["trace"]["models"] == ["fake-1"]
        assert str(VECTOR_VALUE) not in json.dumps(saved)

    def test_document_embedding_records_sizes_only(self, saved):
        chunks = [f"chunk {i} of the uploaded document" for i in range(150)]
        _start()
        vectors = _client(FakeProvider()).embed(chunks)
        row = _only(_finish(saved), "embedding")
        assert len(vectors) == 150
        assert row["input"] == {
            "task_type": "RETRIEVAL_DOCUMENT",
            "count": 150,
            "total_chars": sum(len(c) for c in chunks),
            "dim": 768,
        }
        assert row["output"] == {"vectors": 150}
        dumped = json.dumps(saved)
        assert "uploaded document" not in dumped
        assert str(VECTOR_VALUE) not in dumped

    def test_error_is_recorded_and_propagates(self, saved, caplog):
        boom = NotImplementedError("GroqProvider does not support embeddings")
        client = _client(FakeProvider(fail=("embed", boom)))
        _start()
        with (
            caplog.at_level(logging.INFO, logger="aeva.llm.llm_client"),
            pytest.raises(NotImplementedError) as raised,
        ):
            client.embed(["q"], task_type="RETRIEVAL_QUERY")
        assert raised.value is boom
        row = _only(_finish(saved), "embedding")
        assert row["status"] == "error"
        assert row["error"].startswith("NotImplementedError: GroqProvider")
        assert row["output"] is None
        assert any("LLM embed ✗" in r.getMessage() for r in caplog.records)


class TestWithoutATrace:
    """With no turn being traced the client is a plain pass-through."""

    def test_methods_return_exactly_what_the_provider_returned(self):
        provider = FakeProvider()
        client = _client(provider)
        assert not tracing.is_active()

        assert (
            client.generate("q", None, [ATTACHMENT], HISTORY) is provider.text
        )
        assert client.generate_structured("q", SCHEMA) is provider.json
        assert list(client.generate_stream("q", "sys", history=HISTORY)) == [
            "Hel",
            "lo ",
            "there",
        ]
        assert (
            client.generate_image("draw", aspect="portrait") == provider.image
        )
        texts = ["a", "b"]
        assert client.embed(texts, task_type="RETRIEVAL_QUERY") == [
            [VECTOR_VALUE] * 4,
            [VECTOR_VALUE] * 4,
        ]
        # The provider saw the caller's arguments untouched (no defaulting).
        assert provider.calls == [
            ("generate", "q", None, [ATTACHMENT], HISTORY),
            ("structured", "q", None, SCHEMA),
            ("stream", "q", "sys", None, HISTORY),
            ("image", "draw", "portrait"),
            ("embed", texts, "RETRIEVAL_QUERY", 768),
        ]
        assert provider.calls[0][4] is HISTORY
        assert provider.calls[4][1] is texts
        assert not tracing.is_active()
        assert tracing.finish_turn() is None

    def test_errors_propagate_unchanged(self):
        for method, call in (
            ("generate", lambda c: c.generate("q")),
            ("structured", lambda c: c.generate_structured("q", SCHEMA)),
            ("image", lambda c: c.generate_image("q")),
            ("embed", lambda c: c.embed(["q"])),
        ):
            boom = RuntimeError(method)
            client = _client(FakeProvider(fail=(method, boom)))
            with pytest.raises(RuntimeError) as raised:
                call(client)
            assert raised.value is boom

        boom = RuntimeError("stream")
        client = _client(FakeProvider(fail=("stream", boom, 1)))
        stream = client.generate_stream("q")
        assert next(stream) == "Hel"
        with pytest.raises(RuntimeError) as raised:
            next(stream)
        assert raised.value is boom

    def test_stream_can_be_closed_early(self):
        stream = _client(FakeProvider()).generate_stream("q")
        assert next(stream) == "Hel"
        stream.close()
        assert list(stream) == []

    def test_results_are_the_same_with_and_without_a_trace(self, saved):
        def run(client):
            return (
                client.generate("q", "sys", use_search=True),
                client.generate_structured("q", SCHEMA, system_prompt="s"),
                list(client.generate_stream("q", history=HISTORY)),
                client.generate_image("draw"),
                client.embed(["a", "b", "c"]),
            )

        plain_provider, traced_provider = FakeProvider(), FakeProvider()
        plain = run(_client(plain_provider))
        _start()
        traced = run(_client(traced_provider))
        spans = _finish(saved)
        assert plain == traced
        assert plain_provider.calls == traced_provider.calls
        assert [(s["kind"], s["name"]) for s in spans[1:]] == [
            ("llm", "generate"),
            ("llm", "structured"),
            ("llm", "stream"),
            ("llm", "image"),
            ("embedding", "embed"),
        ]
        assert all(s["parent_id"] == spans[0]["id"] for s in spans[1:])
        assert all(s["status"] == "ok" for s in spans)
        # The whole payload must be JSON-serialisable as-is.
        json.dumps(saved)


# ------------------------------------------------------------- providers


def _chat_response(content, finish="stop"):
    return SimpleNamespace(
        usage=SimpleNamespace(
            prompt_tokens=11, completion_tokens=4, total_tokens=15
        ),
        choices=[
            SimpleNamespace(
                finish_reason=finish,
                message=SimpleNamespace(content=content),
            )
        ],
    )


def _chat_chunk(content, finish=None):
    return SimpleNamespace(
        usage=None,
        choices=[
            SimpleNamespace(
                finish_reason=finish, delta=SimpleNamespace(content=content)
            )
        ],
    )


class _Endpoint:
    """One fake SDK endpoint: records request kwargs, returns a canned value."""

    def __init__(self, result):
        self.result = result
        self.requests: list[dict] = []

    def __call__(self, **kwargs):
        self.requests.append(kwargs)
        return self.result


def _openai(provider_cls=OpenAIProvider, **endpoints):
    """An OpenAI-SDK provider over fake endpoints, built without Flask."""
    provider = provider_cls.__new__(provider_cls)
    provider.model = "gpt-unit"
    provider.last_sources = []
    provider.max_tokens = 0
    provider.reasoning_effort = ""
    provider.client = SimpleNamespace(
        chat=SimpleNamespace(
            completions=SimpleNamespace(create=endpoints.get("chat"))
        ),
        responses=SimpleNamespace(create=endpoints.get("responses")),
        embeddings=SimpleNamespace(create=endpoints.get("embeddings")),
        images=SimpleNamespace(generate=endpoints.get("images")),
    )
    return provider


def _gemini(**endpoints):
    """A Gemini provider over fake endpoints, built without Flask."""
    provider = GeminiProvider.__new__(GeminiProvider)
    provider.model = "gemini-unit"
    provider.last_sources = []
    provider.client = SimpleNamespace(
        models=SimpleNamespace(
            generate_content=endpoints.get("generate"),
            generate_content_stream=endpoints.get("stream"),
        )
    )
    return provider


def _gemini_response(text, *, tokens, finish=None):
    return SimpleNamespace(
        text=text,
        usage_metadata=SimpleNamespace(
            prompt_token_count=7,
            candidates_token_count=tokens,
            total_token_count=7 + tokens,
        ),
        candidates=[
            SimpleNamespace(
                finish_reason=SimpleNamespace(name=finish) if finish else None,
                grounding_metadata=None,
            )
        ],
    )


class TestProviderUsage:
    """Providers report token usage / finish reason onto the call's span."""

    def test_openai_chat_completion(self, saved):
        chat = _Endpoint(_chat_response("hi there"))
        client = _client(_openai(chat=chat))
        _start()
        assert client.generate("q", "sys") == "hi there"
        llm = _only(_finish(saved), "llm")
        assert llm["provider"] == "openai"
        assert llm["model"] == "gpt-unit"
        assert llm["meta"]["usage"] == {
            "input_tokens": 11,
            "output_tokens": 4,
            "total_tokens": 15,
        }
        assert llm["meta"]["finish_reason"] == "stop"
        # The request itself is what it always was.
        assert sorted(chat.requests[0]) == ["messages", "model"]

    def test_openai_structured_completion(self, saved):
        chat = _Endpoint(_chat_response('{"answer": "42"}', finish="length"))
        client = _client(_openai(chat=chat))
        _start()
        assert client.generate_structured("q", SCHEMA) == {"answer": "42"}
        llm = _only(_finish(saved), "llm")
        assert llm["output"] == {"json": {"answer": "42"}}
        assert llm["meta"]["usage"]["total_tokens"] == 15
        assert llm["meta"]["finish_reason"] == "length"
        assert sorted(chat.requests[0]) == [
            "messages",
            "model",
            "response_format",
        ]

    def test_openai_chat_stream_reports_the_finish_reason(self, saved):
        chat = _Endpoint(
            [
                _chat_chunk("Hel"),
                SimpleNamespace(choices=[], usage=None),
                _chat_chunk("lo"),
                _chat_chunk(None, finish="length"),
            ]
        )
        client = _client(_openai(chat=chat))
        _start()
        assert list(client.generate_stream("q", "sys")) == ["Hel", "lo"]
        llm = _only(_finish(saved), "llm")
        assert llm["output"] == {"text": "Hello"}
        assert llm["meta"]["chunks"] == 2
        assert llm["meta"]["finish_reason"] == "length"
        # No usage was asked for: the vendor request is unchanged.
        assert "usage" not in llm["meta"]
        assert sorted(chat.requests[0]) == ["messages", "model", "stream"]

    def test_openai_search_paths_use_the_responses_usage(self, saved):
        citation = SimpleNamespace(
            type="url_citation", url="https://w.org/o", title="Wiki"
        )
        completed = SimpleNamespace(
            output_text="grounded",
            usage=SimpleNamespace(
                input_tokens=20, output_tokens=6, total_tokens=26
            ),
            output=[
                SimpleNamespace(
                    type="message",
                    content=[SimpleNamespace(annotations=[citation])],
                )
            ],
        )
        sources = [{"title": "Wiki", "url": "https://w.org/o"}]
        usage = {"input_tokens": 20, "output_tokens": 6, "total_tokens": 26}

        _start()
        blocking = _Endpoint(completed)
        client = _client(_openai(responses=blocking))
        assert client.generate("news?", "sys", use_search=True) == "grounded"
        llm = _only(_finish(saved), "llm")
        assert llm["meta"]["usage"] == usage
        assert llm["meta"]["sources"] == sources

        _start()
        streaming = _Endpoint(
            [
                SimpleNamespace(type="response.output_text.delta", delta="gro"),
                SimpleNamespace(type="response.web_search_call.completed"),
                SimpleNamespace(type="response.output_text.delta", delta="und"),
                SimpleNamespace(type="response.completed", response=completed),
            ]
        )
        client = _client(_openai(responses=streaming))
        chunks = list(client.generate_stream("news?", "sys", use_search=True))
        llm = _only(_finish(saved), "llm")
        assert chunks == ["gro", "und"]
        assert client.last_sources == sources
        assert llm["output"] == {"text": "ground"}
        assert llm["meta"]["usage"] == usage
        assert llm["meta"]["sources"] == sources
        assert sorted(streaming.requests[0]) == [
            "input",
            "instructions",
            "model",
            "stream",
            "tool_choice",
            "tools",
        ]

    def test_openai_embeddings_usage_is_summed_over_the_requests(self, saved):
        def response(count):
            return SimpleNamespace(
                usage=SimpleNamespace(prompt_tokens=9, total_tokens=9),
                data=[SimpleNamespace(embedding=[3.0, 4.0])] * count,
            )

        _start()
        one = _Endpoint(response(2))
        vectors = _client(_openai(embeddings=one)).embed(
            ["a", "b"], task_type="RETRIEVAL_QUERY"
        )
        row = _only(_finish(saved), "embedding")
        assert vectors == [[0.6, 0.8], [0.6, 0.8]]
        assert row["meta"]["usage"] == {"input_tokens": 9, "total_tokens": 9}
        assert row["output"] == {"vectors": 2}

        # Several requests: one batch's count would misstate the total.
        _start()
        many = _Endpoint(response(100))
        vectors = _client(_openai(embeddings=many)).embed(["t"] * 101)
        # Nothing is left behind for the rest of the turn.
        assert tracing.state()["llm_trace.embed_usage"] == {}
        row = _only(_finish(saved), "embedding")
        assert len(many.requests) == 2
        assert len(vectors) == 200
        assert row["meta"]["usage"] == {"input_tokens": 18, "total_tokens": 18}

    def test_embeddings_usage_needs_the_embed_span(self, saved):
        response = SimpleNamespace(
            usage=SimpleNamespace(prompt_tokens=9, total_tokens=9),
            data=[SimpleNamespace(embedding=[3.0, 4.0])],
        )
        provider = _openai(embeddings=_Endpoint(response))
        _start()
        # A provider driven directly has no embed span to report onto.
        with tracing.span(tracing.KIND_TOOL, "indexer"):
            assert provider.embed(["a"]) == [[0.6, 0.8]]
        tool = _only(_finish(saved), "tool")
        assert "usage" not in tool["meta"]

    def test_openai_image_usage_without_the_bytes(self, saved):
        images = _Endpoint(
            SimpleNamespace(
                usage=SimpleNamespace(
                    input_tokens=30, output_tokens=1000, total_tokens=1030
                ),
                # base64 of b"image-bytes"
                data=[SimpleNamespace(b64_json="aW1hZ2UtYnl0ZXM=")],
            )
        )
        _start()
        result = _client(_openai(images=images)).generate_image("a cell")
        llm = _only(_finish(saved), "llm")
        assert result == (b"image-bytes", "image/png", "")
        assert llm["meta"]["usage"]["total_tokens"] == 1030
        assert llm["output"] == {
            "image": {"bytes": 11, "mime_type": "image/png", "caption": ""}
        }
        assert "aW1hZ2UtYnl0ZXM" not in json.dumps(saved)

    def test_groq_chat_completion_and_stream(self, saved):
        _start()
        chat = _Endpoint(_chat_response("hi"))
        provider = _openai(GroqProvider, chat=chat)
        provider.max_tokens = 4096
        assert _client(provider).generate("q", "sys") == "hi"
        llm = _only(_finish(saved), "llm")
        assert llm["provider"] == "groq"
        assert llm["meta"]["usage"]["input_tokens"] == 11
        assert llm["meta"]["finish_reason"] == "stop"
        assert sorted(chat.requests[0]) == [
            "max_completion_tokens",
            "messages",
            "model",
        ]

        _start()
        stream = _Endpoint([_chat_chunk("a"), _chat_chunk("b", finish="stop")])
        provider = _openai(GroqProvider, chat=stream)
        assert list(_client(provider).generate_stream("q", "sys")) == ["a", "b"]
        llm = _only(_finish(saved), "llm")
        assert llm["meta"]["finish_reason"] == "stop"
        assert sorted(stream.requests[0]) == [
            "max_completion_tokens",
            "messages",
            "model",
            "stream",
        ]

    def test_gemini_generate_and_stream(self, saved):
        _start()
        generate = _Endpoint(_gemini_response("hi", tokens=3, finish="STOP"))
        client = _client(_gemini(generate=generate))
        assert client.generate("q", "sys") == "hi"
        llm = _only(_finish(saved), "llm")
        assert llm["provider"] == "gemini"
        assert llm["model"] == "gemini-unit"
        assert llm["meta"]["usage"] == {
            "input_tokens": 7,
            "output_tokens": 3,
            "total_tokens": 10,
        }
        assert llm["meta"]["finish_reason"] == "STOP"

        _start()
        structured = _Endpoint(
            _gemini_response('{"answer": "42"}', tokens=5, finish="STOP")
        )
        client = _client(_gemini(generate=structured))
        assert client.generate_structured("q", SCHEMA) == {"answer": "42"}
        llm = _only(_finish(saved), "llm")
        assert llm["output"] == {"json": {"answer": "42"}}
        assert llm["meta"]["usage"]["output_tokens"] == 5

        _start()
        stream = _Endpoint(
            [
                _gemini_response("Hel", tokens=1),
                _gemini_response("lo", tokens=2, finish="MAX_TOKENS"),
            ]
        )
        client = _client(_gemini(stream=stream))
        assert list(client.generate_stream("q", "sys")) == ["Hel", "lo"]
        llm = _only(_finish(saved), "llm")
        assert llm["output"] == {"text": "Hello"}
        # Usage is cumulative across chunks: the last one wins.
        assert llm["meta"]["usage"] == {
            "input_tokens": 7,
            "output_tokens": 2,
            "total_tokens": 9,
        }
        assert llm["meta"]["finish_reason"] == "MAX_TOKENS"

    def test_providers_are_unaffected_without_a_trace(self):
        chat = _Endpoint(_chat_response("hi"))
        assert _openai(chat=chat).generate("q", "sys") == "hi"
        stream = _Endpoint([_chat_chunk("a"), _chat_chunk("b", finish="stop")])
        assert list(_openai(chat=stream).generate_stream("q")) == ["a", "b"]
        generate = _Endpoint(_gemini_response("hi", tokens=3, finish="STOP"))
        assert _gemini(generate=generate).generate("q", "sys") == "hi"
        assert not tracing.is_active()


PDF = {"mime_type": "application/pdf", "data": b"%PDF-secret-bytes"}
PNG = {"mime_type": "image/png", "data": b"\x89PNG"}
ATTACHMENT_NOTE = (
    "\n\n[Note: attached file(s) of type application/pdf are not supported "
    "by this provider and were not included.]"
)
SCHEMA_HINT = (
    "\n\nRespond with a single JSON object that conforms to this JSON "
    "Schema. Output only the JSON object, with no prose and no code "
    f"fences:\n{json.dumps(SCHEMA)}"
)


def _sent(endpoint):
    """(system text, user text) of the one request ``endpoint`` received."""
    (request,) = endpoint.requests
    messages = request["messages"]
    assert messages[0]["role"] == "system"
    content = messages[-1]["content"]
    if isinstance(content, list):
        content = content[0]["text"]
    return messages[0]["content"], content


@pytest.mark.parametrize("provider_cls", [OpenAIProvider, GroqProvider])
class TestProviderAdditions:
    """Text a provider appends to a prompt is kept on the call's span.

    It is part of what the model received but of no template; the span's
    input stays the prompt ``LLMClient`` was given.
    """

    def test_schema_hint_is_recorded_on_the_llm_span(self, saved, provider_cls):
        chat = _Endpoint(_chat_response('{"answer": "42"}'))
        client = _client(_openai(provider_cls, chat=chat))
        _start()
        result = client.generate_structured("q", SCHEMA, system_prompt="sys")
        llm = _only(_finish(saved), "llm")
        assert result == {"answer": "42"}
        (addition,) = llm["meta"]["provider_additions"]
        assert addition == {
            "channel": "system",
            "reason": (
                "This provider has no native response schema, so the schema "
                "is appended to the system prompt as a JSON hint."
            ),
            "chars": len(SCHEMA_HINT),
            "text": SCHEMA_HINT,
        }
        # Recorded prompt + recorded addition = exactly what was sent.
        system, user = _sent(chat)
        assert system == llm["input"]["system_prompt"] + addition["text"]
        assert user == llm["input"]["user_message"] == "q"

    def test_schema_hint_follows_the_default_system_prompt(
        self, saved, provider_cls
    ):
        chat = _Endpoint(_chat_response("{}"))
        _start()
        _client(_openai(provider_cls, chat=chat)).generate_structured(
            "q", SCHEMA
        )
        llm = _only(_finish(saved), "llm")
        (addition,) = llm["meta"]["provider_additions"]
        assert llm["meta"]["system_prompt_defaulted"] is True
        assert llm["input"]["system_prompt"] == prompts.SYSTEM_PROMPT
        assert _sent(chat)[0] == prompts.SYSTEM_PROMPT + addition["text"]

    def test_dropped_attachment_note_is_recorded(self, saved, provider_cls):
        chat = _Endpoint(_chat_response("hi"))
        client = _client(_openai(provider_cls, chat=chat))
        _start()
        assert client.generate("q", "sys", attachments=[PNG, PDF]) == "hi"
        llm = _only(_finish(saved), "llm")
        (addition,) = llm["meta"]["provider_additions"]
        assert addition == {
            "channel": "user",
            "reason": (
                "Non-image attachments cannot be sent to this provider; "
                "they were dropped and this note was appended."
            ),
            "chars": len(ATTACHMENT_NOTE),
            "text": ATTACHMENT_NOTE,
        }
        system, user = _sent(chat)
        assert system == llm["input"]["system_prompt"] == "sys"
        assert user == llm["input"]["user_message"] + addition["text"]
        # The span input still lists both attachments, by type and size.
        assert llm["input"]["attachments"] == [
            {"mime_type": "image/png", "bytes": len(PNG["data"])},
            {"mime_type": "application/pdf", "bytes": len(PDF["data"])},
        ]
        assert "secret-bytes" not in json.dumps(saved)

    def test_stream_records_the_note_once_it_is_consumed(
        self, saved, provider_cls
    ):
        chat = _Endpoint([_chat_chunk("a"), _chat_chunk("b", finish="stop")])
        client = _client(_openai(provider_cls, chat=chat))
        _start()
        chunks = list(client.generate_stream("q", "sys", attachments=[PDF]))
        llm = _only(_finish(saved), "llm")
        assert chunks == ["a", "b"]
        (addition,) = llm["meta"]["provider_additions"]
        assert (addition["channel"], addition["text"]) == (
            "user",
            ATTACHMENT_NOTE,
        )
        assert _sent(chat)[1] == "q" + ATTACHMENT_NOTE

    def test_both_additions_in_the_order_they_were_made(
        self, saved, provider_cls
    ):
        chat = _Endpoint(_chat_response("{}"))
        _start()
        _client(_openai(provider_cls, chat=chat)).generate_structured(
            "q", SCHEMA, system_prompt="sys", attachments=[PDF]
        )
        llm = _only(_finish(saved), "llm")
        assert [
            (a["channel"], a["text"]) for a in llm["meta"]["provider_additions"]
        ] == [("system", SCHEMA_HINT), ("user", ATTACHMENT_NOTE)]
        assert _sent(chat) == ("sys" + SCHEMA_HINT, "q" + ATTACHMENT_NOTE)

    def test_nothing_is_recorded_when_nothing_was_added(
        self, saved, provider_cls
    ):
        chat = _Endpoint(_chat_response("hi"))
        _start()
        _client(_openai(provider_cls, chat=chat)).generate(
            "q", "sys", attachments=[PNG]
        )
        llm = _only(_finish(saved), "llm")
        assert "provider_additions" not in llm["meta"]

    def test_the_vendor_request_is_the_same_with_and_without_a_trace(
        self, saved, provider_cls
    ):
        def run():
            structured = _Endpoint(_chat_response('{"answer": "42"}'))
            blocking = _Endpoint(_chat_response("hi"))
            stream = _Endpoint([_chat_chunk("a", finish="stop")])
            results = (
                _client(
                    _openai(provider_cls, chat=structured)
                ).generate_structured(
                    "q", SCHEMA, attachments=[PNG, PDF], history=HISTORY
                ),
                _client(_openai(provider_cls, chat=blocking)).generate(
                    "q", "sys", attachments=[PDF], history=HISTORY
                ),
                list(
                    _client(_openai(provider_cls, chat=stream)).generate_stream(
                        "q", None, [PDF], HISTORY
                    )
                ),
            )
            requests = [
                endpoint.requests for endpoint in (structured, blocking, stream)
            ]
            return results, requests

        plain = run()
        _start()
        traced = run()
        spans = _of_kind(_finish(saved), "llm")
        assert traced == plain
        assert [len(s["meta"]["provider_additions"]) for s in spans] == [
            2,
            1,
            1,
        ]


class TestGeminiHasNoAdditions:
    def test_native_schema_and_files_add_nothing_to_the_prompt(self, saved):
        generate = _Endpoint(_gemini_response('{"answer": "42"}', tokens=5))
        _start()
        _client(_gemini(generate=generate)).generate_structured("q", SCHEMA)
        llm = _only(_finish(saved), "llm")
        assert "provider_additions" not in llm["meta"]
        assert llm["meta"]["usage"]["output_tokens"] == 5


class TestProviderReportsNeverRaise:
    """The one-line reports are safe anywhere, with any argument."""

    class Unprintable:
        def __format__(self, spec):
            raise RuntimeError("no format")

        def __str__(self):
            raise RuntimeError("no str")

    ODD = (None, 5, b"bytes", object(), ["x"], {"k": "v"})

    def _call_all(self):
        for value in self.ODD:
            llm_trace.note_response(value)
            llm_trace.note_embed_response(value)
            llm_trace.note_dropped_attachments(value, value)
            llm_trace.note_dropped_attachments("q", value)
            llm_trace.note_dropped_attachments(value, "q")
        llm_trace.note_schema_hint(None)
        llm_trace.note_schema_hint(self.Unprintable())
        llm_trace.note_schema_hint("")
        llm_trace.note_dropped_attachments("q", "q")
        llm_trace.note_dropped_attachments("q", "unrelated text")

    def test_without_a_trace(self):
        self._call_all()
        llm_trace.note_schema_hint("hint")
        llm_trace.note_dropped_attachments("q", "q [note]")
        assert not tracing.is_active()

    def test_outside_and_inside_an_llm_span(self, saved):
        _start()
        self._call_all()
        llm_trace.note_schema_hint("no llm span here")
        with tracing.llm_call(
            method="m", label="l", provider="p", model="m", user_message="u"
        ):
            self._call_all()
            llm_trace.note_dropped_attachments("q", "q [note]")
        spans = _finish(saved)
        assert "provider_additions" not in spans[0]["meta"]
        # Only text that really follows the caller's own message is kept.
        additions = _only(spans, "llm")["meta"]["provider_additions"]
        assert [(a["channel"], a["text"]) for a in additions] == [
            ("user", " [note]")
        ]


# ------------------------------------------------------------ decorators


class Unit:
    """The smallest client the decorators accept: plain code, same names."""

    model = "unit-1"
    _provider_name = "unit"
    _config_key = "LLM_UNIT"

    def __init__(self, *, error=None, stream=None):
        self.calls: list[tuple] = []
        self.error = error
        self.stream = stream
        self.last_sources = [{"title": "T", "url": "https://t.org"}]

    def _ran(self, *call):
        self.calls.append(call)
        if self.error is not None:
            raise self.error

    @llm_trace.trace_generate
    def generate(
        self,
        user_message,
        system_prompt=None,
        attachments=None,
        history=None,
        use_search=False,  # noqa: FBT002 — mirrors ``LLMClient.generate``.
        *,
        log_label="generate",
    ):
        """Generate text."""
        self._ran("generate", user_message, system_prompt)
        return f"echo:{user_message}"

    @llm_trace.trace_structured
    def generate_structured(
        self, user_message, response_schema, *, system_prompt=None
    ):
        self._ran("structured", user_message, response_schema)
        return {"echo": user_message}

    @llm_trace.trace_image
    def generate_image(self, prompt, *, aspect="square"):
        self._ran("image", prompt, aspect)
        return self.stream

    @llm_trace.trace_stream
    def generate_stream(self, user_message, system_prompt=None):
        self._ran("stream", user_message, system_prompt)
        return self.stream

    @llm_trace.trace_embed
    def embed(self, texts, *, task_type="RETRIEVAL_DOCUMENT", dim=768):
        self._ran("embed", texts, task_type)
        return [[0.5] for _ in texts]


def _inner(events):
    """A generator that reports everything done to it."""
    try:
        events.append("started")
        got = yield "a"
        events.append(("sent", got))
        try:
            yield "b"
        except KeyError as exc:
            events.append(("caught", exc))
            yield "recovered"
        yield "c"
    except GeneratorExit:
        events.append("generator-exit")
        raise
    finally:
        events.append("closed")
    return "the-return-value"


def _drain(stream):
    """Every frame of ``stream`` and the value it returned."""
    frames = []
    while True:
        try:
            frames.append(next(stream))
        except StopIteration as stop:
            return frames, stop.value


class TestDecoratorsAreTransparent:
    def test_methods_keep_their_identity_and_signature(self):
        expected = {
            "generate": [
                "self",
                "user_message",
                "system_prompt",
                "attachments",
                "history",
                "use_search",
                "log_label",
            ],
            "generate_structured": [
                "self",
                "user_message",
                "response_schema",
                "system_prompt",
                "attachments",
                "history",
                "use_search",
                "log_label",
            ],
            "generate_stream": [
                "self",
                "user_message",
                "system_prompt",
                "attachments",
                "history",
                "use_search",
            ],
            "generate_image": ["self", "prompt", "aspect"],
            "embed": ["self", "texts", "task_type", "output_dimensionality"],
        }
        for name, parameters in expected.items():
            method = getattr(LLMClient, name)
            assert method.__name__ == name
            assert method.__qualname__ == f"LLMClient.{name}"
            assert method.__doc__
            assert list(inspect.signature(method).parameters) == parameters
        assert Unit.generate.__doc__ == "Generate text."

    def test_without_a_trace_the_function_is_called_once_untouched(self):
        events: list = []
        inner = _inner(events)
        unit = Unit(stream=inner)
        texts = ["a", "b"]
        assert unit.generate("q", "sys", log_label="x") == "echo:q"
        assert unit.generate_structured("q", SCHEMA) == {"echo": "q"}
        assert unit.embed(texts) == [[0.5], [0.5]]
        # The stream is handed back as it is: no wrapper at all.
        assert unit.generate_stream("q") is inner
        assert unit.generate_image("p") is inner
        assert events == []
        assert unit.calls == [
            ("generate", "q", "sys"),
            ("structured", "q", SCHEMA),
            ("embed", texts, "RETRIEVAL_DOCUMENT"),
            ("stream", "q", None),
            ("image", "p", "square"),
        ]
        assert unit.calls[2][1] is texts

    @pytest.mark.parametrize("traced", [False, True])
    def test_the_functions_exception_propagates_unchanged(self, saved, traced):
        boom = StopIteration("even this one")
        calls = (
            lambda u: u.generate("q"),
            lambda u: u.generate_structured("q", SCHEMA),
            lambda u: u.generate_image("p"),
            lambda u: u.generate_stream("q"),
            lambda u: u.embed(["a"]),
        )
        if traced:
            _start()
        for call in calls:
            unit = Unit(error=boom)
            with pytest.raises(StopIteration) as raised:
                call(unit)
            assert raised.value is boom
            assert len(unit.calls) == 1
        if traced:
            spans = _finish(saved)
            # The stream method failed before there was a stream to record.
            assert [(s["kind"], s["name"], s["status"]) for s in spans[1:]] == [
                ("llm", "generate", "error"),
                ("llm", "structured", "error"),
                ("llm", "image", "error"),
                ("embedding", "embed", "error"),
            ]
            assert all(s["parent_id"] == spans[0]["id"] for s in spans[1:])

    @pytest.mark.parametrize("traced", [False, True])
    def test_wrong_arguments_raise_the_functions_own_type_error(
        self, saved, traced
    ):
        def plain(self, user_message, system_prompt=None):
            return user_message

        if traced:
            _start()
        for decorate in (
            llm_trace.trace_generate,
            llm_trace.trace_structured,
            llm_trace.trace_image,
            llm_trace.trace_stream,
            llm_trace.trace_embed,
        ):
            with pytest.raises(TypeError) as expected:
                plain(Unit())
            with pytest.raises(TypeError) as raised:
                decorate(plain)(Unit())
            assert str(raised.value) == str(expected.value)
        if traced:
            assert len(_finish(saved)) == 1

    def test_a_fault_in_the_bookkeeping_never_reaches_the_caller(self, saved):
        class Unreadable:
            def __str__(self):
                raise RuntimeError("no str")

        class Broken(Unit):
            _config_key = property(lambda self: 1 / 0)
            model = property(lambda self: int("x"))
            _provider_name = property(lambda self: {}["x"])
            last_sources = property(lambda self: 1 / 0)

            def __init__(self, **kwargs):
                self.calls = []
                self.error = None
                self.stream = kwargs.get("stream")

        chunk = Unreadable()
        _start()
        unit = Broken(stream=None)
        assert unit.generate("q", use_search=True) == "echo:q"
        # Not the (bytes, mime, caption) triple the recorder expects.
        assert unit.generate_image("p") is None
        # A one-shot iterator must reach the function unread.
        texts = iter(["a", "b"])
        assert unit.embed(texts) == [[0.5], [0.5]]
        stream = Broken(stream=(c for c in ("a", chunk))).generate_stream("q")
        assert list(stream) == ["a", chunk]
        spans = _finish(saved)
        assert [(s["kind"], s["status"]) for s in spans[1:]] == [
            ("llm", "ok"),
            ("llm", "ok"),
            ("embedding", "ok"),
            ("llm", "ok"),
        ]
        generate, image, embed, streamed = spans[1:]
        assert generate["output"] == {"text": "echo:q"}
        assert generate["meta"]["sources"] == []
        assert generate["model"] == ""
        assert image["output"] is None
        assert embed["input"] == {
            "task_type": "RETRIEVAL_DOCUMENT",
            "count": None,
            "total_chars": None,
            "dim": None,
        }
        assert embed["output"] == {"vectors": 2}
        assert streamed["output"] is None

    def test_the_default_prompt_is_read_when_the_call_is_made(
        self, saved, monkeypatch
    ):
        monkeypatch.setattr(prompts, "SYSTEM_PROMPT", "patched default")
        _start()
        unit = Unit()
        unit.generate("q", "")
        unit.generate("q", "mine")
        first, second = _of_kind(_finish(saved), "llm")
        # An empty prompt is replaced by the provider exactly like None.
        assert first["input"]["system_prompt"] == "patched default"
        assert first["meta"]["system_prompt_defaulted"] is True
        assert second["input"]["system_prompt"] == "mine"
        assert "system_prompt_defaulted" not in second["meta"]
        # The function itself still got what the caller passed.
        assert unit.calls == [("generate", "q", ""), ("generate", "q", "mine")]

    def test_one_shot_iterators_reach_the_function_unread(self, saved):
        seen: dict = {}

        @llm_trace.trace_generate
        def generate(
            self,
            user_message,
            system_prompt=None,
            attachments=None,
            history=None,
        ):
            seen.update(attachments=list(attachments), history=list(history))
            return "ok"

        _start()
        unit = Unit()
        assert (
            generate(unit, "q", "s", iter([ATTACHMENT]), iter(HISTORY)) == "ok"
        )
        llm = _only(_finish(saved), "llm")
        assert seen == {"attachments": [ATTACHMENT], "history": HISTORY}
        # What could not be read without using it up is left out.
        assert llm["input"]["history"] == []
        assert "attachments" not in llm["input"]

    def test_a_full_trace_does_not_change_the_calls(self, saved, monkeypatch):
        monkeypatch.setenv("AI_TRACE_MAX_SPANS", "1")
        events: list = []
        _start()
        unit = Unit(stream=_inner(events))
        assert unit.generate("q") == "echo:q"
        assert unit.embed(["a"]) == [[0.5]]
        assert _drain(unit.generate_stream("q")) == (
            ["a", "b", "c"],
            "the-return-value",
        )
        spans = _finish(saved)
        assert len(spans) == 1
        assert saved["trace"]["meta"]["dropped_spans"] == 3


class TestStreamWrapper:
    """The wrapped stream behaves like the stream: frames, value, controls."""

    @pytest.mark.parametrize("traced", [False, True])
    def test_frames_and_return_value_are_preserved(self, saved, traced):
        events: list = []
        if traced:
            _start()
        stream = Unit(stream=_inner(events)).generate_stream("q", "sys")
        assert inspect.isgenerator(stream)
        assert events == []
        assert _drain(stream) == (["a", "b", "c"], "the-return-value")
        assert events == ["started", ("sent", None), "closed"]
        if traced:
            llm = _only(_finish(saved), "llm")
            assert llm["status"] == "ok"
            assert llm["output"] == {"text": "abc"}
            assert llm["meta"]["chunks"] == 3

    @pytest.mark.parametrize("traced", [False, True])
    def test_send_reaches_the_stream(self, saved, traced):
        events: list = []
        if traced:
            _start()
        stream = Unit(stream=_inner(events)).generate_stream("q", "sys")
        assert next(stream) == "a"
        assert stream.send("hello") == "b"
        assert ("sent", "hello") in events
        assert _drain(stream) == (["c"], "the-return-value")
        if traced:
            llm = _only(_finish(saved), "llm")
            assert llm["output"] == {"text": "abc"}

    @pytest.mark.parametrize("traced", [False, True])
    def test_throw_reaches_the_streams_own_handler(self, saved, traced):
        events: list = []
        thrown = KeyError("consumer")
        if traced:
            _start()
        stream = Unit(stream=_inner(events)).generate_stream("q", "sys")
        assert [next(stream), next(stream)] == ["a", "b"]
        # The stream catches it and carries on; so does the wrapper.
        assert stream.throw(thrown) == "recovered"
        assert ("caught", thrown) in events
        assert _drain(stream) == (["c"], "the-return-value")
        if traced:
            llm = _only(_finish(saved), "llm")
            assert llm["status"] == "ok"
            assert llm["output"] == {"text": "abrecoveredc"}
            assert llm["meta"]["chunks"] == 4

    @pytest.mark.parametrize("traced", [False, True])
    def test_an_unhandled_throw_propagates_unchanged(self, saved, traced):
        events: list = []
        thrown = ValueError("consumer")
        if traced:
            _start()
        stream = Unit(stream=_inner(events)).generate_stream("q", "sys")
        assert next(stream) == "a"
        with pytest.raises(ValueError, match="consumer") as raised:
            stream.throw(thrown)
        assert raised.value is thrown
        assert events == ["started", "closed"]
        assert list(stream) == []
        if traced:
            tracing.event(tracing.KIND_DECISION, "after")
            spans = _finish(saved)
            llm = _only(spans, "llm")
            assert llm["status"] == "error"
            assert llm["error"] == "ValueError: consumer"
            assert llm["output"] == {"text": "a"}
            assert _only(spans, "decision")["parent_id"] == spans[0]["id"]

    @pytest.mark.parametrize("traced", [False, True])
    def test_close_closes_the_stream(self, saved, traced):
        events: list = []
        if traced:
            _start()
        stream = Unit(stream=_inner(events)).generate_stream("q", "sys")
        assert next(stream) == "a"
        stream.close()
        assert events == ["started", "generator-exit", "closed"]
        assert list(stream) == []
        if traced:
            llm = _only(_finish(saved), "llm")
            assert llm["status"] == "aborted"
            assert llm["output"] == {"text": "a"}

    @pytest.mark.parametrize("traced", [False, True])
    def test_a_stream_nobody_iterates_is_never_started(self, saved, traced):
        events: list = []
        if traced:
            _start()
        stream = Unit(stream=_inner(events)).generate_stream("q", "sys")
        stream.close()
        assert list(stream) == []
        assert events == []
        if traced:
            assert _of_kind(_finish(saved), "llm") == []

    def test_something_that_is_not_a_generator_is_returned_as_it_is(
        self, saved
    ):
        frames = ["a", "b"]
        _start()
        assert Unit(stream=frames).generate_stream("q") is frames
        assert _of_kind(_finish(saved), "llm") == []

    def test_thrown_exception_reaches_the_clients_own_error_log(
        self, saved, caplog
    ):
        thrown = ValueError("consumer")
        _start()
        stream = _client(FakeProvider()).generate_stream("q", "sys")
        assert next(stream) == "Hel"
        with (
            caplog.at_level(logging.INFO, logger="aeva.llm.llm_client"),
            pytest.raises(ValueError, match="consumer") as raised,
        ):
            stream.throw(thrown)
        assert raised.value is thrown
        # ``LLMClient`` logs a failed stream; a wrapper that swallowed the
        # throw would have hidden it from that handler.
        assert any("LLM stream ✗" in r.getMessage() for r in caplog.records)
        llm = _only(_finish(saved), "llm")
        assert llm["status"] == "error"
        assert llm["output"] == {"text": "Hel"}
