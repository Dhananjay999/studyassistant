"""Exam Prep business logic: plans, lazy day detail, topic quizzes/cards.

Lazy by design: setup produces only the lightweight roadmap (one structured
LLM call); a day's detail is generated the first time it is opened, and a
topic's quiz / flashcards only on explicit request — through the same
``GenerationService`` the Quizzes / Flashcards pages use, so prompts,
grounding and persistence are shared with Chat.

The pure helpers (``match_target_exam``, ``normalize_plan``,
``validate_day_detail``, ``build_dashboard``) are module functions so they
can be unit-tested without Supabase or an LLM.
"""

import logging
import re
from collections.abc import Generator
from datetime import UTC, date, datetime
from typing import Any

from aeva.common.errors import ERROR_CODES, CustomError
from aeva.exam_prep.exam_prep_repository import ExamPrepRepository
from aeva.exam_prep.schema.exam_prep_schema import (
    CreateExamPlanData,
    ExamChatRequestData,
    LessonStreamData,
    TopicFlashcardsData,
    TopicQuizData,
    is_uuid,
)
from aeva.feature_flag import feature_flag_service
from aeva.generation.generation_service import GenerationService
from aeva.generation.schema.generation_schema import (
    SOURCE_FILES,
    SOURCE_TOPIC,
    FlashcardGenerateData,
    QuizGenerateData,
)
from aeva.llm import prompts
from aeva.llm.llm_client import LLMClient
from aeva.quiz import exam_patterns
from aeva.supabase.supabase_service import SupabaseService

logger = logging.getLogger(__name__)

FLAG_KEY = "exam_prep"
SESSION_KIND = "exam_prep"
MAX_PLAN_DAYS = 60
MAX_TOPICS_PER_DAY = 8
MIN_TOPIC_MINUTES = 10
MAX_TOPIC_MINUTES = 180
DEFAULT_TOPIC_MINUTES = 30
MAX_DESCRIPTION_CHARS = 160
MAX_STRATEGY_TIPS = 5
UPCOMING_DAYS = 7
DEFAULT_QUIZ_QUESTIONS = 5
DEFAULT_FLASHCARDS = 8
# Topic lessons: the markdown Aeva streams when a topic page opens.
MAX_LESSON_CHARS = 24000
# Rows fetched before filtering the coach history down to one topic.
TOPIC_HISTORY_FETCH = 200
# Web research brief fed into the roadmap prompt (and stored on the plan).
MAX_RESEARCH_CHARS = 3500
MAX_RESEARCH_SOURCES = 6
_EXAM_KIND_LABELS = {
    "school": "school exam (unit test / term / final)",
    "board": "board exam",
    "competitive": "competitive / entrance exam",
    "college": "college or university exam",
    "unit": "one subject or a few units / chapters (a small, focused test)",
    "other": "(not specified)",
}
STATUS_NOT_STARTED = "not_started"
STATUS_IN_PROGRESS = "in_progress"
STATUS_COMPLETED = "completed"
# Postgres unique_violation (postgrest APIError.code); raised by
# idx_exam_plans_one_active when two creates race.
_UNIQUE_VIOLATION = "23505"

# Exam-name needles → target_exam key. Labels and keys of every preset plus
# the bare "JEE" (→ JEE Main); the longest matching needle wins so "JEE
# Advanced" is never read as "JEE".
_EXAM_NEEDLES: tuple[tuple[str, str], ...] = tuple(
    sorted(
        {
            *(
                (str(exam_patterns.target_exam_label(key) or key).lower(), key)
                for key in exam_patterns.TARGET_EXAMS
            ),
            *(
                (key.replace("_", " "), key)
                for key in exam_patterns.TARGET_EXAMS
            ),
            *((key, key) for key in exam_patterns.TARGET_EXAMS),
            ("jee", "jee_main"),
        },
        key=lambda item: -len(item[0]),
    )
)


def today_utc() -> date:
    """Return the server's calendar date (UTC)."""
    return datetime.now(tz=UTC).date()


def _now_iso() -> str:
    return datetime.now(tz=UTC).isoformat()


def _text(value: Any) -> str:
    return str(value or "").strip()


def _as_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _str_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [_text(v) for v in value if _text(v)]


def _as_date(value: Any) -> date:
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value)[:10])


def _is_unique_violation(exc: BaseException) -> bool:
    """Tell a PostgREST unique_violation apart (duck-typed, no import)."""
    return str(getattr(exc, "code", "") or "") == _UNIQUE_VIOLATION


def topic_label(topic: dict[str, Any]) -> str:
    """``Subject: title`` for a topic row."""
    subject = _text(topic.get("subject"))
    title = _text(topic.get("title"))
    return f"{subject}: {title}" if subject else title


def match_target_exam(exam_name: str | None) -> str | None:
    """Map a free-text exam name onto a quiz ``target_exam`` key, or None."""
    text = _text(exam_name).lower()
    if not text:
        return None
    for needle, key in _EXAM_NEEDLES:
        if re.search(rf"(?<![a-z0-9]){re.escape(needle)}(?![a-z0-9])", text):
            return key
    return None


# ------------------------------------------------------------- normalise


def _normalize_topics(
    item: dict[str, Any] | None, subjects: list[str]
) -> list[dict[str, Any]]:
    """Flatten one LLM day's subjects → topics, cleaned and capped."""
    topics: list[dict[str, Any]] = []
    fallback_subject = subjects[0] if subjects else "General"
    for block in (item or {}).get("subjects") or []:
        if not isinstance(block, dict):
            continue
        subject = _text(block.get("subject")) or fallback_subject
        for raw in block.get("topics") or []:
            if not isinstance(raw, dict):
                continue
            title = _text(raw.get("title"))
            if not title:
                continue
            minutes = _as_int(raw.get("est_minutes")) or DEFAULT_TOPIC_MINUTES
            topics.append(
                {
                    "subject": subject,
                    "title": title,
                    "description": _text(raw.get("description"))[
                        :MAX_DESCRIPTION_CHARS
                    ],
                    "est_minutes": max(
                        MIN_TOPIC_MINUTES, min(MAX_TOPIC_MINUTES, minutes)
                    ),
                }
            )
            if len(topics) >= MAX_TOPICS_PER_DAY:
                return topics
    return topics


def normalize_plan(
    raw: Any, total_days: int, subjects: list[str]
) -> dict[str, Any]:
    """Make the LLM roadmap safe to store.

    Exactly ``total_days`` days numbered 1..N: duplicate, unnumbered or
    out-of-range days fill gaps in order, missing days are padded with a
    revision topic, extra days are dropped. Topic minutes are clamped, topics
    per day capped and strings trimmed. Raises ``ValueError`` when the output
    holds no days at all.
    """
    if not isinstance(raw, dict):
        raise TypeError("plan is not an object")
    by_number: dict[int, dict[str, Any]] = {}
    spare: list[dict[str, Any]] = []
    for item in raw.get("days") or []:
        if not isinstance(item, dict):
            continue
        number = _as_int(item.get("day_number"))
        in_range = number is not None and 1 <= number <= total_days
        if number is None or not in_range or number in by_number:
            spare.append(item)
        else:
            by_number[number] = item
    if not by_number and not spare:
        raise ValueError("plan has no days")

    pool = list(subjects) or ["General"]
    days: list[dict[str, Any]] = []
    for number in range(1, total_days + 1):
        item = by_number.get(number)
        if item is None and spare:
            item = spare.pop(0)
        topics = _normalize_topics(item, subjects)
        if not topics:
            subject = pool[(number - 1) % len(pool)]
            topics = [
                {
                    "subject": subject,
                    "title": f"Revise: {subject}",
                    "description": (
                        "Review this subject's weak areas and attempt "
                        "previous-year questions."
                    ),
                    "est_minutes": 60,
                }
            ]
        days.append(
            {
                "day_number": number,
                "title": _text((item or {}).get("title")) or f"Day {number}",
                "focus": _text((item or {}).get("focus")),
                "topics": topics,
            }
        )
    tips = _str_list(raw.get("strategy_tips"))[:MAX_STRATEGY_TIPS]
    return {
        "summary": _text(raw.get("summary")),
        "strategy_tips": tips,
        "days": days,
    }


def validate_day_detail(raw: Any, topic_ids: list[str]) -> dict[str, Any]:
    """Shape-check a generated day detail; unknown topic ids are dropped."""
    if not isinstance(raw, dict):
        raise TypeError("day detail is not an object")
    known = {str(t) for t in topic_ids}
    time_blocks: list[dict[str, Any]] = []
    for block in raw.get("time_blocks") or []:
        if not isinstance(block, dict):
            continue
        label = _text(block.get("label"))
        if not label:
            continue
        time_blocks.append(
            {
                "label": label,
                "minutes": max(0, _as_int(block.get("minutes")) or 0),
                "topic_ids": [
                    t for t in _str_list(block.get("topic_ids")) if t in known
                ],
            }
        )
    topics: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw.get("topics") or []:
        if not isinstance(item, dict):
            continue
        topic_id = _text(item.get("topic_id"))
        if topic_id not in known or topic_id in seen:
            continue
        seen.add(topic_id)
        topics.append(
            {
                "topic_id": topic_id,
                "objectives": _str_list(item.get("objectives")),
                "key_points": _str_list(item.get("key_points")),
                "practice": _str_list(item.get("practice")),
                "common_mistakes": _str_list(item.get("common_mistakes")),
            }
        )
    overview = _text(raw.get("overview"))
    if not overview and not topics:
        raise ValueError("day detail is empty")
    return {
        "overview": overview,
        "time_blocks": time_blocks,
        "topics": topics,
        "wrap_up": _text(raw.get("wrap_up")),
    }


# -------------------------------------------------------------- views


_TOPIC_FIELDS = (
    "id",
    "plan_id",
    "day_id",
    "subject",
    "title",
    "description",
    "est_minutes",
    "sort_order",
    "status",
    "status_updated_at",
    "quiz_id",
    "flashcard_set_id",
    "lesson_generated_at",
)
_PLAN_FIELDS = (
    "id",
    "status",
    "exam_name",
    "exam_date",
    "class_level",
    "stream",
    "subjects",
    "daily_minutes",
    "target_score",
    "syllabus_text",
    "material_media_ids",
    "session_id",
    "total_days",
    "plan_meta",
    "created_at",
    "updated_at",
)


def topic_view(
    topic: dict[str, Any], summaries: dict[str, dict[str, Any]]
) -> dict[str, Any]:
    """``ExamTopic`` response shape."""
    view = {key: topic.get(key) for key in _TOPIC_FIELDS}
    quiz_id = topic.get("quiz_id")
    view["quiz_summary"] = summaries.get(str(quiz_id)) if quiz_id else None
    # The lesson text itself travels only on the topic page (it is long).
    view["has_lesson"] = bool(
        _text(topic.get("lesson_md")) or topic.get("lesson_generated_at")
    )
    return view


def topic_turns(
    messages: list[dict[str, Any]], topic_id: str
) -> list[dict[str, Any]]:
    """Keep one topic's turns: its user messages and the reply after each.

    User messages sent from a topic page carry ``metadata.exam_topic_id``;
    the assistant reply that follows (same turn) carries nothing, so it is
    paired by position. Messages are expected oldest first.
    """
    kept: list[dict[str, Any]] = []
    take_reply = False
    for message in messages:
        meta = message.get("metadata") or {}
        if message.get("role") == "user":
            take_reply = str(meta.get("exam_topic_id") or "") == topic_id
            if take_reply:
                kept.append(message)
        elif take_reply:
            kept.append(message)
            take_reply = False
    return kept


def plan_view(plan: dict[str, Any]) -> dict[str, Any]:
    """``ExamPlan`` response shape."""
    view = {key: plan.get(key) for key in _PLAN_FIELDS}
    view["subjects"] = list(plan.get("subjects") or [])
    view["material_media_ids"] = list(plan.get("material_media_ids") or [])
    view["plan_meta"] = dict(plan.get("plan_meta") or {})
    return view


def day_summary(
    day: dict[str, Any], topics: list[dict[str, Any]]
) -> dict[str, Any]:
    """``ExamDaySummary``: a day with its topics grouped by subject."""
    groups: dict[str, list[dict[str, Any]]] = {}
    for topic in topics:
        groups.setdefault(str(topic.get("subject") or ""), []).append(topic)
    return {
        "id": day.get("id"),
        "plan_id": day.get("plan_id"),
        "day_number": day.get("day_number"),
        "date": str(day.get("date") or "")[:10],
        "title": day.get("title") or "",
        "focus": day.get("focus") or "",
        "has_detail": bool(day.get("detail")),
        "topic_count": len(topics),
        "completed_count": sum(
            1 for t in topics if t.get("status") == STATUS_COMPLETED
        ),
        "in_progress_count": sum(
            1 for t in topics if t.get("status") == STATUS_IN_PROGRESS
        ),
        "subjects": [
            {"subject": subject, "topics": items}
            for subject, items in groups.items()
        ],
    }


def build_dashboard(
    plan: dict[str, Any],
    days: list[dict[str, Any]],
    topics: list[dict[str, Any]],
    summaries: dict[str, dict[str, Any]],
    today: date,
) -> dict[str, Any]:
    """``ExamDashboard`` from the rows the repository returned (pure)."""
    by_day: dict[str, list[dict[str, Any]]] = {}
    for topic in sorted(topics, key=lambda t: int(t.get("sort_order") or 0)):
        by_day.setdefault(str(topic.get("day_id")), []).append(
            topic_view(topic, summaries)
        )
    day_views = [
        day_summary(day, by_day.get(str(day.get("id")), [])) for day in days
    ]
    today_iso = today.isoformat()
    today_view = next((d for d in day_views if d["date"] == today_iso), None)
    upcoming = [d for d in day_views if d["date"] > today_iso][:UPCOMING_DAYS]

    total = len(topics)
    completed = sum(1 for t in topics if t.get("status") == STATUS_COMPLETED)
    in_progress = sum(
        1 for t in topics if t.get("status") == STATUS_IN_PROGRESS
    )
    subjects_order = [str(s) for s in plan.get("subjects") or []]
    per_subject: dict[str, dict[str, Any]] = {
        s: {"subject": s, "total": 0, "completed": 0, "in_progress": 0}
        for s in subjects_order
    }
    for topic in topics:
        entry = per_subject.setdefault(
            str(topic.get("subject") or ""),
            {
                "subject": str(topic.get("subject") or ""),
                "total": 0,
                "completed": 0,
                "in_progress": 0,
            },
        )
        entry["total"] += 1
        if topic.get("status") == STATUS_COMPLETED:
            entry["completed"] += 1
        elif topic.get("status") == STATUS_IN_PROGRESS:
            entry["in_progress"] += 1

    exam_date = _as_date(plan.get("exam_date"))
    return {
        "plan": plan_view(plan),
        "days_remaining": max(0, (exam_date - today).days),
        "today_day_number": today_view["day_number"] if today_view else None,
        "progress": {
            "total_topics": total,
            "completed": completed,
            "in_progress": in_progress,
            "not_started": total - completed - in_progress,
            "percent": round(100 * completed / total) if total else 0,
        },
        "today": today_view,
        "upcoming": upcoming,
        "days": day_views,
        "subjects": list(per_subject.values()),
    }


def _material_notes(media: list[dict[str, Any]]) -> str:
    """Describe the uploaded material for the plan prompt (prompt only)."""
    names = [_text(m.get("file_name")) for m in media]
    names = [name for name in names if name]
    return ", ".join(names) if names else "(none)"


def _topic_lines(topics: list[dict[str, Any]]) -> str:
    """Topic list for the day-detail prompt."""
    if not topics:
        return "(no topics)"
    return "\n".join(
        f"- topic_id={t.get('id')} | {topic_label(t)} "
        f"({int(t.get('est_minutes') or 0)} min): "
        f"{_text(t.get('description')) or '(no description)'}"
        for t in topics
    )


# ------------------------------------------------------------- service


class ExamPrepService:
    """Exam Prep use cases (stateless; per-request instances are fine)."""

    def __init__(
        self,
        repo: ExamPrepRepository | None = None,
        supabase: SupabaseService | None = None,
        llm: LLMClient | None = None,
        generation: GenerationService | None = None,
        research_llm: LLMClient | None = None,
    ) -> None:
        self._repo = repo
        self._supabase = supabase
        self._llm = llm
        self._generation = generation
        self._research_llm = research_llm

    @property
    def repo(self) -> ExamPrepRepository:
        """Lazy repository."""
        if self._repo is None:
            self._repo = ExamPrepRepository(supabase=self._supabase)
        return self._repo

    @property
    def supabase(self) -> SupabaseService:
        """Lazy Supabase service (shared with the repository)."""
        if self._supabase is None:
            self._supabase = self.repo.supabase
        return self._supabase

    @property
    def llm(self) -> LLMClient:
        """Plan / day-detail model (``LLM_EXAM_PLAN_MODEL``)."""
        if self._llm is None:
            self._llm = LLMClient(config_key="LLM_EXAM_PLAN_MODEL")
        return self._llm

    @property
    def research_llm(self) -> LLMClient:
        """Search-grounded model for the syllabus research (web search)."""
        if self._research_llm is None:
            self._research_llm = LLMClient(config_key="LLM_WEB_SEARCH_MODEL")
        return self._research_llm

    @property
    def generation(self) -> GenerationService:
        """The direct quiz / flashcard creation service."""
        if self._generation is None:
            self._generation = GenerationService(supabase=self.supabase)
        return self._generation

    # ---------------------------------------------------------- gating

    @staticmethod
    def require_enabled() -> None:
        """404 unless the ``exam_prep`` flag is on."""
        if not feature_flag_service.is_enabled(FLAG_KEY):
            raise CustomError(ERROR_CODES["FEATURE_DISABLED"])

    # ----------------------------------------------------------- plans

    def load_plan(
        self, user_id: str, plan_id: str, *, active_only: bool = False
    ) -> dict[str, Any]:
        """Return the user's plan or raise ``EXAM_PLAN_NOT_FOUND``."""
        # A malformed path id would be a uuid cast error (500) in PostgREST.
        plan = None
        if is_uuid(plan_id):
            plan = self.repo.get_plan(plan_id, user_id)
        if not plan or (active_only and plan.get("status") != "active"):
            raise CustomError(ERROR_CODES["EXAM_PLAN_NOT_FOUND"])
        return plan

    def get_dashboard_for_user(self, user_id: str) -> dict[str, Any]:
        """Return the active plan's dashboard, or ``{"plan": None}``."""
        plan = self.repo.get_active_plan(user_id)
        if plan is None:
            return {"plan": None}
        return self._dashboard(plan)

    def _dashboard(self, plan: dict[str, Any]) -> dict[str, Any]:
        """Dashboard in ≤4 queries: plan (loaded), days, topics, attempts."""
        days = self.repo.list_days(plan["id"])
        topics = self.repo.list_topics(plan["id"])
        quiz_ids = [str(t["quiz_id"]) for t in topics if t.get("quiz_id")]
        summaries = (
            self.repo.quiz_summaries(plan["user_id"], quiz_ids)
            if quiz_ids
            else {}
        )
        return build_dashboard(plan, days, topics, summaries, today_utc())

    def _personalization(self, user_id: str) -> str:
        profile = self.supabase.get_profile(user_id)
        return prompts.build_identity_block(
            profile
        ) + prompts.build_personalization_block(profile)

    def research_syllabus(
        self, data: CreateExamPlanData, days_remaining: int
    ) -> tuple[str, list[dict[str, str]]]:
        """Web-research the official syllabus; ``("", [])`` on failure.

        Best effort by design: research must never fail or delay a plan more
        than one search-grounded call, so every error is logged and swallowed
        and the roadmap falls back to the model's own knowledge.
        """
        if not data.research:
            return "", []
        try:
            rendered = prompts.PromptBuilder.build(
                prompts.EXAM_SYLLABUS_RESEARCH_TEMPLATE,
                CURRENT_DATE=prompts.current_date(),
                EXAM_NAME=data.exam_name,
                EXAM_DATE=data.exam_date.isoformat(),
                DAYS_REMAINING=str(days_remaining),
                EXAM_KIND=_EXAM_KIND_LABELS.get(data.exam_kind, data.exam_kind),
                BOARD=_text(data.board) or "(not set)",
                CLASS_LEVEL=_text(data.class_level) or "(not set)",
                STREAM=_text(data.stream) or "(not set)",
                SUBJECTS=", ".join(data.subjects),
                EXAM_DETAILS=_text(data.exam_details) or "(none)",
            )
            brief = self.research_llm.generate(
                rendered.user_message,
                system_prompt=rendered.system_prompt,
                use_search=True,
                log_label="exam_syllabus_research",
            )
            sources = [
                {"title": _text(s.get("title")), "url": _text(s.get("url"))}
                for s in list(self.research_llm.last_sources or [])
                if isinstance(s, dict) and _text(s.get("url"))
            ][:MAX_RESEARCH_SOURCES]
        except Exception:  # noqa: BLE001 — research is best effort
            logger.warning("Exam syllabus research failed", exc_info=True)
            return "", []
        return _text(brief)[:MAX_RESEARCH_CHARS], sources

    def create_plan(
        self, user_id: str, data: CreateExamPlanData
    ) -> dict[str, Any]:
        """Generate the roadmap, store the plan and return its dashboard.

        Order matters for the student's current plan: the LLM runs first,
        the new plan is inserted ``archived`` (a transient state), its days,
        topics and coach session are written, and only the LAST step archives
        the current plan and flips the new one to ``active``. A failure at
        any point before that leaves the current plan untouched; a failure in
        the flip restores it (``_discard_plan``).
        """
        today = today_utc()
        days_remaining = max(0, (data.exam_date - today).days)
        total_days = min(max(days_remaining, 1), MAX_PLAN_DAYS)
        material = self.repo.owned_media(user_id, data.material_media_ids)
        # Exact syllabus / pattern for this exam, class and board (web).
        brief, sources = self.research_syllabus(data, days_remaining)
        rendered = prompts.PromptBuilder.build(
            prompts.EXAM_PLAN_TEMPLATE,
            EXAM_NAME=data.exam_name,
            EXAM_DATE=data.exam_date.isoformat(),
            DAYS_REMAINING=str(days_remaining),
            TOTAL_DAYS=str(total_days),
            EXAM_KIND=_EXAM_KIND_LABELS.get(data.exam_kind, data.exam_kind),
            BOARD=_text(data.board) or "(not set)",
            CLASS_LEVEL=data.class_level.strip() or "(not set)",
            STREAM=data.stream.strip() or "(not set)",
            SUBJECTS=", ".join(data.subjects),
            DAILY_MINUTES=str(data.daily_minutes),
            TARGET_SCORE=_text(data.target_score) or "(not set)",
            EXAM_DETAILS=_text(data.exam_details) or "(none)",
            SYLLABUS=_text(data.syllabus_text) or "(none provided)",
            MATERIAL_NOTES=_material_notes(material),
            RESEARCH_BRIEF=brief or "(no research available)",
            USER_PROFILE=prompts.user_profile_segment(
                self._personalization(user_id)
            ),
            CURRENT_DATE=prompts.current_date(),
        )
        try:
            raw = self.llm.generate_structured(
                rendered.user_message,
                prompts.EXAM_PLAN_SCHEMA,
                system_prompt=rendered.system_prompt,
                log_label="exam_plan",
            )
            roadmap = normalize_plan(raw, total_days, data.subjects)
        except Exception as exc:
            logger.exception("Exam plan generation failed")
            raise CustomError(ERROR_CODES["LLM_ERROR"]) from exc

        row = {
            "user_id": user_id,
            # Transient: flipped to "active" by _activate_plan, last.
            "status": "archived",
            "exam_name": data.exam_name,
            "exam_date": data.exam_date.isoformat(),
            "class_level": data.class_level.strip(),
            "stream": data.stream.strip(),
            "subjects": list(data.subjects),
            "daily_minutes": data.daily_minutes,
            "target_score": _text(data.target_score) or None,
            "syllabus_text": _text(data.syllabus_text) or None,
            "material_media_ids": [str(m["id"]) for m in material],
            "total_days": total_days,
            "plan_meta": {
                "summary": roadmap["summary"],
                "strategy_tips": roadmap["strategy_tips"],
                "model": self.llm.model,
                "generated_at": _now_iso(),
                "days_remaining_at_setup": days_remaining,
                "exam_kind": data.exam_kind,
                "board": _text(data.board),
                "exam_details": _text(data.exam_details),
                "research_brief": brief,
                "research_sources": sources,
            },
        }
        plan: dict[str, Any] | None = None
        archived: list[str] = []
        try:
            plan = self.repo.insert_plan(row)
            self.repo.insert_roadmap(plan["id"], today, roadmap["days"])
            plan = self.ensure_session(user_id, plan)
            plan = self._activate_plan(user_id, plan, archived)
        except Exception as exc:
            logger.exception("Exam plan persistence failed")
            if plan is not None:
                self._discard_plan(user_id, str(plan["id"]), archived)
            raise CustomError(ERROR_CODES["INTERNAL_ERROR"]) from exc
        return self._dashboard(plan)

    def _activate_plan(
        self, user_id: str, plan: dict[str, Any], archived: list[str]
    ) -> dict[str, Any]:
        """Archive the current plan and make ``plan`` the active one.

        Two creates racing (a double tap during the long synchronous call)
        can both archive and then collide on idx_exam_plans_one_active; the
        loser archives the winner and retries once, so the last request wins
        instead of surfacing a 500. ``archived`` collects every id this call
        archived, for ``_discard_plan``.
        """
        active = {"status": "active"}
        archived.extend(self.repo.archive_active_plans(user_id))
        try:
            updated = self.repo.update_plan(plan["id"], user_id, active)
        except Exception as exc:
            if not _is_unique_violation(exc):
                raise
            logger.warning("Concurrent exam plan creation; retrying once")
            archived.extend(self.repo.archive_active_plans(user_id))
            updated = self.repo.update_plan(plan["id"], user_id, active)
        return updated or {**plan, **active}

    def _discard_plan(
        self, user_id: str, plan_id: str, archived: list[str]
    ) -> None:
        """Best-effort rollback of a half-created plan.

        Removes the coach session first (the plan's ON DELETE SET NULL would
        otherwise orphan it), then the plan (days / topics cascade), then
        re-activates the plan archived last by ``_activate_plan`` so the
        student is never left without one.
        """
        try:
            self.repo.delete_plan_sessions(plan_id, user_id)
            self.repo.delete_plan(plan_id, user_id)
            if archived:
                self.repo.update_plan(
                    archived[-1], user_id, {"status": "active"}
                )
        except Exception:
            logger.exception("Exam plan rollback failed")

    def ensure_session(
        self, user_id: str, plan: dict[str, Any]
    ) -> dict[str, Any]:
        """Create the plan's dedicated coach session when it is missing."""
        if plan.get("session_id"):
            return plan
        session = self.supabase.create_session(
            user_id,
            title=f"Exam Prep · {plan.get('exam_name') or 'exam'}"[:80],
            mode="media",
            space_id=self.supabase.resolve_space(user_id, None),
            kind=SESSION_KIND,
            exam_plan_id=plan["id"],
        )
        updated = self.repo.update_plan(
            plan["id"], user_id, {"session_id": session["id"]}
        )
        return updated or {**plan, "session_id": session["id"]}

    def archive_plan(self, user_id: str, plan_id: str) -> dict[str, Any]:
        """Archive one plan (the student starts over)."""
        plan = self.load_plan(user_id, plan_id)
        if plan.get("status") != "archived":
            self.repo.update_plan(plan_id, user_id, {"status": "archived"})
        return {"id": plan_id, "status": "archived"}

    # ------------------------------------------------------------ days

    def get_day_detail(
        self, user_id: str, plan_id: str, day_id: str
    ) -> dict[str, Any]:
        """``ExamDayDetail``; generates and caches ``detail`` on first open.

        No lock: two concurrent first opens may both generate, and the
        second write wins. Acceptable in V1 (one extra call, same shape).
        """
        plan = self.load_plan(user_id, plan_id)
        day = self.repo.get_day(day_id, plan_id) if is_uuid(day_id) else None
        if not day:
            raise CustomError(ERROR_CODES["NOT_FOUND"])
        topics = self.repo.list_day_topics(day_id)
        if not day.get("detail"):
            days_remaining = max(
                0, (_as_date(plan.get("exam_date")) - today_utc()).days
            )
            number = day.get("day_number")
            rendered = prompts.PromptBuilder.build(
                prompts.EXAM_DAY_DETAIL_TEMPLATE,
                EXAM_NAME=_text(plan.get("exam_name")) or "the exam",
                DAYS_REMAINING=str(days_remaining),
                DAY_NUMBER=str(number),
                DAY_DATE=str(day.get("date") or "")[:10],
                DAY_TITLE=_text(day.get("title")) or f"Day {number}",
                DAY_FOCUS=_text(day.get("focus")) or "(none)",
                DAILY_MINUTES=str(plan.get("daily_minutes") or 120),
                TOPICS=_topic_lines(topics),
                USER_PROFILE=prompts.user_profile_segment(
                    self._personalization(user_id)
                ),
            )
            try:
                raw = self.llm.generate_structured(
                    rendered.user_message,
                    prompts.EXAM_DAY_DETAIL_SCHEMA,
                    system_prompt=rendered.system_prompt,
                    log_label="exam_day_detail",
                )
                detail = validate_day_detail(
                    raw, [str(t["id"]) for t in topics]
                )
            except Exception as exc:
                logger.exception("Exam day detail generation failed")
                raise CustomError(ERROR_CODES["LLM_ERROR"]) from exc
            day = self.repo.save_day_detail(day_id, detail) or {
                **day,
                "detail": detail,
            }
        quiz_ids = [str(t["quiz_id"]) for t in topics if t.get("quiz_id")]
        summaries = (
            self.repo.quiz_summaries(user_id, quiz_ids) if quiz_ids else {}
        )
        view = day_summary(day, [topic_view(t, summaries) for t in topics])
        view["detail"] = day.get("detail")
        return view

    # ---------------------------------------------------------- topics

    def get_topic_lesson(
        self, user_id: str, topic_id: str
    ) -> dict[str, Any]:
        """``ExamTopicLesson``: the topic, its day and the cached lesson."""
        topic, plan = self._load_topic(user_id, topic_id)
        day = self.repo.get_day(str(topic["day_id"]), str(plan["id"]))
        return {
            "plan_id": str(plan["id"]),
            "topic": self._topic_with_summary(user_id, topic),
            "day": (
                {
                    "id": day.get("id"),
                    "day_number": day.get("day_number"),
                    "title": day.get("title"),
                    "date": str(day.get("date") or "")[:10],
                }
                if day
                else None
            ),
            "lesson_md": _text(topic.get("lesson_md")) or None,
            "lesson_generated_at": topic.get("lesson_generated_at"),
        }

    def stream_topic_lesson(
        self, user_id: str, topic_id: str, data: LessonStreamData
    ) -> Generator[str, None, None]:
        """Stream the topic's lesson as SSE frames, caching it on first use.

        A cached lesson is replayed in one frame unless ``regenerate`` is
        set. The generated text is persisted only after the stream finished
        cleanly, and a fresh topic becomes in-progress — opening the lesson
        is the first act of studying it.
        """
        topic, plan = self._load_topic(user_id, topic_id)
        cached = _text(topic.get("lesson_md"))
        if cached and not data.regenerate:
            yield LLMClient.format_sse_chunk(cached)
            yield LLMClient.format_sse_chunk(
                "",
                done=True,
                extra={
                    "content": {
                        "lesson_md": cached,
                        "topic": self._topic_with_summary(user_id, topic),
                    }
                },
            )
            return
        day = self.repo.get_day(str(topic["day_id"]), str(plan["id"]))
        meta = plan.get("plan_meta") or {}
        days_remaining = max(
            0, (_as_date(plan.get("exam_date")) - today_utc()).days
        )
        day_context = "(none)"
        if day:
            title = _text(day.get("title"))
            day_context = f"Day {day.get('day_number')}: {title}"
            focus = _text(day.get("focus"))
            if focus:
                day_context += f" — {focus}"
        rendered = prompts.PromptBuilder.build(
            prompts.EXAM_TOPIC_LESSON_TEMPLATE,
            CURRENT_DATE=prompts.current_date(),
            EXAM_NAME=_text(plan.get("exam_name")) or "the exam",
            DAYS_REMAINING=str(days_remaining),
            EXAM_KIND=_EXAM_KIND_LABELS.get(
                str(meta.get("exam_kind") or "other"), "(not specified)"
            ),
            BOARD=_text(meta.get("board")) or "(not set)",
            CLASS_LEVEL=_text(plan.get("class_level")) or "(not set)",
            STREAM=_text(plan.get("stream")) or "(not set)",
            SUBJECT=_text(topic.get("subject")) or "(not set)",
            TOPIC_TITLE=_text(topic.get("title")),
            TOPIC_DESCRIPTION=_text(topic.get("description")) or "(none)",
            EST_MINUTES=str(topic.get("est_minutes") or DEFAULT_TOPIC_MINUTES),
            DAY_CONTEXT=day_context,
            SYLLABUS=_text(plan.get("syllabus_text"))[:4000] or "(none)",
            RESEARCH_BRIEF=_text(meta.get("research_brief"))
            or "(no research available)",
            USER_PROFILE=prompts.user_profile_segment(
                self._personalization(user_id)
            ),
        )
        lesson = ""
        for chunk in self.llm.generate_stream(
            rendered.user_message,
            system_prompt=rendered.system_prompt,
        ):
            if not chunk:
                continue
            lesson += chunk
            yield LLMClient.format_sse_chunk(chunk)
        lesson = lesson.strip()[:MAX_LESSON_CHARS]
        if not lesson:
            raise CustomError(ERROR_CODES["LLM_ERROR"])
        fields: dict[str, Any] = {}
        if topic.get("status") == STATUS_NOT_STARTED:
            fields = {
                "status": STATUS_IN_PROGRESS,
                "status_updated_at": _now_iso(),
            }
        saved = self.repo.save_topic_lesson(
            str(topic["id"]), str(plan["id"]), lesson
        )
        if fields:
            saved = self.repo.update_topic(
                str(topic["id"]), str(plan["id"]), fields
            ) or saved
        yield LLMClient.format_sse_chunk(
            "",
            done=True,
            extra={
                "content": {
                    "lesson_md": lesson,
                    "topic": self._topic_with_summary(
                        user_id, saved or {**topic, "lesson_md": lesson}
                    ),
                }
            },
        )

    def _load_topic(
        self, user_id: str, topic_id: str
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        """Topic + its plan, owner-checked through the plan."""
        topic = self.repo.get_topic(topic_id) if is_uuid(topic_id) else None
        if not topic:
            raise CustomError(ERROR_CODES["NOT_FOUND"])
        plan = self.repo.get_plan(str(topic["plan_id"]), user_id)
        if not plan:
            raise CustomError(ERROR_CODES["NOT_FOUND"])
        return topic, plan

    def update_topic_status(
        self, user_id: str, topic_id: str, status: str
    ) -> dict[str, Any]:
        """Set a topic's status; returns the updated ``ExamTopic``."""
        topic, _plan = self._load_topic(user_id, topic_id)
        updated = self.repo.update_topic(
            topic_id,
            str(topic["plan_id"]),
            {"status": status, "status_updated_at": _now_iso()},
        )
        if not updated:
            raise CustomError(ERROR_CODES["NOT_FOUND"])
        return self._topic_with_summary(user_id, updated)

    def _topic_with_summary(
        self, user_id: str, topic: dict[str, Any]
    ) -> dict[str, Any]:
        quiz_id = topic.get("quiz_id")
        summaries = (
            self.repo.quiz_summaries(user_id, [str(quiz_id)]) if quiz_id else {}
        )
        return topic_view(topic, summaries)

    def _link_topic(
        self, topic: dict[str, Any], fields: dict[str, Any]
    ) -> None:
        """Attach a generated artefact; a fresh topic becomes in-progress."""
        if topic.get("status") == STATUS_NOT_STARTED:
            fields = {
                **fields,
                "status": STATUS_IN_PROGRESS,
                "status_updated_at": _now_iso(),
            }
        self.repo.update_topic(str(topic["id"]), str(topic["plan_id"]), fields)

    def _source(
        self, user_id: str, plan: dict[str, Any]
    ) -> tuple[str, list[str]]:
        """Ground in the student's material when any still exists."""
        wanted = [str(m) for m in plan.get("material_media_ids") or []]
        if not wanted:
            return SOURCE_TOPIC, []
        owned = [str(m["id"]) for m in self.repo.owned_media(user_id, wanted)]
        return (SOURCE_FILES, owned) if owned else (SOURCE_TOPIC, [])

    def generate_topic_quiz(
        self, user_id: str, topic_id: str, opts: TopicQuizData
    ) -> dict[str, Any]:
        """Create a quiz on one topic (same path as the Quizzes page)."""
        topic, plan = self._load_topic(user_id, topic_id)
        source, media_ids = self._source(user_id, plan)
        data = QuizGenerateData(
            source=source,
            topic=topic_label(topic),
            media_ids=media_ids,
            space_id=None,
            question_count=opts.question_count or DEFAULT_QUIZ_QUESTIONS,
            difficulty=opts.difficulty,
            question_types=opts.question_types,
            target_exam=match_target_exam(plan.get("exam_name")),
            additional_instructions=prompts.format_quiz_instructions(
                _text(plan.get("exam_name")),
                _text(plan.get("class_level")),
                _text(topic.get("description")),
            ),
        )
        result = self.generation.create_quiz(user_id, data)["data"]
        self._link_topic(topic, {"quiz_id": result["quiz_id"]})
        return {
            "quiz_id": result["quiz_id"],
            "title": result.get("title"),
            "topic": result.get("topic"),
        }

    def generate_topic_flashcards(
        self, user_id: str, topic_id: str, opts: TopicFlashcardsData
    ) -> dict[str, Any]:
        """Create a flashcard set on one topic."""
        topic, plan = self._load_topic(user_id, topic_id)
        source, media_ids = self._source(user_id, plan)
        data = FlashcardGenerateData(
            source=source,
            topic=topic_label(topic),
            media_ids=media_ids,
            space_id=None,
            count=opts.count or DEFAULT_FLASHCARDS,
            additional_instructions=prompts.format_quiz_instructions(
                _text(plan.get("exam_name")),
                _text(plan.get("class_level")),
                _text(topic.get("description")),
            ),
        )
        result = self.generation.create_flashcards(user_id, data)["data"]
        self._link_topic(topic, {"flashcard_set_id": result["set_id"]})
        return {
            "set_id": result["set_id"],
            "title": result.get("title"),
            "topic": result.get("topic"),
        }

    # ------------------------------------------------------------ chat

    def list_messages(
        self,
        user_id: str,
        plan_id: str,
        limit: int,
        topic_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """Newest ``limit`` messages of the plan's session, oldest first.

        With ``topic_id`` only that topic's turns are returned, filtered
        from the newest ``TOPIC_HISTORY_FETCH`` rows (bounded read).
        """
        plan = self.load_plan(user_id, plan_id)
        session_id = plan.get("session_id")
        if not session_id:
            return []
        if not topic_id:
            return self.supabase.get_messages(str(session_id), limit=limit)
        rows = self.supabase.get_messages(
            str(session_id), limit=max(limit, TOPIC_HISTORY_FETCH)
        )
        return topic_turns(rows, topic_id)[-limit:]

    def chat_parts(
        self, user_id: str, plan_id: str, data: ExamChatRequestData
    ) -> dict[str, Any]:
        """Rows an exam-coach turn runs against: plan, day, topic, today.

        The plan must be active and gets its session lazily; a topic / day
        id that is not part of this plan is ignored rather than rejected.
        """
        plan = self.load_plan(user_id, plan_id, active_only=True)
        plan = self.ensure_session(user_id, plan)
        topic = None
        if data.topic_id:
            topic = self.repo.get_topic(data.topic_id)
            if topic and str(topic.get("plan_id")) != str(plan["id"]):
                topic = None
        day = None
        if data.day_id:
            day = self.repo.get_day(data.day_id, str(plan["id"]))
        if day is None and topic is not None:
            day = self.repo.get_day(str(topic["day_id"]), str(plan["id"]))
        today = self.repo.get_day_by_date(str(plan["id"]), today_utc())
        if today is not None:
            today = {
                **today,
                "topics": self.repo.list_day_topics(str(today["id"])),
            }
        return {"plan": plan, "day": day, "topic": topic, "today": today}
