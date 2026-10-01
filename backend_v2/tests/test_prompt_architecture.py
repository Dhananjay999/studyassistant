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

from unittest.mock import MagicMock, patch

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
from aeva.mcp.base import RESPONSE_NORMAL, ToolContext
from aeva.mcp.tools.general import GeneralAnswerTool
from aeva.mcp.tools.web_search import WebSearchTool
from aeva.orchestration.assistant_orchestrator import (
    AssistantOrchestrator,
    _is_pasted_material,
    _is_small_talk,
    _needs_fresh_info,
    _needs_web_upgrade,
    _standing_language_request,
)
from aeva.orchestration.model_candidates import models_for, resolve_model
from aeva.orchestration.models import AssistantContext

TEACHING_MARK = "Teaching protocol"
NUDGE_MARK = "upload the pages"


TODAY = "2026-09-27"


def _render_general() -> prompts.RenderedPrompt:
    return prompts.PromptBuilder.build(
        prompts.GENERAL_ANSWER_TEMPLATE,
        USER_MESSAGE="x",
        USER_PROFILE="",
        CURRENT_DATE=TODAY,
    )


def _render_web(intent: str | None = None) -> prompts.RenderedPrompt:
    return prompts.PromptBuilder.build(
        prompts.WEB_SEARCH_TEMPLATE,
        USER_MESSAGE="x",
        USER_PROFILE="",
        SEARCH_MODE=prompts.search_mode_block(intent),
        CURRENT_DATE=TODAY,
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
        assert "Study Material" not in prompts.SYSTEM_PROMPT
        assert "Study Spaces" not in prompts.SYSTEM_PROMPT

    def test_identity_and_voice_survive(self):
        assert "You are Aeva" in prompts.SYSTEM_PROMPT
        assert "samajh gayi" in prompts.SYSTEM_PROMPT


class TestTeachingBlockPlacement:
    def test_present_on_answer_templates(self):
        assert TEACHING_MARK in _render_general().system_prompt
        assert TEACHING_MARK in _render_web().system_prompt
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
        assert "Study Material" in rendered.user_message
        assert META_SENTINEL in rendered.user_message
        assert TEACHING_MARK not in rendered.system_prompt

    def test_planner_enum_includes_product_info(self):
        steps = prompts.PLAN_TURN_SCHEMA["properties"]["steps"]
        enum = steps["items"]["properties"]["tool"]["enum"]
        assert "product_info" in enum
        assert steps["maxItems"] == 4

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
    def test_accepts_document_fields(self):
        data = UpdateLearningProfileSchema().load({
            "context": {"type": "competitive_exam", "exam": "JEE"},
            "learning_traits": {
                "likes_funny_examples": True,
                "preferred_depth": "Deep",
            },
        })
        assert data.context["exam"] == "JEE"
        assert data.learning_traits["likes_funny_examples"] is True

    def test_rejects_unknown_trait_keys(self):
        with pytest.raises(ValidationError):
            UpdateLearningProfileSchema().load({
                "learning_traits": {"home_address": "nope"}
            })

    def test_profile_block_renders_document_fields(self):
        block = prompts.build_personalization_block({
            "personalization_status": "completed",
            "learning_profile": {
                "context": {"type": "competitive_exam", "exam": "JEE"},
                "learning_traits": {
                    "likes_funny_examples": True,
                    "preferred_depth": "Deep",
                },
            },
        })
        assert "Exam: JEE" in block
        assert "funny examples" in block
        assert "Preferred Depth: Deep" in block

    def test_language_applies_without_completed_onboarding(self):
        block = prompts.build_personalization_block({
            "personalization_status": "pending",
            "learning_profile": {"response_language": "Hinglish"},
        })
        assert "Response Language: Hinglish" in block
        # Other fields stay gated until onboarding completes.
        gated = prompts.build_personalization_block({
            "personalization_status": "pending",
            "learning_profile": {"context": {"exam": "JEE"}},
        })
        assert gated == ""


class TestWebSearchRouting:
    def test_commerce_cues_are_fresh_info(self):
        assert _needs_fresh_info("price of iphone 17")
        assert _needs_fresh_info("is the pixel 9 worth buying")
        assert _needs_fresh_info("google it: JEE 2026 syllabus")

    def test_product_intent_upgrades(self):
        assert _needs_web_upgrade("suggest the best iPhone 17 model")
        assert _needs_web_upgrade("top engineering colleges in pune for cse")
        assert _needs_web_upgrade("Pixel 9 vs iPhone 16, which is better?")

    def test_academic_questions_stay_general(self):
        assert not _needs_web_upgrade("compare mitosis vs meiosis")
        assert not _needs_web_upgrade("what is dictatorship?")
        assert not _needs_web_upgrade("best way to revise organic chemistry")

    def test_guess_intent(self):
        assert prompts.guess_search_intent("iPhone 17 vs 17 Pro") == "compare"
        assert prompts.guess_search_intent("suggest the best laptop") == (
            "recommend"
        )
        assert prompts.guess_search_intent("latest JEE news") == "news"
        assert prompts.guess_search_intent("who is the CEO of ISRO") == (
            "lookup"
        )

    def test_refine_plan_promotes_general_to_web(self):
        orch = AssistantOrchestrator(
            llm=MagicMock(), registry=MagicMock(), supabase=MagicMock()
        )
        ctx = AssistantContext(user_id="u", session_id="s", message="m")
        plan = {
            "action": "run_tool",
            "steps": [{"tool": "general", "params": {"query": "x"}}],
        }
        msg = "suggest the best iPhone 17 model for a student"
        with patch(
            "aeva.orchestration.assistant_orchestrator.feature_flag_service"
        ) as flags:
            flags.is_enabled.return_value = True
            out = orch._refine_plan(plan, ctx, msg, [])
        assert out["steps"][0]["tool"] == "web_search"
        assert out["steps"][0]["params"]["search_intent"] == "recommend"
        assert out["_upgraded"] is True

    def test_refine_plan_leaves_concepts_alone(self):
        orch = AssistantOrchestrator(
            llm=MagicMock(), registry=MagicMock(), supabase=MagicMock()
        )
        ctx = AssistantContext(user_id="u", session_id="s", message="m")
        plan = {
            "action": "run_tool",
            "steps": [{"tool": "general", "params": {"query": "x"}}],
        }
        with patch(
            "aeva.orchestration.assistant_orchestrator.feature_flag_service"
        ) as flags:
            flags.is_enabled.return_value = True
            out = orch._refine_plan(plan, ctx, "compare mitosis vs meiosis", [])
        assert out["steps"][0]["tool"] == "general"


PASTED_LIST = (
    "Here are the ATC important questions for IA preparation.\n\n"
    "2 MARK QUESTIONS\n"
    "1. Define Air Traffic Control (ATC).\n"
    "2. In which year was ICAO established?\n"
    "3. What event in 1903 marked the beginning of the aviation era?\n"
    "4. Which ICAO document lays down the separation standards?\n\n"
    "14 MARK QUESTIONS\n"
    "1. Discuss the Automation phase (1981-2001) in the history of ATC.\n"
    "2. Discuss NextGen to Digital Skies, from 2001 to the present (2026).\n"
    "Please prepare the questions under all categories, the paper may "
    "test the same concept using a different question wording.\n"
)


def _tool_ctx(message: str) -> ToolContext:
    return ToolContext(
        user_id="u",
        session_id="s",
        message=message,
        enriched_message=message,
        media_ids=None,
    )


class TestPastedMaterial:
    def test_pasted_list_is_detected(self):
        assert _needs_fresh_info(PASTED_LIST)
        assert _is_pasted_material(PASTED_LIST)
        assert not _needs_web_upgrade(PASTED_LIST)

    def test_short_or_search_messages_are_not_pasted(self):
        assert not _is_pasted_material("what is the JEE 2026 exam date?")
        assert not _is_pasted_material(PASTED_LIST + "\nsearch the web")

    def test_refine_plan_keeps_pasted_list_on_general(self):
        orch = AssistantOrchestrator(
            llm=MagicMock(), registry=MagicMock(), supabase=MagicMock()
        )
        ctx = AssistantContext(user_id="u", session_id="s", message="m")
        plan = {
            "action": "run_tool",
            "steps": [{"tool": "general", "params": {"query": "x"}}],
        }
        with patch(
            "aeva.orchestration.assistant_orchestrator.feature_flag_service"
        ) as flags:
            flags.is_enabled.return_value = True
            out = orch._refine_plan(plan, ctx, PASTED_LIST, [])
        assert out["steps"][0]["tool"] == "general"

    def test_planner_note_is_empty_without_a_restatement(self):
        assert prompts.planner_note_segment("hello", None) == ""
        assert prompts.planner_note_segment("hello", " hello ") == ""
        assert "organise" in prompts.planner_note_segment("hello", "organise")

    def test_tools_send_the_full_message(self):
        params = {"query": "organise ATC question list"}
        ctx = _tool_ctx(PASTED_LIST)
        general = GeneralAnswerTool._render(ctx, params).user_message
        web, _query, _intent = WebSearchTool._render(ctx, params)
        for text in (general, web.user_message):
            assert "In which year was ICAO established?" in text
            assert "organise ATC question list" in text

    def test_same_query_renders_unchanged(self):
        ctx = _tool_ctx("what is osmosis?")
        with_query = GeneralAnswerTool._render(
            ctx, {"query": "what is osmosis?"}
        )
        without = GeneralAnswerTool._render(ctx, {})
        assert with_query.user_message == without.user_message

    def test_answer_rules_cover_pasted_material_and_audio(self):
        system = _render_general().system_prompt
        assert "never ask the student to paste or upload it again" in system
        assert "You cannot produce audio, video, or files" in system


class TestWebSearchTemplate:
    def test_every_intent_renders(self):
        for intent in prompts.SEARCH_INTENTS:
            rendered = _render_web(intent)
            assert TODAY in rendered.user_message
            assert META_SENTINEL in rendered.user_message

    def test_compare_asks_for_a_table(self):
        assert "comparison table" in _render_web("compare").user_message
        assert "ONE clear pick" in _render_web("recommend").user_message

    def test_params_carry_intent_enum(self):
        enum = prompts.WEB_SEARCH_PARAMS["properties"]["search_intent"]["enum"]
        assert enum == list(prompts.SEARCH_INTENTS)

    def test_planner_has_examples_date_and_no_fence(self):
        planner = prompts.PLAN_TURN_TEMPLATE.user
        assert "search_intent" in planner
        assert "iPhone 17" in planner
        assert "{CURRENT_DATE}" in planner
        assert "```" not in planner

    def test_general_prompt_is_date_aware(self):
        text = _render_general().user_message
        assert TODAY in text
        assert "never guess specs, prices, or dates" in text
