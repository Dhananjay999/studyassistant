"""Study-plan intent in chat -> the Exam Prep setup card rides the answer."""

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from aeva.orchestration import exam_offer, plan_intent


class TestDetect:
    @pytest.mark.parametrize("message", [
        "make me a study plan for class 10 boards",
        "Can you prepare a timetable for my exams?",
        "how should I prepare for NEET in 3 months",
        "help me prepare for my physics exam",
        "I need a revision schedule for semester exams",
        "how to crack JEE",
        "give me a plan for my boards",
        "padhai ka plan bana do",
        "what should i revise first for the test",
    ])
    def test_positive(self, message):
        assert plan_intent.detect(message)

    @pytest.mark.parametrize("message", [
        "explain osmosis",
        "what is a lesson plan in teaching",
        "make a business plan for a bakery",
        "plan a trip to Goa",
        "",
        "make me a study plan " + "word " * 90,
    ])
    def test_negative(self, message):
        assert not plan_intent.detect(message)


def _turn(message: str, **overrides) -> SimpleNamespace:
    fields = {
        "message": message, "user_id": "u1", "clarification": None,
        "run_id": None, "source_content": None, "quiz_options": None,
        "flashcard_options": None,
    }
    fields.update(overrides)
    return SimpleNamespace(**fields)


class TestResolve:
    @pytest.fixture(autouse=True)
    def _flags(self, monkeypatch):
        monkeypatch.setattr(exam_offer, "feature_enabled", lambda: True)

    def test_card_offer_when_no_plan(self, monkeypatch):
        monkeypatch.setattr(exam_offer, "has_active_plan", lambda *_a: False)
        intent = plan_intent.resolve(
            _turn("make me a study plan for class 10 physics and chemistry"),
            MagicMock(),
        )
        assert intent.detected and intent.wants_card and not intent.has_plan
        assert intent.offer["date_hint"] == "none"
        assert intent.offer["days_ahead"] is None
        assert intent.offer["source"] == "plan_intent"
        assert intent.offer["subjects"] == ["Physics", "Chemistry"]
        assert plan_intent.hint_for(intent) == plan_intent.CARD_HINT
        assert plan_intent.planner_hint(intent) == plan_intent.PLANNER_HINT

    def test_points_at_the_existing_plan(self, monkeypatch):
        monkeypatch.setattr(exam_offer, "has_active_plan", lambda *_a: True)
        intent = plan_intent.resolve(_turn("how do I prepare for boards"), MagicMock())
        assert intent.detected and intent.has_plan and not intent.wants_card
        assert plan_intent.hint_for(intent) == plan_intent.HAS_PLAN_HINT
        assert plan_intent.planner_hint(intent) == plan_intent.PLANNER_HINT

    def test_flag_off_detects_but_does_nothing(self, monkeypatch):
        monkeypatch.setattr(exam_offer, "feature_enabled", lambda: False)
        intent = plan_intent.resolve(_turn("make me a study plan"), MagicMock())
        assert intent.detected and not intent.wants_card and not intent.has_plan
        assert plan_intent.hint_for(intent) == ""
        assert plan_intent.planner_hint(intent) == ""

    def test_only_typed_turns(self, monkeypatch):
        monkeypatch.setattr(exam_offer, "has_active_plan", lambda *_a: False)
        assert plan_intent.resolve(
            _turn("make me a study plan", clarification=object()), MagicMock()
        ) is plan_intent.NONE
        assert plan_intent.resolve(
            _turn("make me a study plan", source_content="x"), MagicMock()
        ) is plan_intent.NONE

    def test_a_failing_lookup_never_fails_the_turn(self, monkeypatch):
        def boom(*_a):
            raise RuntimeError("db down")

        monkeypatch.setattr(exam_offer, "has_active_plan", boom)
        assert plan_intent.resolve(_turn("make me a study plan"), MagicMock()) is plan_intent.NONE

    def test_hints_carry_no_generator_words(self):
        # The deterministic routers read the same text as the planner: a
        # "quiz" or "flashcard" in the hint would open the quiz form.
        for text in (plan_intent.CARD_HINT, plan_intent.HAS_PLAN_HINT):
            lowered = text.lower()
            for word in ("quiz", "flashcard", "flash card", "test me", "draw", "image", "diagram"):
                assert word not in lowered, (word, text)


class TestDeadlineOfferSource:
    def test_deadline_payload_is_tagged(self):
        offer = exam_offer.detect("my physics exam is tomorrow")
        assert offer is not None
        assert offer.to_payload()["source"] == "deadline"

    def test_prefill_reads_subjects_without_a_date(self):
        name, subjects = exam_offer.prefill("study plan for maths and sst class 9")
        assert subjects == ["Mathematics", "Social Science"]
        assert name is None or isinstance(name, str)
