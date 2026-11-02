"""Study-plan intent in chat: hand the student to the Exam Prep setup card.

A third of chat users (19 of 58 in the week of 2026-10-22) typed "make me a
study plan" / "how do I prepare for my exam" into chat. The planner then
asked the same questions the Exam Prep setup form collects (class, board,
date), 9 of 25 such clarifications were never answered, and the built
feature was reached by 7 of those 19 students on their own. The exam-soon
offer (``exam_offer``) only fires on an explicit near date.

This module spots the plan intent itself, deterministically, and resolves
what the turn should do about it:

- no active plan and the feature is on: the answer carries the setup card
  (``exam_prep_offer`` with ``date_hint = "none"``: the student picks the
  date on the card) and the planner is told not to clarify;
- an active plan exists: the answer points the student to it instead.
"""

import logging
import re
from dataclasses import dataclass
from typing import Any

from aeva.orchestration import exam_offer
from aeva.supabase.supabase_service import SupabaseService

logger = logging.getLogger(__name__)

SOURCE = "plan_intent"
# Longer messages are pasted material or a detailed request.
MAX_WORDS = 80

_PLAN_RE = re.compile(
    r"\b(?:"
    r"study\s*plan|studyplan|time\s*table|timetable|study\s+schedule|"
    r"study\s+routine|revision\s+(?:plan|schedule|timetable|strategy)|"
    r"preparation\s+(?:plan|strategy|schedule|routine)|prep\s+plan|"
    r"(?:how|what)\s+(?:do|should|can|to)\s+i\s+(?:prepare|study|revise)|"
    r"how\s+to\s+(?:prepare|study|revise|crack|clear)|"
    r"prepare\s+me|help\s+me\s+(?:prepare|study|revise)|"
    r"guide\s+me\s+(?:to|for)\s+(?:prepare|crack|clear|my\s+exam)|"
    r"plan\s+(?:for|to)\s+(?:my\s+|the\s+)?(?:exams?|boards?|tests?|papers?|"
    r"semester|sem|neet|jee|upsc|ssc|cuet|finals?)|"
    r"(?:crack|clear|pass|ace)\s+(?:the\s+|my\s+)?(?:exams?|boards?|neet|jee|"
    r"upsc|ssc|cuet|finals?)|"
    r"strategy\s+(?:for|to)\s+(?:my\s+)?(?:exams?|prepare|crack|boards?)|"
    r"padhai\s+ka\s+plan|tayy?ari\s+(?:kaise|ka\s+plan)|"
    r"kaise\s+(?:padhu|padhun|prepare\s+karu|tayy?ari\s+karu)"
    r")\b",
    re.IGNORECASE,
)
# "plan" said about something that is not studying.
_NOT_STUDY_RE = re.compile(
    r"\b(?:lesson\s+plan|business\s+plan|floor\s+plan|diet\s+plan|"
    r"workout\s+plan|travel\s+plan|trip|project\s+plan|marketing\s+plan)\b",
    re.IGNORECASE,
)


def detect(message: str) -> bool:
    """Whether the message asks for a study plan or how to prepare."""
    text = (message or "").strip()
    if not text or len(text.split()) > MAX_WORDS:
        return False
    if _NOT_STUDY_RE.search(text):
        return False
    return bool(_PLAN_RE.search(text))


@dataclass(frozen=True)
class PlanIntent:
    """What a plan-intent turn should do."""

    detected: bool = False
    # The setup-card payload to send beside the answer (None: no card).
    offer: dict[str, Any] | None = None
    # The student already has an active plan: point them to it.
    has_plan: bool = False

    @property
    def wants_card(self) -> bool:
        """The answer should carry the setup card."""
        return self.detected and self.offer is not None


NONE = PlanIntent()


def resolve(ctx: Any, supabase: SupabaseService) -> PlanIntent:
    """Resolve the plan intent of this chat turn. Never raises.

    Only a message the student typed can carry it (same rule as
    ``exam_offer``): clarification replies, card actions and the quiz /
    flashcard forms never do. The feature flag and the active-plan lookup
    run only after the words matched, so an ordinary turn pays nothing.
    """
    if not exam_offer.is_typed_turn(ctx) or not detect(ctx.message):
        return NONE
    try:
        if not exam_offer.feature_enabled():
            return PlanIntent(detected=True)
        if exam_offer.has_active_plan(ctx.user_id, supabase):
            return PlanIntent(detected=True, has_plan=True)
        name, subjects = exam_offer.prefill(ctx.message)
        return PlanIntent(
            detected=True,
            offer={
                "exam_name": name,
                "date_hint": exam_offer.KIND_NONE,
                "days_ahead": None,
                "weekday": None,
                "day": None,
                "month": None,
                "year": None,
                "subjects": subjects,
                "source": SOURCE,
            },
        )
    except Exception:
        # The hand-off is optional: never let it cost the answer.
        logger.exception("Plan intent resolution failed")
        return NONE


# Appended to the message the tools see (never to the persisted user
# message), so the answer works with the card instead of repeating the
# setup questions in prose. The deterministic routers read the same text,
# so these notes must not contain generator words (quiz, flashcard, test,
# draw, image...) or they would open the quiz form or an image step.
CARD_HINT = (
    "\n\n[Note for Aeva: an Exam Prep setup card is shown right under this "
    "answer. Give brief, concrete study advice for what was asked (at most "
    "a few short paragraphs), then end by telling the student to fill in "
    "the card below to get a day-by-day plan with topics and practice for "
    "every day. Do not ask for class, board, subjects or dates: the card "
    "collects them.]"
)
HAS_PLAN_HINT = (
    "\n\n[Note for Aeva: the student already has an active exam plan on the "
    "Exam Prep page (sidebar > Exam Prep). Answer briefly, then point them "
    "there: today's topics are on the dashboard, and \"Edit plan\" changes "
    "subjects, dates or chapters already covered without losing progress. "
    "Do not build a new schedule in text.]"
)


def hint_for(intent: PlanIntent) -> str:
    """The tool-facing note for this intent ("" when there is none)."""
    if intent.wants_card:
        return CARD_HINT
    if intent.detected and intent.has_plan:
        return HAS_PLAN_HINT
    return ""


# Planner-facing instruction: the card (or the existing plan) answers the
# "missing information", so clarifying is wrong here.
PLANNER_HINT = (
    "\nThe student is asking for a study plan or how to prepare. The Exam "
    "Prep setup card is shown with the answer (or the student already has "
    "a plan), so the class, board, subjects and date are collected there: "
    "choose run_tool with the `general` tool and do NOT clarify."
)


def planner_hint(intent: PlanIntent) -> str:
    """The planner note for this intent ("" when there is none)."""
    if intent.wants_card or (intent.detected and intent.has_plan):
        return PLANNER_HINT
    return ""
