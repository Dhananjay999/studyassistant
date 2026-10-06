"""Exam Prep backend: pure unit tests (no network, no Supabase, no LLM).

Covers the exam-name → target_exam mapping, roadmap normalisation, day-detail
validation, the dashboard builder, the coach prompt block, the deterministic
routing table of ``ExamPrepOrchestrator`` and the wiring (blueprint
registered, flag registered, error codes present).
"""

import json
import re
from datetime import date
from pathlib import Path
from typing import ClassVar
from unittest.mock import MagicMock

import pytest
from flask import Flask

from aeva.common.errors import ERROR_CODES, CustomError
from aeva.exam_prep import exam_prep_service as svc
from aeva.exam_prep.exam_prep_orchestrator import (
    ExamPrepContext,
    ExamPrepOrchestrator,
)
from aeva.exam_prep.exam_prep_service import ExamPrepService
from aeva.exam_prep.schema.exam_prep_schema import (
    CreateExamPlanSchema,
    ExamChatRequestSchema,
    LessonStreamSchema,
    TopicFlashcardsData,
    TopicQuizData,
)
from aeva.feature_flag import feature_flag_service
from aeva.llm import prompts
from aeva.mcp.base import BaseTool, ToolDefinition
from aeva.mcp.registry import ToolRegistry
from aeva.orchestration.models import FlashcardOptions, QuizOptions
from aeva.tracing import recorder, store

BACKEND = Path(__file__).resolve().parents[1]
USER = "u1"
# Ids that cross the service boundary must be canonical UUIDs.
PLAN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
TOPIC_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
DAY_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
MEDIA_1 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
MEDIA_2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
PLAN = {
    "id": PLAN_ID,
    "user_id": USER,
    "status": "active",
    "exam_name": "JEE Main 2027",
    "exam_date": "2027-01-20",
    "class_level": "Class 12",
    "stream": "PCM",
    "subjects": ["Physics", "Chemistry", "Maths"],
    "daily_minutes": 120,
    "target_score": "99 percentile",
    "syllabus_text": None,
    "material_media_ids": [],
    "session_id": "s1",
    "total_days": 3,
    "plan_meta": {"summary": "Go.", "strategy_tips": ["Sleep."]},
    "created_at": "2026-10-01T00:00:00+00:00",
    "updated_at": "2026-10-01T00:00:00+00:00",
}
TOPIC = {
    "id": TOPIC_ID,
    "plan_id": PLAN_ID,
    "day_id": DAY_ID,
    "subject": "Physics",
    "title": "Kinematics",
    "description": "Equations of motion, graphs",
    "est_minutes": 45,
    "sort_order": 0,
    "status": "not_started",
    "status_updated_at": None,
    "quiz_id": None,
    "flashcard_set_id": None,
}


# ------------------------------------------------------------ target exam


class TestMatchTargetExam:
    @pytest.mark.parametrize(
        ("name", "expected"),
        [
            ("JEE Main 2027", "jee_main"),
            ("jee advanced", "jee_advanced"),
            ("JEE", "jee_main"),
            ("NEET UG", "neet"),
            ("SSC CGL Tier 1", "ssc_cgl"),
            ("ssc_chsl", "ssc_chsl"),
            ("CBSE Class 12 Boards", None),
            ("", None),
            (None, None),
        ],
    )
    def test_mappings(self, name, expected):
        assert svc.match_target_exam(name) == expected

    def test_needle_must_be_a_whole_word(self):
        assert svc.match_target_exam("neetu's semester exam") is None


# ------------------------------------------------------------- normalise


def _day(number, topics=2, subject="Physics", minutes=45, **extra):
    return {
        "day_number": number,
        "title": f"Day {number} title",
        "focus": "focus",
        "subjects": [
            {
                "subject": subject,
                "topics": [
                    {
                        "title": f"Topic {i}",
                        "description": "d" * 300,
                        "est_minutes": minutes,
                    }
                    for i in range(topics)
                ],
            }
        ],
        **extra,
    }


class TestNormalizePlan:
    SUBJECTS: ClassVar = ["Physics", "Chemistry"]

    def test_pads_missing_days_with_a_revision_topic(self):
        plan = svc.normalize_plan(
            {"summary": " s ", "strategy_tips": ["a", "", "b"], "days": [_day(1)]},
            total_days=3,
            subjects=self.SUBJECTS,
        )
        assert [d["day_number"] for d in plan["days"]] == [1, 2, 3]
        assert plan["days"][1]["topics"][0]["title"].startswith("Revise:")
        assert plan["days"][2]["topics"][0]["subject"] in self.SUBJECTS
        assert plan["summary"] == "s"
        assert plan["strategy_tips"] == ["a", "b"]

    def test_truncates_extra_days(self):
        plan = svc.normalize_plan(
            {"days": [_day(n) for n in range(1, 8)]},
            total_days=4,
            subjects=self.SUBJECTS,
        )
        assert [d["day_number"] for d in plan["days"]] == [1, 2, 3, 4]

    def test_dedupes_day_numbers_first_wins(self):
        first = _day(2, title="first")
        second = _day(2, title="second")
        plan = svc.normalize_plan(
            {"days": [_day(1), first, second]},
            total_days=2,
            subjects=self.SUBJECTS,
        )
        assert len(plan["days"]) == 2
        assert plan["days"][1]["title"] == "first"

    def test_unnumbered_days_fill_gaps_in_order(self):
        loose = _day(None, title="loose")
        plan = svc.normalize_plan(
            {"days": [_day(1), loose]}, total_days=2, subjects=self.SUBJECTS
        )
        assert plan["days"][1]["title"] == "loose"

    def test_clamps_minutes_and_trims_descriptions(self):
        plan = svc.normalize_plan(
            {
                "days": [
                    {
                        "day_number": 1,
                        "subjects": [
                            {
                                "subject": "Physics",
                                "topics": [
                                    {"title": " A ", "est_minutes": 2},
                                    {"title": "B", "est_minutes": 999},
                                    {"title": "C", "est_minutes": "x"},
                                    {"title": "", "est_minutes": 30},
                                ],
                            }
                        ],
                    }
                ]
            },
            total_days=1,
            subjects=self.SUBJECTS,
        )
        topics = plan["days"][0]["topics"]
        assert [t["title"] for t in topics] == ["A", "B", "C"]
        assert [t["est_minutes"] for t in topics] == [10, 180, 30]
        long = svc.normalize_plan(
            {"days": [_day(1)]}, total_days=1, subjects=self.SUBJECTS
        )
        assert len(long["days"][0]["topics"][0]["description"]) == 160

    def test_caps_topics_per_day(self):
        plan = svc.normalize_plan(
            {"days": [_day(1, topics=20)]}, total_days=1, subjects=self.SUBJECTS
        )
        assert len(plan["days"][0]["topics"]) == svc.MAX_TOPICS_PER_DAY

    def test_missing_subject_falls_back_to_the_first_subject(self):
        plan = svc.normalize_plan(
            {"days": [_day(1, subject="")]},
            total_days=1,
            subjects=self.SUBJECTS,
        )
        assert plan["days"][0]["topics"][0]["subject"] == "Physics"

    def test_unusable_output_raises(self):
        with pytest.raises(TypeError):
            svc.normalize_plan("nope", 3, self.SUBJECTS)
        with pytest.raises(ValueError, match="no days"):
            svc.normalize_plan({"days": []}, 3, self.SUBJECTS)


class TestValidateDayDetail:
    def test_drops_unknown_topic_ids_everywhere(self):
        detail = svc.validate_day_detail(
            {
                "overview": " o ",
                "time_blocks": [
                    {"label": "Morning", "minutes": 60, "topic_ids": ["t1", "zz"]},
                    {"label": "", "minutes": 10, "topic_ids": ["t1"]},
                    {"label": "Evening", "minutes": "bad", "topic_ids": "t1"},
                ],
                "topics": [
                    {"topic_id": "t1", "objectives": ["a", ""], "key_points": "x"},
                    {"topic_id": "zz", "objectives": ["b"]},
                    {"topic_id": "t1", "objectives": ["dup"]},
                ],
                "wrap_up": "w",
            },
            ["t1", "t2"],
        )
        assert detail["overview"] == "o"
        assert detail["time_blocks"] == [
            {"label": "Morning", "minutes": 60, "topic_ids": ["t1"]},
            {"label": "Evening", "minutes": 0, "topic_ids": []},
        ]
        assert [t["topic_id"] for t in detail["topics"]] == ["t1"]
        assert detail["topics"][0]["objectives"] == ["a"]
        assert detail["topics"][0]["key_points"] == []
        assert detail["topics"][0]["practice"] == []
        assert detail["wrap_up"] == "w"

    def test_empty_detail_raises(self):
        with pytest.raises(ValueError, match="empty"):
            svc.validate_day_detail({"topics": [{"topic_id": "zz"}]}, ["t1"])
        with pytest.raises(TypeError):
            svc.validate_day_detail([], ["t1"])


# ------------------------------------------------------------- dashboard


class TestBuildDashboard:
    DAYS: ClassVar = [
        {"id": "d1", "plan_id": "p1", "day_number": 1, "date": "2026-10-04",
         "title": "A", "focus": "", "detail": {"overview": "x"}},
        {"id": "d2", "plan_id": "p1", "day_number": 2, "date": "2026-10-05",
         "title": "B", "focus": "f", "detail": None},
        {"id": "d3", "plan_id": "p1", "day_number": 3, "date": "2026-10-06",
         "title": "C", "focus": "", "detail": None},
    ]
    TOPICS: ClassVar = [
        {**TOPIC, "id": "t1", "day_id": "d2", "sort_order": 1,
         "status": "completed", "quiz_id": "q1"},
        {**TOPIC, "id": "t2", "day_id": "d2", "sort_order": 0,
         "subject": "Maths", "status": "in_progress"},
        {**TOPIC, "id": "t3", "day_id": "d3", "subject": "Chemistry"},
        {**TOPIC, "id": "t4", "day_id": "d1", "status": "completed"},
    ]
    SUMMARIES: ClassVar = {"q1": {"attempt_count": 2, "best_score": 80.0,
                        "last_attempt_at": "2026-10-05T10:00:00+00:00"}}

    def test_shape_today_upcoming_and_progress(self):
        dash = svc.build_dashboard(
            PLAN, self.DAYS, self.TOPICS, self.SUMMARIES, date(2026, 10, 5)
        )
        assert dash["days_remaining"] == (date(2027, 1, 20) - date(2026, 10, 5)).days
        assert dash["today_day_number"] == 2
        assert dash["today"]["id"] == "d2"
        assert dash["today"]["has_detail"] is False
        assert dash["days"][0]["has_detail"] is True
        assert [d["id"] for d in dash["upcoming"]] == ["d3"]
        assert len(dash["days"]) == 3
        assert dash["progress"] == {
            "total_topics": 4, "completed": 2, "in_progress": 1,
            "not_started": 1, "percent": 50,
        }
        # Topics are grouped by subject in sort order; quiz summary batched.
        today = dash["today"]
        assert [s["subject"] for s in today["subjects"]] == ["Maths", "Physics"]
        physics = today["subjects"][1]["topics"][0]
        assert physics["quiz_summary"] == self.SUMMARIES["q1"]
        assert today["subjects"][0]["topics"][0]["quiz_summary"] is None
        assert today["topic_count"] == 2
        assert today["completed_count"] == 1
        assert today["in_progress_count"] == 1
        # Per-subject progress keeps the plan's subject order.
        assert dash["subjects"] == [
            {"subject": "Physics", "total": 2, "completed": 2, "in_progress": 0},
            {"subject": "Chemistry", "total": 1, "completed": 0, "in_progress": 0},
            {"subject": "Maths", "total": 1, "completed": 0, "in_progress": 1},
        ]
        assert dash["plan"]["exam_name"] == "JEE Main 2027"
        assert "user_id" not in dash["plan"]

    def test_before_the_plan_starts_upcoming_is_the_first_week(self):
        dash = svc.build_dashboard(
            PLAN, self.DAYS, self.TOPICS, {}, date(2026, 10, 1)
        )
        assert dash["today"] is None
        assert dash["today_day_number"] is None
        assert [d["id"] for d in dash["upcoming"]] == ["d1", "d2", "d3"]

    def test_empty_plan(self):
        dash = svc.build_dashboard(PLAN, [], [], {}, date(2027, 2, 1))
        assert dash["progress"]["percent"] == 0
        assert dash["days_remaining"] == 0
        assert dash["subjects"] == [
            {"subject": s, "total": 0, "completed": 0, "in_progress": 0}
            for s in PLAN["subjects"]
        ]


# ------------------------------------------------------------ coach block


class TestBuildExamPrepBlock:
    def test_returns_nothing_without_a_plan(self):
        assert prompts.build_exam_prep_block(None) == ""
        assert prompts.build_exam_prep_block({}) == ""

    def test_renders_every_line_when_everything_is_known(self):
        day = {"day_number": 4, "title": "Mechanics day"}
        topic = {"subject": "Physics", "title": "Kinematics", "description": "Graphs"}
        today = {"day_number": 5, "title": "Mixed", "topics": [
            {"subject": "Maths", "title": "Limits"},
            {"subject": "Chemistry", "title": "Mole concept"},
        ]}
        block = prompts.build_exam_prep_block(
            {**PLAN, "material_media_ids": ["m1", "m2"]}, day, topic, today
        )
        assert block.startswith("Exam Prep mode")
        assert "- Exam: JEE Main 2027 on 2027-01-20 (" in block
        assert "days left)" in block
        assert "- Class/stream: Class 12 PCM" in block
        assert "- Subjects: Physics, Chemistry, Maths" in block
        assert "- Daily study time: 120 min; Target: 99 percentile" in block
        assert "- Today (Day 5): Mixed — Maths: Limits, Chemistry: Mole concept" in block
        assert "- Current day: Day 4 — Mechanics day" in block
        assert "- Current topic: Physics: Kinematics — Graphs" in block
        assert "- Study material uploaded: 2 file(s)" in block
        assert block.endswith("Be encouraging and concrete.\n\n")

    def test_omits_empty_lines(self):
        block = prompts.build_exam_prep_block({
            **PLAN,
            "class_level": "",
            "stream": "",
            "target_score": None,
            "material_media_ids": [],
        })
        assert "Class/stream" not in block
        assert "Target:" not in block
        assert "Today" not in block
        assert "Current day" not in block
        assert "Current topic" not in block
        assert "Study material" not in block
        assert "- Daily study time: 120 min\n" in block

    def test_quiz_instructions_name_the_exam_and_topic(self):
        text = prompts.format_quiz_instructions("NEET", "Class 12", "Mole concept")
        assert "NEET study plan (class/grade: Class 12)" in text
        assert "(Mole concept)" in text
        bare = prompts.format_quiz_instructions("", "", "")
        assert "exam study plan." in bare
        assert "the topic as titled" in bare


# ----------------------------------------------------------------- routing


def _ctx(message, **kwargs):
    return ExamPrepContext(
        user_id=USER, session_id="s1", message=message, plan=PLAN, **kwargs
    )


def _step(plan):
    (step,) = plan["steps"]
    assert plan["action"] == "run_tool"
    return step["tool"], step["params"]


@pytest.fixture
def orch(monkeypatch):
    monkeypatch.setattr(
        feature_flag_service, "get_flags", lambda: {"web_search": True}
    )
    return ExamPrepOrchestrator(
        llm=MagicMock(), registry=MagicMock(), supabase=MagicMock()
    )


class TestExamRouting:
    def test_quiz_words_route_to_the_quiz_tool_on_the_topic(self, orch):
        ctx = _ctx("quiz me on this", topic=TOPIC)
        tool, params = _step(orch._exam_plan(ctx, ctx.message))
        assert tool == "quiz_generator"
        assert params["topic"] == "Physics: Kinematics"
        assert params["question_count"] == 5
        assert params["target_exam"] == "jee_main"
        assert "JEE Main 2027 study plan" in params["additional_instructions"]
        assert "Equations of motion" in params["additional_instructions"]

    @pytest.mark.parametrize(
        "message", ["give me a mock test", "test me", "some MCQ please",
                    "a practice test"],
    )
    def test_every_quiz_word(self, orch, message):
        tool, params = _step(orch._exam_plan(_ctx(message), message))
        assert tool == "quiz_generator"
        # No topic context: the message itself is the topic.
        assert params["topic"] == message

    def test_unknown_exam_has_no_target_exam(self, orch):
        ctx = _ctx("quiz", topic=TOPIC)
        ctx.plan = {**PLAN, "exam_name": "Semester exam"}
        _tool, params = _step(orch._exam_plan(ctx, ctx.message))
        assert "target_exam" not in params

    def test_flashcard_words_route_to_flashcards(self, orch):
        for message in ("make flashcards", "flash cards on this"):
            tool, params = _step(
                orch._exam_plan(_ctx(message, topic=TOPIC), message)
            )
            assert tool == "flashcard_generator"
            assert params == {"topic": "Physics: Kinematics", "count": 8}

    def test_flashcards_win_over_quiz_words(self, orch):
        message = "quiz me with flashcards"
        tool, _ = _step(orch._exam_plan(_ctx(message), message))
        assert tool == "flashcard_generator"

    def test_material_words_use_media_only_when_material_exists(self, orch):
        message = "explain my notes on waves"
        tool, _ = _step(orch._exam_plan(_ctx(message), message))
        assert tool == "general"

        ctx = _ctx(message)
        ctx.plan = {**PLAN, "material_media_ids": ["m1", "m2"]}
        tool, params = _step(orch._exam_plan(ctx, message))
        assert tool == "media_llm"
        assert params == {"query": message, "media_ids": ["m1", "m2"]}
        assert ctx.media_ids == ["m1", "m2"]

    def test_fresh_info_goes_to_web_search_when_enabled(self, orch, monkeypatch):
        message = "what is the latest JEE exam date notification"
        tool, params = _step(orch._exam_plan(_ctx(message), message))
        assert tool == "web_search"
        assert params == {"query": message}
        monkeypatch.setattr(
            feature_flag_service, "get_flags", lambda: {"web_search": False}
        )
        tool, _ = _step(orch._exam_plan(_ctx(message), message))
        assert tool == "general"

    def test_default_is_general(self, orch):
        message = "explain projectile motion"
        tool, params = _step(orch._exam_plan(_ctx(message), message))
        assert tool == "general"
        assert params == {"query": message}

    def test_quiz_options_force_the_quiz_tool(self, orch):
        opts = QuizOptions(question_count=10, difficulty="hard")
        ctx = _ctx("explain projectile motion", topic=TOPIC, quiz_options=opts)
        tool, params = _step(orch._exam_plan(ctx, ctx.message))
        assert tool == "quiz_generator"
        assert params["question_count"] == 10
        assert params["difficulty"] == "hard"
        assert params["topic"] == "Physics: Kinematics"
        assert params["target_exam"] == "jee_main"
        # Explicit popover choices are never overridden.
        chosen = QuizOptions(topic="My topic", target_exam="neet")
        _tool, params = _step(
            orch._exam_plan(_ctx("x", topic=TOPIC, quiz_options=chosen), "x")
        )
        assert params["topic"] == "My topic"
        assert params["target_exam"] == "neet"

    def test_flashcard_options_force_flashcards(self, orch):
        ctx = _ctx("hello", topic=TOPIC, flashcard_options=FlashcardOptions(count=12))
        tool, params = _step(orch._exam_plan(ctx, ctx.message))
        assert tool == "flashcard_generator"
        assert params == {"count": 12, "topic": "Physics: Kinematics"}

    def test_never_opens_the_quiz_setup_popover(self, orch):
        plan = orch._exam_plan(_ctx("quiz"), "quiz")
        assert orch._should_open_quiz_setup(plan, _ctx("quiz"), "quiz") is False

    def test_plain_chat_context_is_rejected(self, orch):
        from aeva.orchestration.models import AssistantContext

        plain = AssistantContext(user_id=USER, session_id="s1", message="hi")
        with pytest.raises(CustomError):
            orch._exam(plain)


# ----------------------------------------------------------------- service


class _Repo:
    """The slice of ExamPrepRepository the service touches."""

    def __init__(self, plan=None, topic=None):
        self.plan = plan
        self.topic = topic
        self.updates: list[tuple] = []

    def get_plan(self, plan_id, user_id):
        if self.plan and self.plan["id"] == plan_id and self.plan["user_id"] == user_id:
            return dict(self.plan)
        return None

    def get_topic(self, topic_id):
        return dict(self.topic) if self.topic and self.topic["id"] == topic_id else None

    def update_topic(self, topic_id, plan_id, fields):
        self.updates.append((topic_id, plan_id, fields))
        return {**self.topic, **fields}

    def quiz_summaries(self, user_id, quiz_ids):
        return {}

    def owned_media(self, user_id, media_ids):
        return [{"id": m, "file_name": f"{m}.pdf"} for m in media_ids if m != "gone"]

    def get_day(self, day_id, plan_id):
        return {"id": day_id, "day_number": 2, "title": "Motion", "focus": "Graphs", "date": "2026-10-06"}

    def save_topic_lesson(self, topic_id, plan_id, lesson_md):
        self.updates.append((topic_id, plan_id, {"lesson_md": lesson_md}))
        self.topic = {**self.topic, "lesson_md": lesson_md, "lesson_generated_at": "now"}
        return dict(self.topic)


def _frames(gen):
    """Parse SSE frames from a generator into dicts."""
    return [json.loads(f[len("data: "):]) for f in gen if f.startswith("data: ")]


class TestTopicLesson:
    def _service(self, topic=TOPIC, chunks=("## Why", " this matters")):
        repo = _Repo(plan=PLAN, topic=topic)
        llm = MagicMock()
        llm.generate_stream.return_value = iter(chunks)
        supabase = MagicMock()
        supabase.get_profile.return_value = {"full_name": "Asha"}
        return ExamPrepService(repo=repo, supabase=supabase, llm=llm), repo, llm

    def test_get_lesson_shape_without_a_lesson(self):
        service, _, _ = self._service()
        out = service.get_topic_lesson(USER, TOPIC_ID)
        assert out["plan_id"] == PLAN_ID
        assert out["lesson_md"] is None
        assert out["topic"]["has_lesson"] is False
        assert out["day"] == {
            "id": DAY_ID, "day_number": 2, "title": "Motion", "date": "2026-10-06",
        }

    def test_first_open_streams_saves_and_marks_in_progress(self):
        service, repo, llm = self._service()
        frames = _frames(service.stream_topic_lesson(USER, TOPIC_ID, _lesson_data()))
        assert [f["content"] for f in frames[:-1]] == ["## Why", " this matters"]
        done = frames[-1]
        assert done["done"] is True
        assert done["content"]["lesson_md"] == "## Why this matters"
        assert done["content"]["topic"]["has_lesson"] is True
        assert done["content"]["topic"]["status"] == "in_progress"
        prompt = llm.generate_stream.call_args.args[0]
        assert "Kinematics" in prompt
        assert "Day 2: Motion — Graphs" in prompt
        assert "JEE Main 2027" in prompt
        kinds = [u[2].keys() for u in repo.updates]
        assert {"lesson_md"} in [set(k) for k in kinds]
        assert any("status" in k for k in kinds)

    def test_cached_lesson_replays_without_the_llm(self):
        service, _, llm = self._service(topic={**TOPIC, "lesson_md": "cached"})
        frames = _frames(service.stream_topic_lesson(USER, TOPIC_ID, _lesson_data()))
        assert frames[0]["content"] == "cached"
        assert frames[-1]["content"]["lesson_md"] == "cached"
        llm.generate_stream.assert_not_called()

    def test_regenerate_bypasses_the_cache(self):
        service, _, llm = self._service(topic={**TOPIC, "lesson_md": "cached", "status": "completed"})
        frames = _frames(
            service.stream_topic_lesson(USER, TOPIC_ID, _lesson_data(regenerate=True))
        )
        llm.generate_stream.assert_called_once()
        # A completed topic stays completed.
        assert frames[-1]["content"]["topic"]["status"] == "completed"

    def test_empty_stream_is_an_llm_error(self):
        service, _, _ = self._service(chunks=("", "  "))
        with pytest.raises(CustomError) as err:
            list(service.stream_topic_lesson(USER, TOPIC_ID, _lesson_data()))
        assert err.value.code == "LLM_ERROR"

    def test_coach_block_carries_the_lesson(self):
        block = prompts.build_exam_prep_block(PLAN, topic={**TOPIC, "lesson_md": "## Core ideas\nVelocity..."})
        assert "The lesson you already taught" in block
        assert "Velocity..." in block


def _lesson_data(**extra):
    return LessonStreamSchema().load(extra)


class TestTopicTurns:
    def _rows(self):
        other = "99999999-9999-4999-8999-999999999999"
        return [
            {"id": "1", "role": "user", "content": "q1", "metadata": {"exam_topic_id": TOPIC_ID}},
            {"id": "2", "role": "assistant", "content": "a1", "metadata": {"tool_used": "general"}},
            {"id": "3", "role": "user", "content": "q2", "metadata": {"exam_topic_id": other}},
            {"id": "4", "role": "assistant", "content": "a2", "metadata": {}},
            {"id": "5", "role": "user", "content": "q3", "metadata": {}},
            {"id": "6", "role": "assistant", "content": "a3", "metadata": {}},
            {"id": "7", "role": "user", "content": "q4", "metadata": {"exam_topic_id": TOPIC_ID}},
        ]

    def test_keeps_only_the_topic_turns_and_their_replies(self):
        kept = svc.topic_turns(self._rows(), TOPIC_ID)
        assert [m["id"] for m in kept] == ["1", "2", "7"]

    def test_list_messages_filters_from_a_bounded_fetch(self):
        repo = _Repo(plan=PLAN)
        supabase = MagicMock()
        supabase.get_messages.return_value = self._rows()
        service = ExamPrepService(repo=repo, supabase=supabase)
        out = service.list_messages(USER, PLAN_ID, 60, topic_id=TOPIC_ID)
        assert [m["id"] for m in out] == ["1", "2", "7"]
        assert supabase.get_messages.call_args.kwargs["limit"] == svc.TOPIC_HISTORY_FETCH
        plain = service.list_messages(USER, PLAN_ID, 60)
        assert len(plain) == 7
        assert supabase.get_messages.call_args.kwargs["limit"] == 60


class TestServiceTopics:
    def test_require_enabled_raises_feature_disabled(self, monkeypatch):
        monkeypatch.setattr(feature_flag_service, "get_flags", lambda: {"exam_prep": False})
        with pytest.raises(CustomError) as err:
            ExamPrepService.require_enabled()
        assert err.value.code == "FEATURE_DISABLED"
        assert err.value.status == 404
        monkeypatch.setattr(feature_flag_service, "get_flags", lambda: {"exam_prep": True})
        ExamPrepService.require_enabled()

    def test_plan_lookup_is_owner_scoped(self):
        service = ExamPrepService(repo=_Repo(plan=PLAN))
        assert service.load_plan(USER, PLAN_ID)["id"] == PLAN_ID
        with pytest.raises(CustomError) as err:
            service.load_plan("someone-else", PLAN_ID)
        assert err.value.code == "EXAM_PLAN_NOT_FOUND"
        with pytest.raises(CustomError):
            service.load_plan(USER, DAY_ID)
        archived = ExamPrepService(repo=_Repo(plan={**PLAN, "status": "archived"}))
        assert archived.load_plan(USER, PLAN_ID)["status"] == "archived"
        with pytest.raises(CustomError) as err:
            archived.load_plan(USER, PLAN_ID, active_only=True)
        assert err.value.code == "EXAM_PLAN_NOT_FOUND"

    def test_malformed_ids_are_not_found_not_500(self):
        """A non-UUID path id never reaches PostgREST (22P02 → 500)."""
        repo = _Repo(plan=PLAN, topic=TOPIC)
        repo.get_plan = MagicMock(side_effect=AssertionError("queried"))
        repo.get_topic = MagicMock(side_effect=AssertionError("queried"))
        repo.get_day = MagicMock(side_effect=AssertionError("queried"))
        service = ExamPrepService(repo=repo, generation=MagicMock())
        with pytest.raises(CustomError) as err:
            service.load_plan(USER, "nope")
        assert err.value.code == "EXAM_PLAN_NOT_FOUND"
        with pytest.raises(CustomError) as err:
            service.generate_topic_quiz(USER, "t1", TopicQuizData())
        assert err.value.code == "NOT_FOUND"
        repo.get_plan = lambda plan_id, user_id: dict(PLAN)
        with pytest.raises(CustomError) as err:
            service.get_day_detail(USER, PLAN_ID, "d1")
        assert err.value.code == "NOT_FOUND"

    def test_topic_quiz_uses_generation_service_and_links_the_topic(self):
        repo = _Repo(plan=PLAN, topic=TOPIC)
        generation = MagicMock()
        generation.create_quiz.return_value = {
            "data": {"quiz_id": "q9", "title": "Kinematics quiz", "topic": "Kinematics"}
        }
        service = ExamPrepService(repo=repo, generation=generation)
        out = service.generate_topic_quiz(
            USER, TOPIC_ID, TopicQuizData(question_count=7, difficulty="hard")
        )
        assert out == {"quiz_id": "q9", "title": "Kinematics quiz", "topic": "Kinematics"}
        (data,) = generation.create_quiz.call_args.args[1:]
        assert data.source == "topic"
        assert data.topic == "Physics: Kinematics"
        assert data.question_count == 7
        assert data.difficulty == "hard"
        assert data.target_exam == "jee_main"
        assert "JEE Main 2027 study plan" in data.additional_instructions
        # Linked, and a fresh topic moves to in_progress.
        (topic_id, plan_id, fields), = repo.updates
        assert (topic_id, plan_id) == (TOPIC_ID, PLAN_ID)
        assert fields["quiz_id"] == "q9"
        assert fields["status"] == "in_progress"
        assert fields["status_updated_at"]

    def test_topic_quiz_grounds_in_still_owned_material(self):
        repo = _Repo(plan={**PLAN, "material_media_ids": ["m1", "gone"]}, topic=TOPIC)
        generation = MagicMock()
        generation.create_quiz.return_value = {"data": {"quiz_id": "q", "title": "", "topic": ""}}
        ExamPrepService(repo=repo, generation=generation).generate_topic_quiz(
            USER, TOPIC_ID, TopicQuizData()
        )
        (data,) = generation.create_quiz.call_args.args[1:]
        assert data.source == "files"
        assert data.media_ids == ["m1"]
        assert data.question_count == 5

    def test_topic_of_another_user_is_not_found(self):
        repo = _Repo(plan={**PLAN, "user_id": "other"}, topic=TOPIC)
        service = ExamPrepService(repo=repo, generation=MagicMock())
        with pytest.raises(CustomError) as err:
            service.generate_topic_quiz(USER, TOPIC_ID, TopicQuizData())
        assert err.value.code == "NOT_FOUND"
        assert repo.updates == []

    def test_completed_topic_keeps_its_status_when_linked(self):
        repo = _Repo(plan=PLAN, topic={**TOPIC, "status": "completed"})
        generation = MagicMock()
        generation.create_flashcards.return_value = {
            "data": {"set_id": "f1", "title": "Cards", "topic": "Kinematics"}
        }
        out = ExamPrepService(repo=repo, generation=generation).generate_topic_flashcards(
            USER, TOPIC_ID, TopicFlashcardsData(count=None)
        )
        assert out == {"set_id": "f1", "title": "Cards", "topic": "Kinematics"}
        (data,) = generation.create_flashcards.call_args.args[1:]
        assert data.count == 8
        ((_, _, fields),) = repo.updates
        assert fields == {"flashcard_set_id": "f1"}

    def test_update_topic_status_stamps_the_time(self):
        repo = _Repo(plan=PLAN, topic=TOPIC)
        out = ExamPrepService(repo=repo).update_topic_status(USER, TOPIC_ID, "completed")
        assert out["status"] == "completed"
        assert out["status_updated_at"]
        assert out["quiz_summary"] is None
        assert set(out) == {
            "id", "plan_id", "day_id", "subject", "title", "description",
            "est_minutes", "sort_order", "status", "status_updated_at",
            "quiz_id", "flashcard_set_id", "quiz_summary",
            "lesson_generated_at", "has_lesson",
        }
        assert out["has_lesson"] is False


# ------------------------------------------------------------- create_plan


OLD_PLAN_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff"


class _UniqueViolationError(Exception):
    """Shaped like postgrest.APIError for idx_exam_plans_one_active."""

    code = "23505"


class _CreateRepo:
    """Records every call create_plan makes, in order."""

    def __init__(self, fail_at=None, activate_errors=()):
        self.calls: list[tuple] = []
        self.fail_at = fail_at
        self.activate_errors = list(activate_errors)
        self.plans = {OLD_PLAN_ID: {**PLAN, "id": OLD_PLAN_ID}}

    def _hit(self, name, *args):
        self.calls.append((name, *args))
        if name == self.fail_at:
            raise RuntimeError(f"{name} failed")

    def owned_media(self, user_id, media_ids):
        self._hit("owned_media")
        return [{"id": m, "file_name": "notes.pdf"} for m in media_ids]

    def insert_plan(self, row):
        self._hit("insert_plan", row["status"])
        self.plans[PLAN_ID] = {**row, "id": PLAN_ID, "session_id": None}
        return dict(self.plans[PLAN_ID])

    def insert_roadmap(self, plan_id, start, days):
        self._hit("insert_roadmap", plan_id)
        return [], []

    def archive_active_plans(self, user_id):
        self._hit("archive")
        ids = [p["id"] for p in self.plans.values() if p["status"] == "active"]
        for pid in ids:
            self.plans[pid]["status"] = "archived"
        return ids

    def update_plan(self, plan_id, user_id, fields):
        self._hit("update_plan", plan_id, dict(fields))
        if fields.get("status") == "active" and self.activate_errors:
            raise self.activate_errors.pop(0)
        self.plans[plan_id].update(fields)
        return dict(self.plans[plan_id])

    def delete_plan_sessions(self, plan_id, user_id):
        self._hit("delete_plan_sessions", plan_id)

    def delete_plan(self, plan_id, user_id):
        self._hit("delete_plan", plan_id)
        self.plans.pop(plan_id, None)

    def list_days(self, plan_id):
        return []

    def list_topics(self, plan_id):
        return []

    def quiz_summaries(self, user_id, quiz_ids):
        return {}


def _create_service(repo):
    supabase = MagicMock()
    supabase.get_profile.return_value = {"full_name": "Asha"}
    supabase.resolve_space.return_value = None
    supabase.create_session.return_value = {"id": "s-new"}
    llm = MagicMock()
    llm.model = "m"
    llm.generate_structured.return_value = {
        "summary": "Go", "strategy_tips": [], "days": [
            {"day_number": 1, "title": "D1", "subjects": [
                {"subject": "Physics", "topics": [{"title": "Kinematics"}]}
            ]}
        ],
    }
    research = MagicMock()
    research.generate.return_value = "Unit 1 Kinematics (weightage high)"
    research.last_sources = [{"title": "NTA", "url": "https://nta.ac.in"}]
    return (
        ExamPrepService(
            repo=repo, supabase=supabase, llm=llm, research_llm=research
        ),
        supabase,
    )


def _plan_data(**extra):
    return CreateExamPlanSchema().load({
        "exam_name": "JEE Main",
        "exam_date": "2099-01-01",
        "subjects": ["Physics"],
        "material_media_ids": [MEDIA_1],
        **extra,
    })


class TestSyllabusResearch:
    def test_brief_and_sources_reach_the_prompt_and_the_plan(self):
        repo = _CreateRepo()
        service, _ = _create_service(repo)
        service.create_plan(USER, _plan_data(
            exam_kind="competitive", board="NTA", exam_details="first attempt",
        ))
        research_prompt = service.research_llm.generate.call_args.args[0]
        assert "JEE Main" in research_prompt
        assert "competitive / entrance exam" in research_prompt
        assert "NTA" in research_prompt
        assert "first attempt" in research_prompt
        assert service.research_llm.generate.call_args.kwargs["use_search"]
        plan_prompt = service.llm.generate_structured.call_args.args[0]
        assert "Unit 1 Kinematics (weightage high)" in plan_prompt
        meta = repo.plans[PLAN_ID]["plan_meta"]
        assert meta["exam_kind"] == "competitive"
        assert meta["board"] == "NTA"
        assert meta["research_brief"].startswith("Unit 1 Kinematics")
        assert meta["research_sources"] == [
            {"title": "NTA", "url": "https://nta.ac.in"}
        ]

    def test_research_failure_still_builds_the_plan(self):
        repo = _CreateRepo()
        service, _ = _create_service(repo)
        service.research_llm.generate.side_effect = RuntimeError("no web")
        dash = service.create_plan(USER, _plan_data())
        assert dash["plan"]["status"] == "active"
        plan_prompt = service.llm.generate_structured.call_args.args[0]
        assert "(no research available)" in plan_prompt
        assert repo.plans[PLAN_ID]["plan_meta"]["research_brief"] == ""

    def test_research_can_be_turned_off(self):
        repo = _CreateRepo()
        service, _ = _create_service(repo)
        service.create_plan(USER, _plan_data(research=False))
        service.research_llm.generate.assert_not_called()

    def test_schema_defaults_keep_older_clients_working(self):
        data = _plan_data()
        assert data.exam_kind == "other"
        assert data.board == ""
        assert data.exam_details == ""
        assert data.research is True

    def test_schema_accepts_the_unit_kind(self):
        assert _plan_data(exam_kind="unit").exam_kind == "unit"

    def test_schema_rejects_unknown_kind(self):
        with pytest.raises(Exception, match="exam_kind"):
            _plan_data(exam_kind="hogwarts")

    def test_coach_block_carries_board_and_research_notes(self):
        block = prompts.build_exam_prep_block({
            **PLAN,
            "plan_meta": {
                "board": "CBSE",
                "exam_details": "English medium",
                "research_brief": "Unit weightage: Mechanics 25%",
            },
        })
        assert "- Board / conducting body: CBSE" in block
        assert "- Student's specifics: English medium" in block
        assert "Mechanics 25%" in block


class TestCreatePlan:
    def test_archives_the_old_plan_only_as_the_last_step(self):
        repo = _CreateRepo()
        service, supabase = _create_service(repo)
        dash = service.create_plan(USER, _plan_data())
        names = [c[0] for c in repo.calls]
        assert names == [
            "owned_media", "insert_plan", "insert_roadmap", "update_plan",
            "archive", "update_plan",
        ]
        # Inserted in the transient archived state, flipped to active last.
        assert repo.calls[1] == ("insert_plan", "archived")
        assert repo.calls[-1] == ("update_plan", PLAN_ID, {"status": "active"})
        assert dash["plan"]["status"] == "active"
        assert dash["plan"]["session_id"] == "s-new"
        assert repo.plans[OLD_PLAN_ID]["status"] == "archived"
        session_kwargs = supabase.create_session.call_args.kwargs
        assert session_kwargs["kind"] == "exam_prep"
        assert session_kwargs["exam_plan_id"] == PLAN_ID

    def test_llm_failure_touches_nothing(self):
        repo = _CreateRepo()
        service, _ = _create_service(repo)
        service.llm.generate_structured.side_effect = RuntimeError("down")
        with pytest.raises(CustomError) as err:
            service.create_plan(USER, _plan_data())
        assert err.value.code == "LLM_ERROR"
        assert [c[0] for c in repo.calls] == ["owned_media"]
        assert repo.plans[OLD_PLAN_ID]["status"] == "active"

    def test_persistence_failure_before_the_flip_keeps_the_old_plan(self):
        repo = _CreateRepo(fail_at="insert_roadmap")
        service, _ = _create_service(repo)
        with pytest.raises(CustomError) as err:
            service.create_plan(USER, _plan_data())
        assert err.value.code == "INTERNAL_ERROR"
        assert [c[0] for c in repo.calls] == [
            "owned_media", "insert_plan", "insert_roadmap",
            "delete_plan_sessions", "delete_plan",
        ]
        assert repo.plans[OLD_PLAN_ID]["status"] == "active"
        assert PLAN_ID not in repo.plans

    def test_failed_flip_restores_the_archived_plan(self):
        repo = _CreateRepo(activate_errors=[RuntimeError("db down")])
        service, _ = _create_service(repo)
        with pytest.raises(CustomError) as err:
            service.create_plan(USER, _plan_data())
        assert err.value.code == "INTERNAL_ERROR"
        assert [c[0] for c in repo.calls][-5:] == [
            "archive", "update_plan", "delete_plan_sessions", "delete_plan",
            "update_plan",
        ]
        assert repo.calls[-1] == (
            "update_plan", OLD_PLAN_ID, {"status": "active"}
        )
        assert repo.plans[OLD_PLAN_ID]["status"] == "active"
        assert PLAN_ID not in repo.plans

    def test_concurrent_create_retries_once_and_last_wins(self):
        repo = _CreateRepo(activate_errors=[_UniqueViolationError()])
        service, _ = _create_service(repo)
        dash = service.create_plan(USER, _plan_data())
        names = [c[0] for c in repo.calls]
        assert names[-4:] == ["archive", "update_plan", "archive", "update_plan"]
        assert dash["plan"]["status"] == "active"
        assert repo.plans[PLAN_ID]["status"] == "active"


# ----------------------------------------------------------------- schemas


class TestSchemas:
    def test_create_plan_cleans_subjects_and_rejects_the_past(self):
        data = CreateExamPlanSchema().load({
            "exam_name": " NEET ",
            "exam_date": "2099-01-01",
            "subjects": [" Physics ", "Physics", "Biology"],
            "material_media_ids": [MEDIA_1, MEDIA_1],
        })
        assert data.exam_name == "NEET"
        assert data.subjects == ["Physics", "Biology"]
        assert data.material_media_ids == [MEDIA_1]
        assert data.daily_minutes == 120
        assert data.exam_date == date(2099, 1, 1)
        with pytest.raises(Exception, match="today or later"):
            CreateExamPlanSchema().load({
                "exam_name": "x", "exam_date": "2000-01-01", "subjects": ["a"],
            })
        with pytest.raises(Exception, match="subjects"):
            CreateExamPlanSchema().load({
                "exam_name": "x", "exam_date": "2099-01-01", "subjects": [],
            })

    def test_create_plan_rejects_blank_name_bad_ids_and_too_many_files(self):
        base = {"exam_date": "2099-01-01", "subjects": ["a"]}
        with pytest.raises(Exception, match="exam_name"):
            CreateExamPlanSchema().load({**base, "exam_name": "   "})
        with pytest.raises(Exception, match="material_media_ids"):
            CreateExamPlanSchema().load({
                **base, "exam_name": "x", "material_media_ids": ["m1"],
            })
        with pytest.raises(Exception, match="material_media_ids"):
            CreateExamPlanSchema().load({
                **base,
                "exam_name": "x",
                "material_media_ids": [
                    f"{i:08x}-0000-4000-8000-000000000000" for i in range(51)
                ],
            })

    def test_chat_request_rejects_malformed_ids(self):
        with pytest.raises(Exception, match="topic_id"):
            ExamChatRequestSchema().load({"message": "hi", "topic_id": "not-a-uuid"})
        with pytest.raises(Exception, match="day_id"):
            ExamChatRequestSchema().load({"message": "hi", "day_id": "d1"})
        data = ExamChatRequestSchema().load({"message": "hi", "topic_id": None})
        assert data.topic_id is None

    def test_chat_request_builds_the_option_dataclasses(self):
        data = ExamChatRequestSchema().load({
            "message": "quiz",
            "topic_id": TOPIC_ID,
            "quiz_options": {"question_count": 5, "difficulty": 8},
            "flashcard_options": {"count": 3},
        })
        assert data.topic_id == TOPIC_ID
        assert data.day_id is None
        assert data.quiz_options == QuizOptions(question_count=5, difficulty="hard")
        assert data.flashcard_options == FlashcardOptions(count=3)


# ------------------------------------------------------------------ wiring


class TestWiring:
    def test_blueprint_is_registered_in_the_app(self):
        source = (BACKEND / "aeva" / "app.py").read_text(encoding="utf-8")
        assert re.search(
            r"from aeva\.exam_prep\.exam_prep_controller import blueprint as exam_prep_bp",
            source,
        )
        assert "api.register_blueprint(exam_prep_bp)" in source
        assert '"LLM_EXAM_PLAN_MODEL"' in source
        assert '"LLM_EXAM_PLAN_PROVIDER"' in source

    def test_routes(self):
        from flask import Flask
        from flask_smorest import Api

        from aeva.exam_prep.exam_prep_controller import blueprint

        app = Flask("t")
        app.config.update(API_TITLE="t", API_VERSION="1", OPENAPI_VERSION="3.0.2")
        Api(app).register_blueprint(blueprint)
        rules = {
            rule.rule: set(rule.methods) - {"HEAD", "OPTIONS"}
            for rule in app.url_map.iter_rules()
            if rule.rule.startswith("/exam-prep")
        }
        assert rules == {
            "/exam-prep/plan": {"GET", "POST"},
            "/exam-prep/plan/<plan_id>/archive": {"POST"},
            "/exam-prep/plan/<plan_id>/days/<day_id>": {"GET"},
            "/exam-prep/topics/<topic_id>": {"PATCH"},
            "/exam-prep/topics/<topic_id>/lesson": {"GET"},
            "/exam-prep/topics/<topic_id>/lesson/stream": {"POST"},
            "/exam-prep/topics/<topic_id>/quiz": {"POST"},
            "/exam-prep/topics/<topic_id>/flashcards": {"POST"},
            "/exam-prep/plan/<plan_id>/messages": {"GET"},
            "/exam-prep/plan/<plan_id>/chat/stream": {"POST"},
        }

    def test_flag_is_registered_and_off_by_default(self):
        flag = next(
            f for f in feature_flag_service.FEATURE_FLAGS if f.key == "exam_prep"
        )
        assert flag.default_enabled is False
        assert feature_flag_service.DEFAULTS["exam_prep"] is False
        assert "exam_prep" in feature_flag_service.FLAG_KEYS

    def test_error_codes(self):
        assert ERROR_CODES["FEATURE_DISABLED"] == {
            "code": "FEATURE_DISABLED",
            "message": "This feature is not available",
            "status": 404,
        }
        assert ERROR_CODES["EXAM_PLAN_NOT_FOUND"]["status"] == 404

    def test_templates_are_exported_and_render(self):
        rendered = prompts.PromptBuilder.build(
            prompts.EXAM_PLAN_TEMPLATE,
            EXAM_NAME="NEET", EXAM_DATE="2027-05-03", DAYS_REMAINING="200",
            TOTAL_DAYS="60", CLASS_LEVEL="12", STREAM="PCB",
            SUBJECTS="Physics, Chemistry, Biology", DAILY_MINUTES="120",
            TARGET_SCORE="(not set)", SYLLABUS="(none provided)",
            MATERIAL_NOTES="(none)", USER_PROFILE="", CURRENT_DATE="2026-10-05",
            EXAM_KIND="competitive / entrance exam", BOARD="NTA",
            EXAM_DETAILS="(none)", RESEARCH_BRIEF="Unit 1: Kinematics",
        )
        assert "exactly 60 days" in rendered.user_message
        assert "Unit 1: Kinematics" in rendered.user_message
        research = prompts.PromptBuilder.build(
            prompts.EXAM_SYLLABUS_RESEARCH_TEMPLATE,
            CURRENT_DATE="2026-10-05", EXAM_NAME="NEET", EXAM_DATE="2027-05-03",
            DAYS_REMAINING="200", EXAM_KIND="competitive / entrance exam",
            BOARD="NTA", CLASS_LEVEL="12", STREAM="PCB",
            SUBJECTS="Physics, Chemistry, Biology", EXAM_DETAILS="(none)",
        )
        assert "official units" in research.user_message
        assert "You are Aeva" in rendered.system_prompt
        assert "@@AEVA_META@@" not in rendered.user_message
        day = prompts.PromptBuilder.build(
            prompts.EXAM_DAY_DETAIL_TEMPLATE,
            EXAM_NAME="NEET", DAYS_REMAINING="3", DAY_NUMBER="2",
            DAY_DATE="2026-10-06", DAY_TITLE="T", DAY_FOCUS="F",
            DAILY_MINUTES="90", TOPICS="- topic_id=t1 | Physics: X (30 min): d",
            USER_PROFILE="",
        )
        assert "topic_id=t1" in day.user_message
        assert prompts.EXAM_PLAN_SCHEMA["required"] == ["summary", "strategy_tips", "days"]
        assert set(prompts.EXAM_DAY_DETAIL_SCHEMA["properties"]) == {
            "overview", "time_blocks", "topics", "wrap_up",
        }


# ------------------------------------------------------ streamed exam turn


SESSION = "11111111-1111-1111-1111-111111111111"


class _ExamSupabase:
    """The slice of SupabaseService an exam-coach turn touches."""

    def __init__(self, kind="exam_prep"):
        self.session = {
            "id": SESSION,
            "title": "Exam Prep · JEE Main 2027",
            "kind": kind,
            "space_id": None,
            "study_spaces": None,
        }
        self.profile = {"full_name": "Asha", "is_debug_user": False}
        self.added: list[dict] = []
        self.calls: list[tuple] = []

    def get_session(self, session_id, user_id):
        return dict(self.session) if session_id == SESSION else None

    def get_profile(self, user_id):
        return self.profile

    def get_messages(self, session_id, limit=None):
        return []

    def add_message(self, session_id, role, content, metadata=None):
        row = {
            "id": f"00000000-0000-0000-0000-{len(self.added) + 1:012d}",
            "session_id": session_id,
            "role": role,
            "content": content,
            "metadata": dict(metadata or {}),
        }
        self.added.append(row)
        return row

    def update_session(self, session_id, user_id, **fields):
        self.calls.append(("update_session", fields))

    def update_learning_profile(self, user_id, fields):
        self.calls.append(("update_learning_profile", fields))

    def touch_space(self, space_id):
        self.calls.append(("touch_space", space_id))


class _GeneralTool(BaseTool):
    def __init__(self):
        self.calls: list[tuple] = []

    @property
    def definition(self):
        return ToolDefinition(
            "general", "general", {"type": "object", "properties": {}}
        )

    def can_stream(self):
        return True

    def execute(self, ctx, params):
        return {"answer": "Projectiles follow parabolas.", "sources": []}

    def execute_stream(self, ctx, params):
        self.calls.append((ctx, params))
        yield "Projectiles "
        yield "follow parabolas."
        return {"answer": "Projectiles follow parabolas.", "sources": []}


class _QuizTool(BaseTool):
    def __init__(self):
        self.calls: list[tuple] = []

    @property
    def definition(self):
        return ToolDefinition("quiz_generator", "quiz", {"type": "object"})

    def execute(self, ctx, params):
        self.calls.append((ctx, params))
        return {"quiz_id": "q1", "title": "Kinematics", "questions": [1, 2]}


@pytest.fixture
def exam_app(monkeypatch):
    """Bare app context, tracing storage stubbed, flags on."""
    recorder._BINDING.set(None)
    monkeypatch.setattr(store, "persist", lambda *_a, **_k: True)
    monkeypatch.setattr(store, "_unavailable_until", 0.0)
    monkeypatch.setattr(
        feature_flag_service, "get_flags", lambda: {"web_search": True}
    )
    app = Flask(__name__)
    app.config.update(
        LLM_WEB_SEARCH_MODEL="answer-model",
        LLM_FAST_MODEL="fast-model",
        LLM_QUIZ_MODEL="quiz-model",
        LLM_FLASHCARD_MODEL="cards-model",
    )
    with app.app_context():
        yield app
    recorder._BINDING.set(None)


def _frames(raw):
    return [json.loads(frame[len("data: ") :]) for frame in raw]


class TestStreamedExamTurn:
    def test_general_turn_carries_the_exam_block_and_persists(self, exam_app):
        supabase = _ExamSupabase()
        general, quiz = _GeneralTool(), _QuizTool()
        planner = MagicMock()
        orch = ExamPrepOrchestrator(
            llm=planner, registry=ToolRegistry([general, quiz]), supabase=supabase
        )
        ctx = ExamPrepContext(
            user_id=USER,
            session_id=SESSION,
            message="explain projectile motion",
            plan=PLAN,
            topic=TOPIC,
            day={"id": "d1", "day_number": 1, "title": "Mechanics"},
        )
        frames = _frames(list(orch.run_stream(ctx)))
        done = frames[-1]
        assert done["done"] is True
        assert done["tool_used"] == "general"
        assert "".join(
            f["content"] for f in frames if isinstance(f.get("content"), str)
        ).startswith("Projectiles follow parabolas.")
        # No planner LLM call, no quiz-setup / clarification frame.
        planner.generate_structured.assert_not_called()
        assert not any(f.get("type") in {"quiz_setup", "clarification"} for f in frames)
        # The user message carries the exam context ids; the answer is saved.
        user_row, assistant_row = supabase.added
        assert user_row["role"] == "user"
        assert user_row["metadata"] == {"exam_topic_id": TOPIC_ID, "exam_day_id": "d1"}
        assert assistant_row["metadata"]["tool_used"] == "general"
        assert assistant_row["metadata"]["status"] == "completed"
        # The tool received the exam block through the personalization text.
        ((tool_ctx, params),) = general.calls
        assert params == {"query": "explain projectile motion"}
        assert "Exam Prep mode" in tool_ctx.personalization
        assert "Current topic: Physics: Kinematics" in tool_ctx.personalization
        assert "Current day: Day 1 — Mechanics" in tool_ctx.personalization
        # Titled sessions are never renamed; no space is touched.
        assert supabase.calls == []

    def test_quiz_turn_runs_the_generator_directly(self, exam_app):
        supabase = _ExamSupabase()
        general, quiz = _GeneralTool(), _QuizTool()
        orch = ExamPrepOrchestrator(
            llm=MagicMock(), registry=ToolRegistry([general, quiz]), supabase=supabase
        )
        ctx = ExamPrepContext(
            user_id=USER, session_id=SESSION, message="quiz me", plan=PLAN, topic=TOPIC
        )
        frames = _frames(list(orch.run_stream(ctx)))
        assert frames[-1]["done"] is True
        assert frames[-1]["tool_used"] == "quiz_generator"
        assert not any(f.get("type") == "quiz_setup" for f in frames)
        ((_ctx, params),) = quiz.calls
        assert params["topic"] == "Physics: Kinematics"
        assert params["target_exam"] == "jee_main"
        assert params["question_count"] == 5
        assert general.calls == []
        assert supabase.added[0]["metadata"] == {"exam_topic_id": TOPIC_ID}

    def test_standing_language_request_is_persisted_like_chat(self, exam_app):
        supabase = _ExamSupabase()
        general = _GeneralTool()
        orch = ExamPrepOrchestrator(
            llm=MagicMock(), registry=ToolRegistry([general]), supabase=supabase
        )
        ctx = ExamPrepContext(
            user_id=USER,
            session_id=SESSION,
            message="from now on explain in Hinglish",
            plan=PLAN,
        )
        frames = _frames(list(orch.run_stream(ctx)))
        assert frames[-1]["done"] is True
        ((name, fields),) = supabase.calls
        assert name == "update_learning_profile"
        assert fields["learning_profile"]["response_language"] == "Hinglish"
        # Applied to this turn too, through the personalization text.
        ((tool_ctx, _params),) = general.calls
        assert "Hinglish" in tool_ctx.personalization

    def test_plain_chat_session_is_rejected(self, exam_app):
        supabase = _ExamSupabase(kind="chat")
        orch = ExamPrepOrchestrator(
            llm=MagicMock(), registry=ToolRegistry([_GeneralTool()]), supabase=supabase
        )
        ctx = ExamPrepContext(
            user_id=USER, session_id=SESSION, message="hi", plan=PLAN
        )
        with pytest.raises(CustomError) as err:
            list(orch.run_stream(ctx))
        assert err.value.code == "NOT_FOUND"
        assert supabase.added == []
