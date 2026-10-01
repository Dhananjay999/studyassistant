"""Execution tracing core: recording, nesting, thread hops, flush, safety."""

import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from aeva import tracing
from aeva.llm.prompts.builder import PromptBuilder, PromptTemplate
from aeva.tracing import recorder, store
from aeva.tracing.sanitize import Sanitizer, cap_field


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    """Each test starts unbound, with storage 'available' and captured."""
    recorder._BINDING.set(None)
    monkeypatch.setattr(store, "_unavailable_until", 0.0)
    monkeypatch.setattr(store, "_known_prompt_versions", set())
    for key in (
        "AI_TRACE_ENABLED",
        "AI_TRACE_SCOPE",
        "AI_TRACE_SAMPLE_RATE",
        "AI_TRACE_MAX_FIELD_CHARS",
        "AI_TRACE_MAX_SPANS",
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


USER = "22222222-2222-2222-2222-222222222222"
SESSION = "11111111-1111-1111-1111-111111111111"


def _start(**kwargs):
    return tracing.start_turn(
        user_id=USER, message="what is osmosis?", endpoint="stream", **kwargs
    )


def _by_name(spans, name):
    return next(s for s in spans if s["name"] == name)


TEMPLATE = PromptTemplate(
    name="unit_prompt",
    system="{SYSTEM_PROMPT}{USER_PROFILE}",
    user="Question: {USER_MESSAGE}",
    defaults={"SYSTEM_PROMPT": "You are a tutor."},
    optional=("USER_PROFILE",),
)


class TestInactive:
    def test_everything_is_a_noop_without_a_turn(self):
        assert not tracing.is_active()
        assert tracing.trace_id() is None
        with tracing.span(tracing.KIND_TOOL, "general", input={"a": 1}) as sp:
            sp.set(output="x", meta={"k": "v"})
            assert sp.id is None
            assert not sp.active
        assert tracing.event(tracing.KIND_DECISION, "d") is None
        tracing.current().set(meta={"k": 1})
        tracing.annotate(status="completed")
        tracing.record_prompt(TEMPLATE, {}, SimpleNamespace())
        tracing.note_llm_response(object())
        assert tracing.finish_turn() is None

    def test_disabled_by_config(self, monkeypatch, saved):
        monkeypatch.setenv("AI_TRACE_ENABLED", "false")
        assert _start() is None
        assert not tracing.is_active()

    def test_sample_rate_zero_records_nothing(self, monkeypatch):
        monkeypatch.setenv("AI_TRACE_SAMPLE_RATE", "0")
        assert _start() is None

    def test_bad_config_disables_instead_of_raising(self, monkeypatch):
        monkeypatch.setenv("AI_TRACE_SAMPLE_RATE", "lots")
        assert _start() is None


class TestNesting:
    def test_spans_nest_and_keep_order(self, saved):
        trace_id = _start(input={"message": "hi"})
        assert trace_id
        assert tracing.trace_id() == trace_id
        with tracing.span(tracing.KIND_ROUTER, "route") as router:
            tracing.event(
                tracing.KIND_DECISION, "web_upgrade", output={"to": "web"}
            )
            router.set(output={"source": "planner"})
        with (
            tracing.span(tracing.KIND_TOOL, "general", input={"q": "x"}),
            tracing.span(
                tracing.KIND_LLM, "stream", provider="openai", model="gpt-x"
            ) as llm,
        ):
            llm.set(output={"text": "answer"})
        tracing.annotate(
            status=tracing.TRACE_COMPLETED,
            plan_source="planner",
            session_id=SESSION,
            is_debug_user=False,
        )
        assert tracing.finish_turn(output={"answer": "answer"}) == trace_id
        assert not tracing.is_active()

        spans = saved["spans"]
        root = spans[0]
        assert root["kind"] == "turn"
        assert root["parent_id"] is None
        assert root["status"] == "ok"
        assert root["output"] == {"answer": "answer"}
        assert [s["seq"] for s in spans] == list(range(len(spans)))

        router_row = _by_name(spans, "route")
        decision = _by_name(spans, "web_upgrade")
        tool = _by_name(spans, "general")
        llm_row = _by_name(spans, "stream")
        assert router_row["parent_id"] == root["id"]
        assert decision["parent_id"] == router_row["id"]
        assert tool["parent_id"] == root["id"]
        assert llm_row["parent_id"] == tool["id"]
        assert llm_row["provider"] == "openai"
        assert llm_row["model"] == "gpt-x"
        assert all(s["trace_id"] == trace_id for s in spans)
        assert all(s["duration_ms"] is not None for s in spans)

        trace = saved["trace"]
        assert trace["status"] == "completed"
        assert trace["plan_source"] == "planner"
        assert trace["session_id"] == SESSION
        assert trace["user_id"] == USER
        assert trace["tools"] == ["general"]
        assert trace["models"] == ["gpt-x"]
        assert trace["llm_calls"] == 1
        assert trace["span_count"] == len(spans)
        assert trace["query"] == "what is osmosis?"
        assert trace["meta"] == {"is_debug_user": False}
        # The whole payload must be JSON-serialisable as-is.
        json.dumps(saved)

    def test_exception_marks_span_error_and_propagates(self, saved):
        _start()
        with (
            pytest.raises(ValueError, match="boom"),
            tracing.span(tracing.KIND_TOOL, "quiz_generator"),
        ):
            raise ValueError("boom")
        # The binding is restored to the root after the failure.
        tracing.event(tracing.KIND_DECISION, "after")
        tracing.finish_turn()
        failed = _by_name(saved["spans"], "quiz_generator")
        assert failed["status"] == "error"
        assert failed["error"] == "ValueError: boom"
        after = _by_name(saved["spans"], "after")
        assert after["parent_id"] == saved["spans"][0]["id"]

    def test_generator_closed_early_is_aborted(self, saved):
        _start()

        def stream():
            with tracing.span(tracing.KIND_LLM, "stream") as sp:
                try:
                    yield "a"
                    yield "b"
                finally:
                    sp.set(output={"text": "a"})

        gen = stream()
        assert next(gen) == "a"
        gen.close()
        tracing.finish_turn()
        row = _by_name(saved["spans"], "stream")
        assert row["status"] == "aborted"
        assert row["output"] == {"text": "a"}

    def test_open_span_at_flush_is_unfinished(self, saved):
        _start()

        def stream():
            with tracing.span(tracing.KIND_LLM, "never_resumed"):
                yield "a"

        gen = stream()
        next(gen)
        tracing.finish_turn()
        row = _by_name(saved["spans"], "never_resumed")
        assert row["status"] == "unfinished"
        assert row["duration_ms"] is not None
        # Closing the generator after the flush must not re-bind the trace.
        gen.close()
        assert not tracing.is_active()

    def test_span_cap_drops_and_counts(self, monkeypatch, saved):
        monkeypatch.setenv("AI_TRACE_MAX_SPANS", "3")
        _start()
        for index in range(5):
            tracing.event(tracing.KIND_DECISION, f"d{index}")
        with tracing.span(tracing.KIND_TOOL, "dropped") as sp:
            assert not sp.active
        tracing.finish_turn()
        assert len(saved["spans"]) == 3
        assert saved["trace"]["meta"]["dropped_spans"] == 4


class TestThreads:
    def test_worker_does_not_inherit_without_bound(self, saved):
        _start()
        seen: list[bool] = []
        with ThreadPoolExecutor(max_workers=1) as pool:
            pool.submit(lambda: seen.append(tracing.is_active())).result()
        assert seen == [False]
        tracing.finish_turn()

    def test_bound_attaches_worker_spans_to_the_captured_parent(self, saved):
        _start()
        with tracing.span(tracing.KIND_TOOL, "answer"):
            handle = tracing.capture()

        def work(name: str) -> None:
            with (
                tracing.bound(handle),
                tracing.span(tracing.KIND_TOOL, name),
            ):
                tracing.event(tracing.KIND_DECISION, f"{name}.inner")
            # Pool threads are reused: nothing may stay bound.
            assert not tracing.is_active()

        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(work, ["gen1", "gen2"]))
        tracing.finish_turn()
        spans = saved["spans"]
        answer = _by_name(spans, "answer")
        for name in ("gen1", "gen2"):
            worker = _by_name(spans, name)
            inner = _by_name(spans, f"{name}.inner")
            assert worker["parent_id"] == answer["id"]
            assert inner["parent_id"] == worker["id"]
        assert len({s["id"] for s in spans}) == len(spans)
        assert sorted(s["seq"] for s in spans) == list(range(len(spans)))

    def test_late_worker_span_after_flush_is_dropped(self, saved):
        _start()
        handle = tracing.capture()
        release = threading.Event()
        done = threading.Event()

        def late() -> None:
            with tracing.bound(handle):
                with tracing.span(tracing.KIND_TOOL, "slow") as sp:
                    release.wait(2)
                    sp.set(output={"late": True})
                tracing.event(tracing.KIND_DECISION, "after_flush")
            done.set()

        thread = threading.Thread(target=late)
        thread.start()
        time.sleep(0.05)
        tracing.finish_turn()
        release.set()
        assert done.wait(2)
        thread.join()
        names = [s["name"] for s in saved["spans"]]
        assert "slow" in names
        assert "after_flush" not in names
        slow = _by_name(saved["spans"], "slow")
        assert slow["status"] == "unfinished"
        assert slow["output"] is None


class TestPromptLinking:
    def test_build_records_prompt_and_llm_call_names_it(self, saved):
        _start()
        rendered = PromptBuilder.build(TEMPLATE, USER_MESSAGE="why?")
        with tracing.llm_call(
            method="generate_stream",
            label="stream",
            provider="openai",
            model="gpt-x",
            config_key="LLM_WEB_SEARCH_MODEL",
            user_message=rendered.user_message,
            system_prompt=rendered.system_prompt,
            history=[{"role": "user", "content": "hi", "tool": "general"}],
            attachments=[{"mime_type": "image/png", "data": b"\x89PNG" * 10}],
        ) as sp:
            sp.set(output={"text": "because"})
        tracing.finish_turn()

        prompt = next(s for s in saved["spans"] if s["kind"] == "prompt")
        llm = next(s for s in saved["spans"] if s["kind"] == "llm")
        assert prompt["name"] == "unit_prompt"
        assert prompt["prompt_hash"] == tracing.template_hash(TEMPLATE)
        assert prompt["input"] == {"values": {"USER_MESSAGE": "why?"}}
        assert prompt["meta"]["blocks"] == ["SYSTEM_PROMPT"]
        assert llm["name"] == "unit_prompt"
        assert llm["prompt_name"] == "unit_prompt"
        assert llm["prompt_hash"] == prompt["prompt_hash"]
        assert llm["meta"]["prompt_span_id"] == prompt["id"]
        assert llm["input"]["system_prompt"] == "You are a tutor."
        assert llm["input"]["user_message"] == "Question: why?"
        assert llm["input"]["history"] == [{"role": "user", "content": "hi"}]
        assert llm["input"]["attachments"] == [
            {"mime_type": "image/png", "bytes": 40}
        ]
        assert saved["trace"]["prompt_names"] == ["unit_prompt"]
        assert saved["prompts"] == [
            {
                "name": "unit_prompt",
                "hash": prompt["prompt_hash"],
                "system_template": "{SYSTEM_PROMPT}{USER_PROFILE}",
                "user_template": "Question: {USER_MESSAGE}",
                "defaults": {"SYSTEM_PROMPT": "You are a tutor."},
                "git_sha": None,
            }
        ]

    def test_prompt_span_shows_how_the_prompt_was_assembled(self, saved):
        template = PromptTemplate(
            name="composed",
            system="{SYSTEM_PROMPT}{TEACHING}{USER_PROFILE}",
            user="Date: {CURRENT_DATE}\n{SEARCH_MODE}{CONVERSATION_CONTEXT}"
            "Q: {USER_MESSAGE}{PLANNER_NOTE}",
            defaults={"SYSTEM_PROMPT": "You are a tutor.", "TEACHING": "T!"},
            optional=("USER_PROFILE", "SEARCH_MODE", "PLANNER_NOTE"),
            markers=("CONVERSATION_CONTEXT",),
        )
        _start()
        PromptBuilder.build(
            template,
            USER_PROFILE="\n\nStudent's name: Asha",
            CURRENT_DATE="2026-09-30",
            USER_MESSAGE="why?",
            PLANNER_NOTE="",
        )
        tracing.finish_turn()
        prompt = next(s for s in saved["spans"] if s["kind"] == "prompt")
        segments = prompt["meta"]["segments"]
        assert [
            (s["channel"], s["kind"], s.get("name"), s["chars"])
            for s in segments
        ] == [
            # system channel: two shared blocks, then the user-detail part
            ("system", "block", "SYSTEM_PROMPT", 16),
            ("system", "block", "TEACHING", 2),
            ("system", "value", "USER_PROFILE", 22),
            # user channel, in template order
            ("user", "text", None, 6),
            ("user", "value", "CURRENT_DATE", 10),
            ("user", "text", None, 1),
            # optional part not added this turn
            ("user", "optional", "SEARCH_MODE", 0),
            ("user", "marker", "CONVERSATION_CONTEXT", 0),
            ("user", "text", None, 3),
            ("user", "value", "USER_MESSAGE", 4),
            # supplied but empty: a conditional part that added nothing
            ("user", "value", "PLANNER_NOTE", 0),
        ]
        # The offsets slice each part's exact text out of what was sent.
        sent = {
            "system": "You are a tutor.T!\n\nStudent's name: Asha",
            "user": "Date: 2026-09-30\nQ: why?",
        }
        texts = [sent[s["channel"]][s["start"] : s["end"]] for s in segments]
        assert texts == [
            "You are a tutor.",
            "T!",
            "\n\nStudent's name: Asha",
            "Date: ",
            "2026-09-30",
            "\n",
            "",
            "",
            "Q: ",
            "why?",
            "",
        ]
        for channel, text in sent.items():
            assert (
                "".join(
                    text[s["start"] : s["end"]]
                    for s in segments
                    if s["channel"] == channel
                )
                == text
            )

    def test_block_with_its_own_placeholders_lists_its_parts(self, saved):
        template = PromptTemplate(
            name="nested",
            system="",
            user="{RESULTS}\nNow analyse.",
            defaults={"RESULTS": "Quiz: {QUIZ_DATA}{NOTE}!"},
            optional=("NOTE",),
        )
        _start()
        rendered = PromptBuilder.build(template, QUIZ_DATA="3 questions")
        tracing.finish_turn()
        prompt = next(s for s in saved["spans"] if s["kind"] == "prompt")
        block = prompt["meta"]["segments"][0]
        assert (block["kind"], block["name"]) == ("block", "RESULTS")
        text = rendered.user_message
        assert text[block["start"] : block["end"]] == "Quiz: 3 questions!"
        assert [
            (p["kind"], p.get("name"), text[p["start"] : p["end"]])
            for p in block["parts"]
        ] == [
            ("text", None, "Quiz: "),
            ("value", "QUIZ_DATA", "3 questions"),
            ("optional", "NOTE", ""),
            ("text", None, "!"),
        ]

    def test_every_real_template_is_reproduced_exactly(self, saved):
        """Offsets are only kept when the expansion matches the builder."""
        from aeva.llm import prompts
        from aeva.tracing.recorder import _PLACEHOLDER_RE

        templates = [
            value
            for value in vars(prompts).values()
            if isinstance(value, PromptTemplate)
        ]
        assert len(templates) >= 10
        _start()
        for template in templates:
            names = set(_PLACEHOLDER_RE.findall(template.system))
            names |= set(_PLACEHOLDER_RE.findall(template.user))
            for block in template.defaults.values():
                names |= set(_PLACEHOLDER_RE.findall(block))
            static = (
                set(template.defaults)
                | set(template.optional)
                | set(template.markers)
            )
            values = {name: f"<{name.lower()}>" for name in names - static}
            rendered = PromptBuilder.build(template, **values)
            sent = {
                "system": rendered.system_prompt,
                "user": rendered.user_message,
            }
        tracing.finish_turn()
        spans = [s for s in saved["spans"] if s["kind"] == "prompt"]
        assert len(spans) == len(templates)
        for span, template in zip(spans, templates, strict=True):
            values = span["input"]["values"]
            rendered = PromptBuilder.build(template, **values)
            sent = {
                "system": rendered.system_prompt,
                "user": rendered.user_message,
            }
            for channel, text in sent.items():
                parts = [
                    s
                    for s in span["meta"]["segments"]
                    if s["channel"] == channel
                ]
                assert all("start" in s for s in parts), template.name
                assert (
                    "".join(text[s["start"] : s["end"]] for s in parts) == text
                ), template.name

    def test_build_output_is_unchanged_by_tracing(self, saved):
        plain = PromptBuilder.build(TEMPLATE, USER_MESSAGE="why?")
        _start()
        traced = PromptBuilder.build(TEMPLATE, USER_MESSAGE="why?")
        tracing.finish_turn()
        assert plain == traced

    def test_unlinked_llm_call_keeps_its_label(self, saved):
        _start()
        with tracing.llm_call(
            method="generate_structured",
            label="rag_rerank",
            provider="openai",
            model="gpt-mini",
            user_message="not from a template",
        ):
            pass
        tracing.finish_turn()
        llm = next(s for s in saved["spans"] if s["kind"] == "llm")
        assert llm["name"] == "rag_rerank"
        assert llm["prompt_name"] is None

    def test_hash_changes_with_template_or_shared_block(self):
        base = tracing.template_hash(TEMPLATE)
        edited_block = PromptTemplate(
            name="unit_prompt",
            system=TEMPLATE.system,
            user=TEMPLATE.user,
            defaults={"SYSTEM_PROMPT": "You are a strict tutor."},
            optional=TEMPLATE.optional,
        )
        edited_body = PromptTemplate(
            name="unit_prompt",
            system=TEMPLATE.system,
            user="Q: {USER_MESSAGE}",
            defaults=dict(TEMPLATE.defaults),
            optional=TEMPLATE.optional,
        )
        assert tracing.template_hash(TEMPLATE) == base
        assert tracing.template_hash(edited_block) != base
        assert tracing.template_hash(edited_body) != base


class TestUsage:
    def test_openai_and_gemini_shapes(self, saved):
        _start()
        with tracing.span(tracing.KIND_LLM, "openai"):
            tracing.note_llm_response(
                SimpleNamespace(
                    usage=SimpleNamespace(
                        prompt_tokens=10, completion_tokens=5, total_tokens=15
                    ),
                    choices=[SimpleNamespace(finish_reason="stop")],
                )
            )
        with tracing.span(tracing.KIND_LLM, "gemini"):
            tracing.note_llm_response(
                SimpleNamespace(
                    usage_metadata=SimpleNamespace(
                        prompt_token_count=7,
                        candidates_token_count=3,
                        total_token_count=10,
                    ),
                    candidates=[
                        SimpleNamespace(
                            finish_reason=SimpleNamespace(name="STOP")
                        )
                    ],
                )
            )
        with tracing.span(tracing.KIND_TOOL, "not_llm"):
            tracing.note_llm_response(
                SimpleNamespace(usage=SimpleNamespace(total_tokens=1))
            )
        with tracing.span(tracing.KIND_LLM, "mock"):
            tracing.note_llm_response(MagicMock())
        tracing.finish_turn()
        spans = saved["spans"]
        assert _by_name(spans, "openai")["meta"] == {
            "usage": {
                "input_tokens": 10,
                "output_tokens": 5,
                "total_tokens": 15,
            },
            "finish_reason": "stop",
        }
        assert _by_name(spans, "gemini")["meta"] == {
            "usage": {
                "input_tokens": 7,
                "output_tokens": 3,
                "total_tokens": 10,
            },
            "finish_reason": "STOP",
        }
        assert _by_name(spans, "not_llm")["meta"] == {}
        assert _by_name(spans, "mock")["meta"] == {}


class TestSanitize:
    def test_bytes_nul_and_non_finite_never_reach_json(self):
        cleaner = Sanitizer(1000)
        out = cleaner.value(
            {
                "data": b"abc",
                "text": "a\x00b",
                "bad": "\ud800x",
                "nan": float("nan"),
                "nested": [1, 2.5, True, None, ("t",)],
                1: "int key",
            }
        )
        assert out["data"] == {"_bytes": 3}
        assert out["text"] == "ab"
        assert out["nan"] == "nan"
        assert out["nested"] == [1, 2.5, True, None, ["t"]]
        assert out["1"] == "int key"
        json.dumps(out).encode("utf-8")
        assert not cleaner.truncated

    def test_long_strings_are_cut_and_flagged(self):
        cleaner = Sanitizer(300)
        out = cleaner.value("x" * 500)
        assert out.startswith("x" * 300)
        assert out.endswith("[truncated 200 chars]")
        assert cleaner.truncated

    def test_truncation_is_flagged_on_the_span(self, monkeypatch, saved):
        monkeypatch.setenv("AI_TRACE_MAX_FIELD_CHARS", "300")
        _start()
        with tracing.span(tracing.KIND_TOOL, "big", input={"q": "y" * 900}):
            pass
        tracing.finish_turn()
        row = _by_name(saved["spans"], "big")
        assert row["meta"]["truncated"] is True
        assert len(row["input"]["q"]) < 400

    def test_cap_field_replaces_oversized_payloads(self):
        value, capped = cap_field({"a": "z" * 5000}, 1000)
        assert capped
        assert value["_truncated"] is True
        assert value["_chars"] > 5000
        small, capped_small = cap_field({"a": 1}, 1000)
        assert small == {"a": 1}
        assert not capped_small

    def test_snapshot_is_taken_at_record_time(self, saved):
        _start()
        plan = {"action": "clarify", "steps": []}
        tracing.event(tracing.KIND_DECISION, "raw_plan", output=plan)
        plan["action"] = "run_tool"
        plan["steps"].append({"tool": "general"})
        tracing.finish_turn()
        assert _by_name(saved["spans"], "raw_plan")["output"] == {
            "action": "clarify",
            "steps": [],
        }


class TestLifecycle:
    def test_finish_is_idempotent_and_unbinds(self, saved):
        trace_id = _start()
        assert tracing.finish_turn() == trace_id
        assert tracing.finish_turn() is None
        assert not tracing.is_active()

    def test_failed_and_aborted_status(self, saved):
        _start()
        tracing.fail_turn(RuntimeError("llm down"))
        tracing.finish_turn()
        assert saved["trace"]["status"] == "error"
        assert saved["trace"]["error"] == "RuntimeError: llm down"
        assert saved["spans"][0]["status"] == "error"

        _start()
        tracing.abort_turn()
        tracing.finish_turn()
        assert saved["trace"]["status"] == "aborted"
        assert saved["spans"][0]["status"] == "aborted"

    def test_abort_does_not_override_a_finished_turn(self, saved):
        _start()
        tracing.annotate(status=tracing.TRACE_COMPLETED)
        tracing.abort_turn()
        tracing.finish_turn()
        assert saved["trace"]["status"] == "completed"

    def test_debug_users_scope_discards_other_users(self, monkeypatch, saved):
        monkeypatch.setenv("AI_TRACE_SCOPE", "debug_users")
        _start()
        tracing.annotate(is_debug_user=False)
        assert tracing.finish_turn() is None
        assert saved == {}

        trace_id = _start()
        tracing.annotate(is_debug_user=True)
        assert tracing.finish_turn() == trace_id
        assert saved["trace"]["id"] == trace_id

    def test_new_turn_replaces_a_stale_binding(self, saved):
        first = _start()
        second = _start()
        assert first != second
        assert tracing.trace_id() == second
        tracing.finish_turn()
        assert saved["trace"]["id"] == second

    def test_discard_writes_nothing(self, saved):
        _start()
        tracing.discard_turn()
        assert not tracing.is_active()
        assert tracing.finish_turn() is None
        assert saved == {}

    def test_flush_failure_never_raises(self, monkeypatch):
        def boom(*_args):
            raise RuntimeError("db down")

        monkeypatch.setattr(store, "persist", boom)
        _start()
        assert tracing.finish_turn() is None
        assert not tracing.is_active()


class _Table:
    def __init__(self, client, name):
        self._client = client
        self._name = name

    def insert(self, rows, **kwargs):
        self._client.calls.append(("insert", self._name, rows))
        self._client.options.append(kwargs)
        return self

    def upsert(self, rows, **kwargs):
        self._client.calls.append(("upsert", self._name, rows, kwargs))
        self._client.options.append(kwargs)
        return self

    def execute(self):
        error = self._client.errors.get(self._name)
        if error is not None:
            raise error
        return SimpleNamespace(data=[])


class _Client:
    def __init__(self, errors=None):
        self.calls: list = []
        self.options: list = []
        self.errors = errors or {}

    def table(self, name):
        return _Table(self, name)


def _patch_client(monkeypatch, client):
    import aeva.supabase.supabase_service as svc

    monkeypatch.setattr(
        svc.SupabaseService, "client", property(lambda _self: client)
    )


class TestStore:
    def test_writes_trace_then_spans_then_new_prompt_versions(
        self, monkeypatch
    ):
        client = _Client()
        _patch_client(monkeypatch, client)
        prompt = {"name": "p", "hash": "h"}
        spans = [{"id": str(i), "input": "x"} for i in range(90)]
        assert store.persist({"id": "t1"}, spans, [prompt])
        assert client.calls[0] == ("insert", "ai_traces", {"id": "t1"})
        span_calls = [c for c in client.calls if c[1] == "ai_trace_spans"]
        assert [len(c[2]) for c in span_calls] == [40, 40, 10]
        assert client.calls[-1][:3] == (
            "upsert",
            "ai_prompt_versions",
            [prompt],
        )
        # Nothing is echoed back: the rows can be megabytes of prompts.
        assert all(
            str(getattr(o["returning"], "value", o["returning"])) == "minimal"
            for o in client.options
        )
        # A version this process already wrote is not sent again.
        client.calls.clear()
        assert store.persist({"id": "t2"}, [], [prompt])
        assert [c[1] for c in client.calls] == ["ai_traces"]

    def test_missing_table_pauses_tracing(self, monkeypatch):
        error = RuntimeError("relation missing")
        error.code = "PGRST205"  # type: ignore[attr-defined]
        client = _Client({"ai_traces": error})
        _patch_client(monkeypatch, client)
        assert store.available()
        assert not store.persist({"id": "t1"}, [{"id": "s"}], [])
        assert [c[1] for c in client.calls] == ["ai_traces"]
        assert not store.available()
        # While paused a new turn records nothing at all.
        assert _start() is None

    def test_other_errors_do_not_pause(self, monkeypatch):
        client = _Client({"ai_traces": RuntimeError("timeout")})
        _patch_client(monkeypatch, client)
        assert not store.persist({"id": "t1"}, [], [])
        assert store.available()

    def test_span_failure_keeps_the_trace(self, monkeypatch):
        client = _Client({"ai_trace_spans": RuntimeError("too big")})
        _patch_client(monkeypatch, client)
        assert store.persist({"id": "t1"}, [{"id": "s"}], [])


class TestRoot:
    def test_root_handle_reaches_the_turn_span_from_nested_code(self, saved):
        _start()
        with tracing.span(tracing.KIND_TOOL, "general"):
            tracing.root().set(output={"tool_used": "general"})
        tracing.finish_turn()
        assert saved["spans"][0]["output"] == {"tool_used": "general"}

    def test_root_is_a_noop_without_a_turn(self):
        tracing.root().set(output={"x": 1})
        assert not tracing.root().active


class TestHardening:
    def test_non_uuid_ids_never_reach_the_uuid_columns(self, saved):
        tracing.start_turn(user_id="not-a-uuid", message="m", endpoint="sync")
        tracing.annotate(
            session_id="nope",
            run_id="also-nope",
            user_message_id=None,
            assistant_message_id=MagicMock(),
        )
        tracing.finish_turn()
        trace = saved["trace"]
        assert trace["user_id"] is None
        assert trace["session_id"] is None
        assert trace["run_id"] is None
        assert trace["user_message_id"] is None
        assert trace["assistant_message_id"] is None

    def test_uuid_ids_are_kept_in_canonical_form(self, saved):
        _start()
        tracing.annotate(run_id=SESSION.upper())
        tracing.finish_turn()
        assert saved["trace"]["run_id"] == SESSION

    def test_debug_scope_stops_recording_for_other_users(
        self, monkeypatch, saved
    ):
        monkeypatch.setenv("AI_TRACE_SCOPE", "debug_users")
        _start()
        assert tracing.trace_id() is not None
        with tracing.span(tracing.KIND_CONTEXT, "load_context"):
            tracing.annotate(is_debug_user=False)
            # Nothing may point at a trace that will not be stored.
            assert tracing.trace_id() is None
            assert not tracing.is_active()
        assert not tracing.is_active()
        assert tracing.finish_turn() is None
        assert saved == {}

    def test_span_closed_out_of_order_does_not_rebind(self, saved):
        _start()
        root_id = tracing.current().id

        def stream():
            with tracing.span(tracing.KIND_LLM, "stream"):
                yield "a"

        with tracing.span(tracing.KIND_TOOL, "general"):
            gen = stream()
            next(gen)
        # The tool span ended while the stream's span was still open: the
        # thread goes back to the tool's parent, not to the open llm span.
        assert tracing.current().id == root_id
        tracing.event(tracing.KIND_DECISION, "after_tool")
        # The stream is finalised late; it must not move the position.
        gen.close()
        assert tracing.current().id == root_id
        tracing.event(tracing.KIND_DECISION, "after_close")
        tracing.finish_turn()
        spans = saved["spans"]
        assert _by_name(spans, "after_tool")["parent_id"] == root_id
        assert _by_name(spans, "after_close")["parent_id"] == root_id
        assert _by_name(spans, "stream")["status"] == "aborted"


class TestProviderAdditions:
    def test_added_text_is_kept_on_the_llm_span_only(self, saved):
        _start()
        tracing.note_prompt_addition("system", "ignored: no llm span", "r")
        with tracing.span(tracing.KIND_LLM, "plan_turn"):
            tracing.note_prompt_addition(
                "system", "\n\nRespond with JSON", "schema hint"
            )
            tracing.note_prompt_addition("user", "", "empty is ignored")
        tracing.finish_turn()
        root, llm = saved["spans"][0], _by_name(saved["spans"], "plan_turn")
        assert "provider_additions" not in root["meta"]
        assert llm["meta"]["provider_additions"] == [
            {
                "channel": "system",
                "reason": "schema hint",
                "chars": 19,
                "text": "\n\nRespond with JSON",
            }
        ]

    def test_noop_without_a_turn(self):
        tracing.note_prompt_addition("system", "x", "y")


class TestBeginEnd:
    def test_begin_nests_without_a_with_block(self, saved):
        _start()
        route = tracing.begin(tracing.KIND_ROUTER, "route", input={"m": 1})
        tracing.event(tracing.KIND_DECISION, "fast_path")
        route.end(output={"source": "fast_path"})
        route.end(output={"source": "ignored: already ended"})
        tracing.event(tracing.KIND_DECISION, "outcome")
        tracing.finish_turn()
        spans = saved["spans"]
        router = _by_name(spans, "route")
        assert router["status"] == "ok"
        assert router["output"] == {"source": "fast_path"}
        assert _by_name(spans, "fast_path")["parent_id"] == router["id"]
        assert _by_name(spans, "outcome")["parent_id"] == spans[0]["id"]

    def test_failed_turn_closes_spans_left_open(self, saved):
        _start()
        tracing.begin(tracing.KIND_ROUTER, "route")
        tracing.begin(tracing.KIND_TOOL, "general")
        tracing.fail_turn(RuntimeError("planner down"))
        # Back at the root: later events do not hang under a dead span.
        tracing.event(tracing.KIND_DECISION, "after")
        tracing.finish_turn()
        spans = saved["spans"]
        for name in ("route", "general"):
            row = _by_name(spans, name)
            assert row["status"] == "error"
            assert row["error"] == "RuntimeError: planner down"
        assert _by_name(spans, "after")["parent_id"] == spans[0]["id"]
        assert saved["trace"]["status"] == "error"

    def test_aborted_turn_closes_spans_left_open(self, saved):
        _start()
        tracing.begin(tracing.KIND_TOOL, "general")
        tracing.abort_turn()
        tracing.finish_turn()
        assert _by_name(saved["spans"], "general")["status"] == "aborted"
        assert saved["trace"]["status"] == "aborted"

    def test_begin_and_end_are_noops_without_a_turn(self):
        handle = tracing.begin(tracing.KIND_TOOL, "general")
        assert not handle.active
        handle.end(output={"x": 1})
        tracing.current().end()


class TestCarryAndState:
    def test_carry_runs_the_function_at_the_captured_position(self, saved):
        _start()
        step = tracing.begin(tracing.KIND_TOOL, "answer")

        def work(name: str) -> str:
            tracing.event(tracing.KIND_DECISION, name)
            return name.upper()

        carried = tracing.carry(work)
        step.end()
        with ThreadPoolExecutor(max_workers=1) as pool:
            assert pool.submit(carried, "inner").result() == "INNER"
            # The pool thread is left unbound afterwards.
            assert pool.submit(tracing.is_active).result() is False
        tracing.finish_turn()
        spans = saved["spans"]
        assert (
            _by_name(spans, "inner")["parent_id"]
            == _by_name(spans, "answer")["id"]
        )

    def test_carry_returns_the_function_itself_without_a_turn(self):
        def work() -> int:
            return 1

        assert tracing.carry(work) is work

    def test_state_is_per_trace(self, saved):
        assert tracing.state() == {}
        tracing.state()["x"] = 1
        assert tracing.state() == {}
        _start()
        tracing.state()["raw_plan"] = {"action": "clarify"}
        assert tracing.state()["raw_plan"] == {"action": "clarify"}
        tracing.finish_turn()
        _start()
        assert tracing.state() == {}
        tracing.finish_turn()


class TestSanitizeHardening:
    def test_deep_schema_is_kept_as_structure(self):
        cleaner = Sanitizer(60_000)
        schema: dict = {"type": "string"}
        for _ in range(8):
            schema = {"type": "object", "properties": {"x": schema}}
        out = cleaner.value({"input": {"response_schema": schema}})
        node = out["input"]["response_schema"]
        for _ in range(8):
            node = node["properties"]["x"]
        assert node == {"type": "string"}
        assert not cleaner.truncated

    def test_signed_url_token_is_redacted(self):
        cleaner = Sanitizer(1000)
        url = "https://x.supabase.co/storage/v1/object/sign/b/p.png"
        out = cleaner.value(
            {"images": [{"url": f"{url}?token=SECRET.JWT-abc&download=1"}]}
        )
        assert out["images"][0]["url"] == (f"{url}?token=[redacted]&download=1")
        assert cleaner.text("no token here") == "no token here"

    def test_slow_database_stops_after_the_time_budget(self, monkeypatch):
        client = _Client()
        _patch_client(monkeypatch, client)
        clock = iter([0.0, 100.0, 100.0, 100.0, 100.0])
        monkeypatch.setattr(store.time, "monotonic", lambda: next(clock))
        spans = [{"id": str(i)} for i in range(90)]
        assert store.persist({"id": "t1"}, spans, [{"name": "p", "hash": "h"}])
        # The trace row went out; no span batch or prompt version followed.
        assert [c[1] for c in client.calls] == ["ai_traces"]

    def test_bare_404_on_insert_counts_as_missing_table(self, monkeypatch):
        error = RuntimeError("JSON could not be generated")
        error.code = 404  # type: ignore[attr-defined]
        client = _Client({"ai_traces": error})
        _patch_client(monkeypatch, client)
        assert not store.persist({"id": "t1"}, [], [])
        assert not store.available()


class TestCoreReviewFixes:
    def test_exception_whose_str_raises_cannot_break_the_turn(self, saved):
        class UnprintableError(Exception):
            def __str__(self) -> str:
                raise RuntimeError("unprintable")

        tracing.fail_turn(UnprintableError())  # no turn: a no-op
        _start()
        with (
            pytest.raises(UnprintableError),
            tracing.span(tracing.KIND_TOOL, "general"),
        ):
            raise UnprintableError
        tracing.event(tracing.KIND_DECISION, "after")
        tracing.fail_turn(UnprintableError())
        tracing.finish_turn()
        spans = saved["spans"]
        tool = _by_name(spans, "general")
        assert tool["status"] == "error"
        assert tool["error"] == "UnprintableError"
        assert _by_name(spans, "after")["parent_id"] == spans[0]["id"]
        assert saved["trace"]["error"] == "UnprintableError"

    @pytest.mark.parametrize(
        "scope", ["debug_user", "debug", " debug-users", "none", ""]
    )
    def test_unknown_scope_fails_closed(self, monkeypatch, saved, scope):
        monkeypatch.setenv("AI_TRACE_SCOPE", scope)
        _start()
        tracing.annotate(is_debug_user=False)
        assert tracing.finish_turn() is None
        assert saved == {}

    def test_scope_is_trimmed_and_case_insensitive(self, monkeypatch, saved):
        monkeypatch.setenv("AI_TRACE_SCOPE", " ALL ")
        trace_id = _start()
        tracing.annotate(is_debug_user=False)
        assert tracing.finish_turn() == trace_id

    def test_bytes_never_leak_through_odd_containers(self):
        from collections import deque
        from types import MappingProxyType

        cleaner = Sanitizer(1000)
        out = cleaner.value(
            {
                "queue": deque([b"raw", 1]),
                "proxy": MappingProxyType({"data": b"raw"}),
                "vector": [0.5] * 768,
                "short": [0.5, 1.5],
            }
        )
        assert out["queue"] == [{"_bytes": 3}, 1]
        assert out["proxy"] == {"data": {"_bytes": 3}}
        assert out["vector"] == [{"_numbers": 768}]
        assert out["short"] == [0.5, 1.5]
        assert "raw" not in json.dumps(out)

    def test_too_deep_value_is_named_not_dumped(self):
        cleaner = Sanitizer(1000)
        value: dict = {"secret": b"bytes"}
        for _ in range(30):
            value = {"n": value}
        dumped = json.dumps(cleaner.value(value))
        assert "_too_deep" in dumped
        assert "bytes" not in dumped.replace("_bytes", "")
        assert cleaner.truncated


class TestErrorBelowAndSecrets:
    def test_error_below_finds_the_failing_child(self, saved):
        _start()
        tool = tracing.begin(tracing.KIND_TOOL, "general")
        assert tracing.error_below(tool) is None
        with (
            pytest.raises(RuntimeError),
            tracing.span(tracing.KIND_LLM, "general_answer"),
        ):
            raise RuntimeError("stream broke")
        assert tracing.error_below(tool) == "RuntimeError: stream broke"
        tool.end()
        # A failure elsewhere in the turn is not this step's.
        other = tracing.begin(tracing.KIND_TOOL, "quiz_generator")
        assert tracing.error_below(other) is None
        other.end()
        tracing.finish_turn()
        assert tracing.error_below(tracing.root()) is None

    def test_key_shaped_text_is_masked_in_errors_and_payloads(self, saved):
        key = "sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX"
        _start()
        tracing.event(
            tracing.KIND_DECISION,
            "leaky",
            output={
                "note": f"Incorrect API key provided: {key}",
                "header": "Authorization: Bearer abcdefghijklmnop.qrstuv",
                "url": "https://api.example/v1?api_key=abcdef123456&x=1",
                "plain": "the key idea of osmosis",
            },
        )
        tracing.fail_turn(RuntimeError(f"401 for key {key}"))
        tracing.finish_turn()
        dumped = json.dumps(saved)
        assert key not in dumped
        assert "abcdefghijklmnop.qrstuv" not in dumped
        assert "abcdef123456" not in dumped
        out = _by_name(saved["spans"], "leaky")["output"]
        assert out["note"] == "Incorrect API key provided: sk-proj[redacted]"
        assert out["url"] == "https://api.example/v1?api_key=[redacted]&x=1"
        assert out["plain"] == "the key idea of osmosis"
        assert saved["trace"]["error"].startswith(
            "RuntimeError: 401 for key sk-"
        )
