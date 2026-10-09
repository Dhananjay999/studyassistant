"""Exam-soon hand-off from chat (R16): detector, gating and the turn result.

No LLM and no database: the detector is regular expressions, the gating is
checked against fakes, and the full turn uses the orchestrator with fake
tools.
"""

import copy
import json
from datetime import date
from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest
from flask import Flask

from aeva.exam_prep.exam_prep_repository import ExamPrepRepository
from aeva.feature_flag import feature_flag_service
from aeva.mcp.base import BaseTool, ToolContext, ToolDefinition
from aeva.mcp.registry import ToolRegistry
from aeva.orchestration import exam_offer
from aeva.orchestration.assistant_orchestrator import AssistantOrchestrator
from aeva.orchestration.models import AssistantContext

# A Friday, so "Monday" is three days away.
TODAY = date(2026, 10, 9)
SESSION = "11111111-1111-1111-1111-111111111111"
USER = "22222222-2222-2222-2222-222222222222"


def detect(message: str) -> dict[str, Any] | None:
    offer = exam_offer.detect(message, TODAY)
    return offer.to_payload() if offer else None


# ---------------------------------------------------------------- detector


class TestDetectsANearExam:
    @pytest.mark.parametrize(
        ("message", "kind"),
        [
            # From the report (users' own words, typos included).
            ("tommorow is my ssst exam", "tomorrow"),
            ("my exam on 10th of October", "date"),
            ("exam for today", "today"),
            ("mon controole est demain", "tomorrow"),
            # From the brief.
            ("exam tomorrow", "tomorrow"),
            ("exam today", "today"),
            ("paper on Monday", "weekday"),
            ("test in 2 days", "in_days"),
            ("exam on 12 Oct", "date"),
            ("kal exam hai", "tomorrow"),
            # Variants.
            ("aaj mera exam hai", "today"),
            ("parso maths ka paper hai", "in_days"),
            ("jee exam day after tomorrow", "in_days"),
            ("my unit test is on the 12th", "date"),
            ("exam on 12/10", "date"),
            ("My bio test is this saturday", "weekday"),
            ("what will come in tomorrow's exam", "tomorrow"),
            ("I have to give my maths test tomorrow", "tomorrow"),
            ("i have not studied anything and my exam is tomorrow", "tomorrow"),
            ("give me the formula sheet, exam is today", "today"),
        ],
    )
    def test_positive(self, message, kind):
        offer = detect(message)
        assert offer is not None, message
        assert offer["date_hint"] == kind

    def test_relative_hints_carry_an_offset_not_a_date(self):
        assert detect("exam today")["days_ahead"] == 0
        assert detect("exam tomorrow")["days_ahead"] == 1
        assert detect("test in 2 days")["days_ahead"] == 2
        assert detect("exam day after tomorrow")["days_ahead"] == 2
        monday = detect("paper on Monday")
        assert monday["weekday"] == 0
        assert monday["days_ahead"] is None
        explicit = detect("exam on 12 Oct")
        assert (explicit["day"], explicit["month"]) == (12, 10)
        assert explicit["days_ahead"] is None

    def test_prefill_from_the_message(self):
        offer = detect("kal mera physics ka exam hai")
        assert offer["exam_name"] == "Physics exam"
        assert offer["subjects"] == ["Physics"]

        offer = detect("I have my class 10 sst board exam tomorrow please help")
        assert offer["exam_name"] == "Social Science board exam"
        assert offer["subjects"] == ["Social Science"]

        offer = detect("tomorrow I have physics and chemistry exam")
        assert offer["subjects"] == ["Physics", "Chemistry"]
        assert offer["exam_name"] is None  # two subjects: the student names it

        assert detect("my unit test is on the 12th")["exam_name"] == "Unit test"
        # A named entrance exam is kept so the client can apply its own rule.
        assert detect("jee exam day after tomorrow")["exam_name"] == "JEE exam"

    def test_nothing_to_prefill_is_still_an_offer(self):
        offer = detect("exam tomorrow")
        assert offer["exam_name"] is None
        assert offer["subjects"] == []


class TestStaysQuiet:
    @pytest.mark.parametrize(
        "message",
        [
            # From the brief.
            "I had an exam last week",
            "exam pattern of JEE",
            # Past.
            "I had a test today",
            "today's exam was hard",
            "exam on monday was tough",
            "I gave my test yesterday",
            "kal exam tha",
            "kal exam ho gaya",
            # Negated.
            "no exam tomorrow",
            "I don't have an exam tomorrow",
            "exam is not tomorrow",
            "kal exam nahi hai",
            # "test" as a verb, or a request for a quiz.
            "test me on chapter 3 tomorrow",
            "can you test my knowledge today",
            "give me a practice test today",
            "make a test for tomorrow",
            # Exam paperwork, not a deadline.
            "what is the exam date for NEET 2026",
            "exam form last date is tomorrow",
            "exam result tomorrow",
            # Not an exam paper.
            "I need to submit my research paper on Monday",
            "solve this sample paper today",
            # Not near.
            "my exam is on 25 December",
            "exam in 20 days",
            # No date, or no exam.
            "explain photosynthesis",
            "what is tomorrow",
            "the day after the exam i am free",
            "",
        ],
    )
    def test_negative(self, message):
        assert detect(message) is None, message

    def test_long_messages_are_not_scanned(self):
        pasted = "exam tomorrow " + "word " * exam_offer.MAX_WORDS
        assert detect(pasted) is None

    def test_exam_and_date_must_be_in_the_same_sentence(self):
        assert detect("I have an exam. Tomorrow I will travel") is None

    def test_window_is_a_week(self):
        assert detect("exam in 7 days") is not None
        assert detect("exam in 8 days") is None

    def test_a_date_that_already_passed_this_year_is_not_near(self):
        # 3 October is before the reference date: next year, so not "soon".
        assert detect("my exam on 3rd of October") is None


# ------------------------------------------------------------------ gating


def _supabase(active_rows: list[dict]) -> MagicMock:
    supabase = MagicMock()
    query = supabase.client.table.return_value.select.return_value
    query.eq.return_value.eq.return_value.limit.return_value.execute.return_value.data = active_rows  # noqa: E501
    return supabase


def _turn(message: str, **overrides: Any) -> SimpleNamespace:
    fields: dict[str, Any] = {
        "message": message,
        "user_id": USER,
        "clarification": None,
        "run_id": None,
        "source_content": None,
        "quiz_options": None,
        "flashcard_options": None,
    }
    fields.update(overrides)
    return SimpleNamespace(**fields)


class TestForTurn:
    @pytest.fixture(autouse=True)
    def _flags(self, monkeypatch):
        self.enabled = True
        monkeypatch.setattr(
            feature_flag_service, "is_enabled", lambda _key: self.enabled
        )

    def test_offer_when_enabled_and_no_active_plan(self):
        supabase = _supabase([])
        offer = exam_offer.for_turn(_turn("exam tomorrow"), supabase)
        assert offer is not None
        assert offer["date_hint"] == "tomorrow"
        supabase.client.table.assert_called_once_with("exam_plans")
        # Only the id of one row is read.
        supabase.client.table.return_value.select.assert_called_once_with("id")

    def test_no_offer_when_a_plan_is_active(self):
        supabase = _supabase([{"id": "plan-1"}])
        assert exam_offer.for_turn(_turn("exam tomorrow"), supabase) is None

    def test_no_offer_and_no_query_when_the_flag_is_off(self):
        self.enabled = False
        supabase = _supabase([])
        assert exam_offer.for_turn(_turn("exam tomorrow"), supabase) is None
        supabase.client.table.assert_not_called()

    def test_ordinary_messages_cost_no_query(self):
        supabase = _supabase([])
        assert exam_offer.for_turn(_turn("explain osmosis"), supabase) is None
        supabase.client.table.assert_not_called()

    @pytest.mark.parametrize(
        "overrides",
        [
            {"clarification": object()},
            {"run_id": "run-1"},
            {"source_content": "an answer that says exam tomorrow"},
            {"quiz_options": object()},
            {"flashcard_options": object()},
        ],
    )
    def test_only_a_typed_message_can_carry_an_offer(self, overrides):
        supabase = _supabase([])
        turn = _turn("exam tomorrow", **overrides)
        assert exam_offer.for_turn(turn, supabase) is None
        supabase.client.table.assert_not_called()

    def test_a_failing_lookup_never_fails_the_turn(self):
        supabase = MagicMock()
        supabase.client.table.side_effect = RuntimeError("db down")
        assert exam_offer.for_turn(_turn("exam tomorrow"), supabase) is None


class TestHasActivePlan:
    def test_reads_one_id_filtered_by_owner_and_status(self):
        supabase = _supabase([{"id": "plan-1"}])
        assert ExamPrepRepository(supabase).has_active_plan(USER) is True
        select = supabase.client.table.return_value.select
        select.assert_called_once_with("id")
        first = select.return_value.eq
        first.assert_called_once_with("user_id", USER)
        first.return_value.eq.assert_called_once_with("status", "active")
        first.return_value.eq.return_value.limit.assert_called_once_with(1)

    def test_false_without_a_row(self):
        assert ExamPrepRepository(_supabase([])).has_active_plan(USER) is False


# ----------------------------------------------------------- the full turn


class _Supabase:
    """The slice of SupabaseService a chat turn touches."""

    def __init__(self, active_plan: bool = False) -> None:
        self.added: list[dict] = []
        self.client = MagicMock()
        query = self.client.table.return_value.select.return_value
        query.eq.return_value.eq.return_value.limit.return_value.execute.return_value.data = (  # noqa: E501
            [{"id": "plan-1"}] if active_plan else []
        )

    def get_session(self, session_id: str, user_id: str) -> dict | None:
        return {"id": SESSION, "title": "Physics", "space_id": None}

    def get_profile(self, user_id: str) -> dict:
        return {"full_name": "Asha"}

    def get_messages(self, session_id: str, limit: int | None = None) -> list:
        return []

    def list_media(self, user_id: str) -> list[dict]:
        return []

    def add_message(
        self,
        session_id: str,
        role: str,
        content: str,
        metadata: dict | None = None,
        user_id: str | None = None,
    ) -> dict:
        row = {
            "id": f"00000000-0000-0000-0000-{len(self.added) + 1:012d}",
            "role": role,
            "content": content,
            "metadata": copy.deepcopy(metadata or {}),
        }
        self.added.append(row)
        return row

    def update_session(self, *_a: Any, **_k: Any) -> None:
        pass

    def update_learning_profile(self, *_a: Any, **_k: Any) -> None:
        pass


class _Planner:
    model = "planner-model"

    def __init__(self, plan: dict) -> None:
        self.plan = plan

    def generate_structured(self, *_a: Any, **_k: Any) -> dict:
        return copy.deepcopy(self.plan)


class _General(BaseTool):
    @property
    def definition(self) -> ToolDefinition:
        return ToolDefinition("general", "general", {"type": "object"})

    def can_stream(self) -> bool:
        return True

    def execute(self, ctx: ToolContext, params: dict[str, Any]) -> dict:
        return {"answer": "Start with kinematics.", "sources": []}

    def execute_stream(self, ctx: ToolContext, params: dict[str, Any]):
        yield "Start with "
        yield "kinematics."
        return {"answer": "Start with kinematics.", "sources": []}


class _Quiz(BaseTool):
    @property
    def definition(self) -> ToolDefinition:
        return ToolDefinition("quiz_generator", "quiz", {"type": "object"})

    def execute(self, ctx: ToolContext, params: dict[str, Any]) -> dict:
        return {"quiz_id": "q1", "title": "Physics", "questions": [1]}


GENERAL_PLAN = {
    "action": "run_tool",
    "steps": [{"tool": "general", "params": {"query": "q"}}],
}


def _orchestrator(supabase: _Supabase, plan: dict) -> AssistantOrchestrator:
    return AssistantOrchestrator(
        llm=_Planner(plan),
        registry=ToolRegistry([_General(), _Quiz()]),
        supabase=supabase,
    )


def _frames(orch: AssistantOrchestrator, message: str) -> list[dict]:
    ctx = AssistantContext(user_id=USER, session_id=SESSION, message=message)
    return [json.loads(f[len("data: "):]) for f in orch.run_stream(ctx)]


class TestOfferRidesTheAnswer:
    @pytest.fixture(autouse=True)
    def _env(self, monkeypatch):
        monkeypatch.setenv("AI_TRACE_ENABLED", "false")
        monkeypatch.setattr(
            feature_flag_service,
            "get_flags",
            lambda: {"web_search": True, "image_generation": True},
        )
        monkeypatch.setattr(
            feature_flag_service, "is_enabled", lambda *_a, **_k: True
        )

    @pytest.fixture
    def app(self):
        app = Flask(__name__)
        app.config.update(
            LLM_WEB_SEARCH_MODEL="answer-model", LLM_FAST_MODEL="fast-model"
        )
        with app.app_context():
            yield app

    def test_the_answer_is_streamed_and_the_offer_is_added_to_it(self, app):
        supabase = _Supabase()
        frames = _frames(
            _orchestrator(supabase, GENERAL_PLAN),
            "my physics exam is tomorrow, what should I revise?",
        )
        done = frames[-1]
        assert done["done"] is True
        # The normal answer is untouched...
        text = "".join(
            f["content"] for f in frames if f.get("content") and not f.get("done")
        )
        assert text == "Start with kinematics."
        assert done["content"]["answer"] == "Start with kinematics."
        # ...and the offer travels beside it, prefilled from the message.
        offer = done["content"]["exam_prep_offer"]
        assert offer["date_hint"] == "tomorrow"
        assert offer["days_ahead"] == 1
        assert offer["exam_name"] == "Physics exam"
        assert offer["subjects"] == ["Physics"]
        # Persisted with the message, so a reloaded chat still shows it.
        saved = supabase.added[-1]
        assert saved["role"] == "assistant"
        assert saved["content"] == "Start with kinematics."
        assert saved["metadata"]["content"]["exam_prep_offer"] == offer

    def test_non_streaming_result_carries_it_too(self, app):
        orch = _orchestrator(_Supabase(), GENERAL_PLAN)
        result = orch.run(
            AssistantContext(
                user_id=USER, session_id=SESSION, message="kal exam hai"
            )
        )
        assert result.content["exam_prep_offer"]["date_hint"] == "tomorrow"
        assert result.display_text == "Start with kinematics."

    def test_no_offer_field_without_a_near_exam(self, app):
        frames = _frames(
            _orchestrator(_Supabase(), GENERAL_PLAN), "explain osmosis"
        )
        assert "exam_prep_offer" not in frames[-1]["content"]

    def test_no_offer_when_the_student_already_has_a_plan(self, app):
        frames = _frames(
            _orchestrator(_Supabase(active_plan=True), GENERAL_PLAN),
            "my physics exam is tomorrow",
        )
        assert "exam_prep_offer" not in frames[-1]["content"]

    def test_quiz_setup_ending_is_unchanged(self, app):
        quiz_plan = {
            "action": "run_tool",
            "steps": [{"tool": "quiz_generator", "params": {"topic": "x"}}],
        }
        frames = _frames(
            _orchestrator(_Supabase(), quiz_plan),
            "quiz me, my exam is tomorrow",
        )
        assert frames[-1]["type"] == "quiz_setup"
        assert "exam_prep_offer" not in frames[-1]["data"]
