"""Prompt-architecture contracts: lean base prompt + intent-routed knowledge.

Pure renders and imports — no LLM calls. Guards the P0 restructure:
- SYSTEM_PROMPT stays lean (no app copy), identity/voice survive.
- TEACHING block ships ONLY on answer templates (general/web_search/media),
  never on generators or the planner.
- product_info owns the app knowledge and is fully wired (template, registry,
  planner enum, model candidates, no feature-flag gate).
- The small-talk fast path never swallows app questions.
- Standing-language requests are detected; one-off language asks are not.
"""

from unittest.mock import MagicMock

import pytest
from flask import Flask
from marshmallow import ValidationError

from aeva.containers import build_tool_registry
from aeva.feature_flag.feature_flag_service import TOOL_FLAG_MAP
from aeva.learning_profile.schema.learning_profile_schema import (
    UpdateLearningProfileSchema,
)
from aeva.llm import prompts
from aeva.llm.prompts.response_meta import META_SENTINEL
from aeva.mcp.base import RESPONSE_NORMAL
from aeva.orchestration.assistant_orchestrator import (
    _is_small_talk,
    _standing_language_request,
)
from aeva.orchestration.model_candidates import models_for, resolve_model

TEACHING_MARK = "Teaching protocol"
NUDGE_MARK = "upload the pages"


def _render_general() -> prompts.RenderedPrompt:
    return prompts.PromptBuilder.build(
        prompts.GENERAL_ANSWER_TEMPLATE, USER_MESSAGE="x", USER_PROFILE=""
    )


def _render_quiz() -> prompts.RenderedPrompt:
    return prompts.PromptBuilder.build(
        prompts.QUIZ_GENERATION_TEMPLATE,
        TOPIC="t",
        QUESTION_COUNT="5",
        DIFFICULTY="easy",
        QUESTION_TYPES="single_select",
        RECENT_CONTEXT="x",
        ADDITIONAL_INSTRUCTIONS="(none)",
        USER_PROFILE="",
    )


class TestLeanSystemPrompt:
    def test_app_copy_removed(self):
        assert "Media Library" not in prompts.SYSTEM_PROMPT
        assert "Study Spaces" not in prompts.SYSTEM_PROMPT

    def test_identity_and_voice_survive(self):
        assert "You are Aeva" in prompts.SYSTEM_PROMPT
        assert "samajh gayi" in prompts.SYSTEM_PROMPT


class TestTeachingBlockPlacement:
    def test_present_on_answer_templates(self):
        assert TEACHING_MARK in _render_general().system_prompt
        web = prompts.PromptBuilder.build(
            prompts.WEB_SEARCH_TEMPLATE, USER_MESSAGE="x", USER_PROFILE=""
        )
        assert TEACHING_MARK in web.system_prompt
        media = prompts.PromptBuilder.build(
            prompts.MEDIA_TEMPLATE,
            USER_MESSAGE="x",
            DOCUMENT_CONTEXT="(none)",
            USER_PROFILE="",
        )
        assert TEACHING_MARK in media.system_prompt

    def test_absent_from_generators_and_planner(self):
        quiz = _render_quiz()
        assert TEACHING_MARK not in quiz.system_prompt
        assert TEACHING_MARK not in quiz.user_message
        assert TEACHING_MARK not in prompts.PLAN_TURN_TEMPLATE.system

    def test_textbook_nudge_moved(self):
        assert NUDGE_MARK not in prompts.SYSTEM_PROMPT
        assert NUDGE_MARK in _render_general().system_prompt


class TestProductInfoWiring:
    def test_template_carries_knowledge_and_meta_trailer(self):
        rendered = prompts.PromptBuilder.build(
            prompts.PRODUCT_INFO_TEMPLATE,
            USER_MESSAGE="how do I upload a pdf?",
            USER_PROFILE="",
        )
        assert "Media Library" in rendered.user_message
        assert META_SENTINEL in rendered.user_message
        assert TEACHING_MARK not in rendered.system_prompt

    def test_planner_enum_includes_product_info(self):
        enum = prompts.PLAN_TURN_SCHEMA["properties"]["tool"]["properties"][
            "name"
        ]["enum"]
        assert "product_info" in enum

    def test_registered_streaming_normal_tool(self):
        registry = build_tool_registry(
            *(MagicMock() for _ in range(7)), supabase=MagicMock()
        )
        tool = registry.get("product_info")
        assert tool.definition.name == "product_info"
        assert tool.can_stream()
        assert tool.response_type == RESPONSE_NORMAL

    def test_never_feature_flag_gated(self):
        assert "product_info" not in TOOL_FLAG_MAP

    def test_model_candidates_resolve_to_fast_model(self):
        app = Flask(__name__)
        app.config["LLM_FAST_MODEL"] = "fast-x"
        with app.app_context():
            assert models_for("product_info") == ["fast-x"]
            assert resolve_model("product_info", "bogus") == "fast-x"


class TestFastPathGate:
    def test_small_talk_still_fast(self):
        assert _is_small_talk("hi")
        assert _is_small_talk("thanks!")

    def test_app_and_academic_questions_reach_planner(self):
        assert not _is_small_talk("what can you do?")
        assert not _is_small_talk("how do I upload a pdf?")
        assert not _is_small_talk("what is dictatorship?")


class TestStandingLanguageRequest:
    def test_detects_standing_requests(self):
        assert (
            _standing_language_request("from now onwards talk with me in hinglish")
            == "Hinglish"
        )
        assert (
            _standing_language_request("hamesha hindi me baat karo") == "Hindi"
        )
        assert (
            _standing_language_request("always answer in English") == "English"
        )

    def test_ignores_one_off_language_asks(self):
        assert _standing_language_request("explain this in hindi") is None
        assert _standing_language_request("in english") is None
        assert _standing_language_request("from now on keep answers short") is None


class TestLearningProfileSchema:
    def test_accepts_new_fields(self):
        data = UpdateLearningProfileSchema().load({
            "exam_target": "JEE",
            "learning_traits": {
                "likes_funny_examples": True,
                "preferred_depth": "Deep",
            },
        })
        assert data.exam_target == "JEE"
        assert data.learning_traits["likes_funny_examples"] is True

    def test_rejects_unknown_trait_keys(self):
        with pytest.raises(ValidationError):
            UpdateLearningProfileSchema().load({
                "learning_traits": {"home_address": "nope"}
            })

    def test_profile_block_renders_new_fields(self):
        block = prompts.build_personalization_block({
            "personalization_status": "completed",
            "exam_target": "JEE",
            "learning_traits": {
                "likes_funny_examples": True,
                "preferred_depth": "Deep",
            },
        })
        assert "Exam Target: JEE" in block
        assert "funny examples" in block
        assert "Preferred Depth: Deep" in block

    def test_language_applies_without_completed_onboarding(self):
        block = prompts.build_personalization_block({
            "personalization_status": "pending",
            "preferred_language": "Hinglish",
        })
        assert "Preferred Language: Hinglish" in block
        # Other fields stay gated until onboarding completes.
        gated = prompts.build_personalization_block({
            "personalization_status": "pending",
            "exam_target": "JEE",
        })
        assert gated == ""
