"""Pure spaced-repetition logic for AI Revision Mode.

Everything here is deterministic and I/O-free so the scheduling rules are
unit-testable in isolation. The reason strings are deterministic templates
for now; an LLM summary (LLMClient with a REVISION config key) could replace
``build_reason`` later without touching the schedule math.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any

# Same vocabulary as flashcard_schema.RATINGS, mapped to a 0-1 quality used
# to grade a whole study batch.
RATING_QUALITY = {
    "easy": 1.0,
    "medium": 0.6,
    "hard": 0.3,
    "needs_revision": 0.0,
}

CONFIDENCE_LEVELS = ["confused", "better", "mastered"]

STATUS_LEARNING = "learning"
STATUS_REVIEWING = "reviewing"
STATUS_MASTERED = "mastered"

# Days since the last review before "Not reviewed for N days" becomes the
# recommendation reason.
STALE_AFTER_DAYS = 2


@dataclass(frozen=True)
class RevisionConfig:
    """Env-tunable constants (see load_env_vars in app.py).

    quiz_ok/quiz_good deliberately mirror the weak(<60)/strong(>=80)
    thresholds hardcoded in SpaceRepository.stats and
    QuizService._update_space_memory so "weak" means the same thing
    everywhere.
    """

    intervals_days: tuple[int, ...] = (1, 3, 7, 14, 30)
    quiz_good: float = 80.0
    quiz_ok: float = 60.0
    flashcard_good: float = 0.75
    flashcard_bad: float = 0.4
    overdue_urgent_days: int = 2
    mastered_recent_days: int = 14
    backfill_limit: int = 500

    @property
    def max_strength(self) -> int:
        """Top rung of the interval ladder."""
        return len(self.intervals_days) - 1

    @staticmethod
    def from_app() -> RevisionConfig:
        """Build from Flask config (defaults match the dataclass)."""
        # Local import keeps the engine importable without Flask installed.
        from flask import current_app

        cfg = current_app.config
        return RevisionConfig(
            intervals_days=parse_intervals(
                cfg.get("REVISION_INTERVALS_DAYS", "1,3,7,14,30")
            ),
            quiz_good=float(cfg.get("REVISION_QUIZ_GOOD", 80)),
            quiz_ok=float(cfg.get("REVISION_QUIZ_OK", 60)),
            flashcard_good=float(cfg.get("REVISION_FLASHCARD_GOOD", 0.75)),
            flashcard_bad=float(cfg.get("REVISION_FLASHCARD_BAD", 0.4)),
            overdue_urgent_days=int(cfg.get("REVISION_OVERDUE_URGENT_DAYS", 2)),
            mastered_recent_days=int(
                cfg.get("REVISION_MASTERED_RECENT_DAYS", 14)
            ),
            backfill_limit=int(cfg.get("REVISION_BACKFILL_LIMIT", 500)),
        )


@dataclass(frozen=True)
class ScheduleUpdate:
    """Result of applying a study signal to an item's schedule."""

    strength: int
    status: str
    due_at: datetime


def parse_intervals(raw: str) -> tuple[int, ...]:
    """Parse "1,3,7,14,30" into a ladder; falls back to the default."""
    try:
        parsed = tuple(int(p) for p in raw.split(",") if p.strip())
    except ValueError:
        parsed = ()
    return parsed or (1, 3, 7, 14, 30)


def normalize_topic(topic: str | None) -> tuple[str, str]:
    """Return (display, key) for a free-text topic.

    Only case/whitespace are normalized — "Photosynthesis basics" stays a
    separate item from "Photosynthesis" (fuzzy merge is a follow-up).
    """
    display = " ".join((topic or "").split()) or "General"
    return display, display.lower()


def _polarity(  # noqa: PLR0911 - flat signal→delta mapping
    signal: dict[str, Any], cfg: RevisionConfig
) -> tuple[int, int]:
    """Map a signal to (strength delta, polarity -1|0|+1)."""
    kind = signal.get("kind")
    if kind == "quiz":
        score = float(signal.get("score") or 0)
        if score >= cfg.quiz_good:
            return 1, 1
        if score >= cfg.quiz_ok:
            return 0, 0
        return -2, -1
    if kind == "flashcards":
        quality = float(signal.get("quality") or 0)
        if quality >= cfg.flashcard_good:
            return 1, 1
        if quality <= cfg.flashcard_bad:
            return -1, -1
        return 0, 0
    if kind == "confidence":
        level = signal.get("confidence")
        if level == "mastered":
            return 2, 1
        if level == "better":
            return 1, 0
        # confused: reset to the bottom of the ladder
        return -1000, -1
    return 0, 0


def apply_signal(
    strength: int,
    signal: dict[str, Any],
    cfg: RevisionConfig,
    now: datetime,
) -> ScheduleUpdate:
    """Move an item along the interval ladder after a study signal.

    signal: {"kind": "quiz", "score": 0-100}
          | {"kind": "flashcards", "quality": 0-1}
          | {"kind": "confidence", "confidence": confused|better|mastered}
    """
    delta, polarity = _polarity(signal, cfg)
    new_strength = max(0, min(strength + delta, cfg.max_strength))
    if new_strength == 0:
        status = STATUS_LEARNING
    elif polarity > 0 and new_strength == cfg.max_strength:
        status = STATUS_MASTERED
    else:
        status = STATUS_REVIEWING
    due_at = now + timedelta(days=cfg.intervals_days[new_strength])
    return ScheduleUpdate(new_strength, status, due_at)


def seed_strength(
    cfg: RevisionConfig,
    quiz_score: float | None = None,
    flashcard_quality: float | None = None,
) -> int:
    """Pick the initial ladder position for a backfilled/new item."""
    strength = 0
    if quiz_score is not None:
        if quiz_score >= cfg.quiz_good:
            strength = max(strength, 2)
        elif quiz_score >= cfg.quiz_ok:
            strength = max(strength, 1)
    if flashcard_quality is not None:
        if flashcard_quality >= cfg.flashcard_good:
            strength = max(strength, 2)
        elif flashcard_quality > cfg.flashcard_bad:
            strength = max(strength, 1)
    return min(strength, cfg.max_strength)


def batch_quality(ratings: list[str]) -> float:
    """Mean quality of a flashcard study batch (unknown ratings ignored)."""
    known = [RATING_QUALITY[r] for r in ratings if r in RATING_QUALITY]
    if not known:
        return 0.0
    return sum(known) / len(known)


def local_day_bounds(
    tz_offset_minutes: int, now: datetime
) -> tuple[datetime, datetime]:
    """UTC (start, end) of the user-local day containing ``now``."""
    offset = timedelta(minutes=tz_offset_minutes)
    local_now = now + offset
    local_start = datetime(
        local_now.year, local_now.month, local_now.day, tzinfo=UTC
    )
    return local_start - offset, local_start + timedelta(days=1) - offset


def parse_ts(raw: str | None) -> datetime | None:
    """Parse a PostgREST ISO timestamp (handles trailing Z)."""
    if not raw:
        return None
    try:
        ts = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None
    return ts if ts.tzinfo else ts.replace(tzinfo=UTC)


def _ago(ts: datetime | None, now: datetime) -> str:
    """Human phrase for how long ago something happened."""
    if not ts:
        return "recently"
    days = max((now.date() - ts.date()).days, 0)
    if days == 0:
        return "today"
    if days == 1:
        return "yesterday"
    return f"{days} days ago"


def build_reason(
    item: dict[str, Any], cfg: RevisionConfig, now: datetime
) -> tuple[str, str]:
    """Deterministic (recommended_action, reason) for a revision item.

    Always explains *why* something is recommended — the reason line is a
    core product requirement, not decoration.
    """
    sources = item.get("sources") or {}
    quiz_score = item.get("last_quiz_score")
    quiz_at = parse_ts(item.get("last_quiz_at"))
    quality = item.get("last_flashcard_quality")
    fc_at = parse_ts(item.get("last_flashcard_at"))
    reviewed_at = parse_ts(item.get("last_reviewed_at"))

    if quiz_score is not None and float(quiz_score) < cfg.quiz_ok:
        return "quiz", (
            f"You scored {round(float(quiz_score))}% {_ago(quiz_at, now)}"
        )
    if item.get("last_confidence") == "confused":
        return "review", "You marked this as confusing last time"
    if quality is not None and float(quality) <= cfg.flashcard_bad:
        return "flashcards", (f"Several cards felt hard {_ago(fc_at, now)}")
    if reviewed_at:
        days = max((now.date() - reviewed_at.date()).days, 0)
        if days >= STALE_AFTER_DAYS:
            action = (
                "flashcards"
                if sources.get("set_id")
                else ("quiz" if sources.get("quiz_id") else "review")
            )
            return action, f"Not reviewed for {days} days"
    if item.get("status") == STATUS_MASTERED:
        return "review", "Mastered — a quick pass keeps it fresh"
    return "review", "Due for revision"


def decorate_item(
    item: dict[str, Any], cfg: RevisionConfig, now: datetime
) -> dict[str, Any]:
    """Shape a revision_items row into the API item payload."""
    due = parse_ts(item.get("due_at"))
    overdue_days = max((now.date() - due.date()).days, 0) if due else 0
    action, reason = build_reason(item, cfg, now)
    return {
        "id": item.get("id"),
        "topic": item.get("topic"),
        "space_id": item.get("space_id"),
        "status": item.get("status"),
        "strength": int(item.get("strength") or 0),
        "max_strength": cfg.max_strength,
        "due_at": item.get("due_at"),
        "overdue_days": overdue_days,
        "last_reviewed_at": item.get("last_reviewed_at"),
        "last_quiz_score": item.get("last_quiz_score"),
        "last_confidence": item.get("last_confidence"),
        "recommended_action": action,
        "reason": reason,
        "sources": item.get("sources") or {},
    }


def _is_weak(item: dict[str, Any], cfg: RevisionConfig) -> bool:
    """Weak = last quiz below the OK line, or self-reported confusion."""
    score = item.get("last_quiz_score")
    if score is not None and float(score) < cfg.quiz_ok:
        return True
    return item.get("last_confidence") == "confused"


def bucketize(
    items: list[dict[str, Any]],
    cfg: RevisionConfig,
    now: datetime,
    tz_offset_minutes: int = 0,
) -> dict[str, list[dict[str, Any]]]:
    """Split items into needs_revision / due_today / recently_mastered.

    Buckets are computed against the user-local day so "due today" matches
    the student's calendar, not UTC.
    """
    day_start, day_end = local_day_bounds(tz_offset_minutes, now)
    needs: list[dict[str, Any]] = []
    due_today: list[dict[str, Any]] = []
    mastered: list[dict[str, Any]] = []

    for item in items:
        due = parse_ts(item.get("due_at"))
        updated = parse_ts(item.get("updated_at"))
        payload = decorate_item(item, cfg, now)

        if (
            item.get("status") == STATUS_MASTERED
            and updated
            and (now - updated).days <= cfg.mastered_recent_days
        ):
            mastered.append(payload)
            continue
        if not due:
            continue
        overdue = due < day_start
        urgent = overdue and (
            _is_weak(item, cfg)
            or payload["overdue_days"] >= cfg.overdue_urgent_days
        )
        if urgent:
            needs.append(payload)
        elif due < day_end:
            due_today.append(payload)

    # Most urgent first: deeper overdue and weaker items on top.
    needs.sort(key=lambda i: (-i["overdue_days"], i["last_quiz_score"] or 101))
    due_today.sort(key=lambda i: i["due_at"] or "")
    mastered.sort(key=lambda i: i["last_reviewed_at"] or "", reverse=True)
    return {
        "needs_revision": needs,
        "due_today": due_today,
        "recently_mastered": mastered,
    }


def streak_from_days(active: set[date], today: date) -> int:
    """Consecutive active days ending today (or yesterday)."""
    if not active:
        return 0
    cursor = today if today in active else today - timedelta(days=1)
    streak = 0
    while cursor in active:
        streak += 1
        cursor -= timedelta(days=1)
    return streak
