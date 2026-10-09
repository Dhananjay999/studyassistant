"""Web-search upgrade cues (pure; no LLM or DB).

Guards the fix for study questions being forced onto the 40-90 s web-search
path because they contained "today", "currently", "right now" or a year:
the upgrade now needs a product/choice cue or a cue about the SUBJECT being
fresh, never a bare time adverb, and study-shaped or long requests trust
the planner's choice.
"""

import pytest

from aeva.feature_flag import feature_flag_service
from aeva.orchestration.assistant_orchestrator import (
    AssistantOrchestrator,
    _is_study_shaped,
    _needs_fresh_info,
    _needs_web_upgrade,
)

# The five real turns the planner routed to `general` and the old rule
# promoted to web_search (reasons: "today", "right now", "currently").
MISROUTED = (
    "give me a complete formula sheet of thermodynamics, my exam is today",
    "thermodynamics formula sheet with all formulas for class 11, test today",
    "I need every formula of thermodynamics chapter today please",
    "Hindi SA1 grammar revision, help me revise right now",
    "im currently working on the topic ww2, explain the main causes",
)

# Genuine product / fresh-information questions that must still upgrade.
GENUINE = (
    "latest iPhone price in India",
    "suggest the best iPhone 17 model for a student",
    "best laptops under 50000 for engineering students",
    "Pixel 9 vs iPhone 16, which is better?",
    "when is the JEE exam date?",
    "what are today's news headlines",
    "what is the weather today?",
)


@pytest.fixture(autouse=True)
def _web_search_on(monkeypatch):
    monkeypatch.setattr(
        feature_flag_service, "is_enabled", lambda *_a, **_k: True
    )
    monkeypatch.setattr(
        feature_flag_service,
        "get_flags",
        lambda: {"web_search": True, "image_generation": True},
    )


def _general(query: str) -> dict:
    return {
        "action": "run_tool",
        "steps": [{"tool": "general", "params": {"query": query}}],
    }


def _tool_after_upgrade(message: str) -> str:
    plan = AssistantOrchestrator._web_upgrade(_general(message), message)
    return plan["steps"][0]["tool"]


class TestBareAdverbsAreNotCues:
    @pytest.mark.parametrize("message", MISROUTED)
    def test_misrouted_study_messages_stay_general(self, message):
        assert not _needs_web_upgrade(message), message
        assert _tool_after_upgrade(message) == "general"

    @pytest.mark.parametrize(
        "message",
        [
            "I'm currently on chapter 3",
            "exam today, wish me luck",
            "what should I study tonight",
            "explain this right now please",
            "I recently learnt about osmosis, explain more",
            "class of 2026 board exam preparation",
            "the nepali paper of 2082",
            "as of now I know only integration",
        ],
    )
    def test_time_words_and_years_alone_never_match(self, message):
        assert not _needs_fresh_info(message)
        assert not _needs_web_upgrade(message)


class TestGenuineLookupsStillUpgrade:
    @pytest.mark.parametrize("message", GENUINE)
    def test_product_and_fresh_subject_cues_upgrade(self, message):
        assert _needs_web_upgrade(message), message
        assert _tool_after_upgrade(message) == "web_search"

    def test_commerce_cues_remain_fresh_info(self):
        assert _needs_fresh_info("price of iphone 17")
        assert _needs_fresh_info("is the pixel 9 worth buying")
        assert _needs_fresh_info("google it: JEE 2026 syllabus")

    def test_explicit_search_request_beats_study_words(self):
        message = "search the web for the latest NCERT syllabus changes"
        assert not _is_study_shaped(message)
        assert _needs_web_upgrade(message)


class TestStudyShapedRequestsTrustThePlanner:
    @pytest.mark.parametrize(
        "message",
        [
            "latest formula sheet for class 12 physics",
            "give me revision notes on the newest chapter",
            "what is the price elasticity chapter about in my syllabus",
            "homework: list the latest news about ICAO in 1944",
        ],
    )
    def test_study_words_skip_the_upgrade(self, message):
        assert _is_study_shaped(message)
        assert not _needs_web_upgrade(message)

    def test_long_requests_skip_the_upgrade(self):
        words = ["please"] * 26
        message = " ".join(words) + " suggest the best phones"
        assert _is_study_shaped(message)
        assert not _needs_web_upgrade(message)
        assert _tool_after_upgrade(message) == "general"

    def test_short_product_question_is_not_study_shaped(self):
        assert not _is_study_shaped("best phones under 20000")

    def test_subject_terms_that_used_to_match_are_safe(self):
        # physics "temperature", chemistry "energy released", stats "z-score"
        for message in (
            "define temperature and its SI unit",
            "how much energy is released when ATP is hydrolysed",
            "explain the z-score formula",
            "what is opportunity cost in economics",
        ):
            assert not _needs_web_upgrade(message), message
