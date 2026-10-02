"""Exam-level quizzes: research the exam's question pattern, then match it."""

from typing import Any
from unittest.mock import MagicMock

import pytest
from flask import Flask

from aeva.assistant.schema.assistant_schema import QuizOptionsSchema
from aeva.llm import prompts
from aeva.mcp.base import ToolContext
from aeva.mcp.tools.quiz_generator import QuizGeneratorTool
from aeva.quiz.exam_research import ExamResearch, ExamResearchService


@pytest.fixture
def app_ctx():
    app = Flask(__name__)
    app.config["QUIZ_MAX_QUESTIONS"] = 10
    with app.app_context():
        yield


def _ctx() -> ToolContext:
    return ToolContext(
        user_id="u1",
        session_id="s1",
        message="quiz",
        enriched_message="quiz on percentages",
        media_ids=None,
    )


def _tool(brief: str = "Mostly 4-option arithmetic word problems.") -> tuple[
    QuizGeneratorTool, MagicMock, MagicMock
]:
    llm = MagicMock()
    llm.generate_structured.return_value = {
        "title": "Percentages",
        "topic": "Percentages",
        "questions": [
            {
                "type": "single_select",
                "prompt": "q",
                "options": ["a", "b", "c", "d"],
                "correct_answers": ["a"],
            }
        ],
    }
    repo = MagicMock()
    repo.create.side_effect = lambda **kw: {
        "id": "quiz-1",
        "title": kw["quiz_data"]["title"],
        "topic": kw["quiz_data"]["topic"],
        "questions": kw["quiz_data"]["questions"],
    }
    research = MagicMock()
    research.research.side_effect = lambda exam, topic: ExamResearch(
        exam=exam, brief=brief
    )
    tool = QuizGeneratorTool(
        llm=llm,
        quiz_repo=repo,
        supabase=MagicMock(),
        retrieval=MagicMock(),
        exam_research=research,
    )
    return tool, llm, research


def _prompt(llm: MagicMock) -> str:
    return llm.generate_structured.call_args.args[0]


def test_target_exam_researches_and_steers_the_prompt(app_ctx) -> None:
    tool, llm, research = _tool()

    result = tool.execute(
        _ctx(),
        {"topic": "Percentages", "target_exam": "ssc_cgl", "difficulty": "easy"},
    )

    research.research.assert_called_once_with("SSC CGL", "Percentages")
    prompt = _prompt(llm)
    assert "Difficulty: SSC CGL exam level" in prompt
    assert "Target exam: SSC CGL" in prompt
    assert "Mostly 4-option arithmetic word problems." in prompt
    # The exam's preset question type applies when none was picked.
    assert "Question types: single_select" in prompt
    saved = tool.quiz_repo.create.call_args.kwargs["quiz_data"]
    assert saved["difficulty"] == "exam"
    assert result["target_exam"] == "ssc_cgl"


def test_failed_research_still_targets_the_exam(app_ctx) -> None:
    tool, llm, _ = _tool(brief="")

    tool.execute(_ctx(), {"topic": "Percentages", "target_exam": "neet"})

    prompt = _prompt(llm)
    assert "Target exam: NEET" in prompt
    assert "Follow the NEET previous-year pattern as you know it." in prompt


def test_no_or_unknown_exam_keeps_the_difficulty_band(app_ctx) -> None:
    for params in (
        {"topic": "Percentages", "difficulty": "hard"},
        {"topic": "Percentages", "difficulty": "hard", "target_exam": "x"},
    ):
        tool, llm, research = _tool()

        result = tool.execute(_ctx(), params)

        research.research.assert_not_called()
        assert "Difficulty: hard" in _prompt(llm)
        assert "Target exam" not in _prompt(llm)
        assert result["difficulty"] == "hard"
        assert result["target_exam"] is None


def test_research_uses_search_and_survives_errors(app_ctx) -> None:
    llm = MagicMock()
    llm.generate.return_value = "  brief  "
    llm.last_sources = [{"title": "PYQ analysis", "url": "https://x"}]

    found = ExamResearchService(llm=llm).research("SSC CGL", "")

    assert found.brief == "brief"
    assert found.sources == [{"title": "PYQ analysis", "url": "https://x"}]
    assert llm.generate.call_args.kwargs["use_search"] is True
    assert "General SSC CGL preparation" in llm.generate.call_args.args[0]

    llm.generate.side_effect = RuntimeError("quota")
    assert ExamResearchService(llm=llm).research("SSC CGL", "x") == (
        ExamResearch(exam="SSC CGL")
    )


def test_quiz_options_accept_only_known_target_exams() -> None:
    schema = QuizOptionsSchema()
    assert schema.load({"target_exam": "ssc_cgl"})["target_exam"] == "ssc_cgl"
    for bad in ("custom", "nope"):
        with pytest.raises(Exception):  # noqa: B017, PT011
            schema.load({"target_exam": bad})


def test_exam_pattern_segment_without_brief() -> None:
    segment: Any = prompts.exam_pattern_segment("GATE")
    assert "Follow the GATE previous-year pattern" in segment
    assert "never reproduce a real question verbatim" in segment
