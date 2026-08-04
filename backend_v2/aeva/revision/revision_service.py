"""Revision orchestration: ingestion, lazy backfill, dashboard/home reads.

There is no background scheduler in this deployment (Vercel serverless), so
everything is computed at read time and ingestion happens inline on the
quiz-submit / flashcard-study write paths. Historical data is folded in once
per user, lazily, on the first dashboard/home load.
"""

import logging
from datetime import UTC, date, datetime, timedelta
from typing import Any

from aeva.revision import revision_engine as engine
from aeva.revision.revision_engine import RevisionConfig
from aeva.revision.revision_repository import RevisionRepository
from aeva.revision.schema.revision_schema import ConfidenceData

logger = logging.getLogger(__name__)


class RevisionService:
    """Topic-level spaced repetition."""

    def __init__(self, repo: RevisionRepository | None = None) -> None:
        self.repo = repo or RevisionRepository()

    # ---------------------------------------------------------- ingestion

    def record_quiz_attempt(
        self,
        user_id: str,
        quiz: dict[str, Any],
        evaluation: dict[str, Any],
    ) -> None:
        """Fold a quiz submission into the topic's revision schedule."""
        topic = quiz.get("topic") or quiz.get("title")
        score = round(float(evaluation.get("score") or 0), 1)
        self._apply(
            user_id,
            topic,
            space_id=quiz.get("space_id"),
            signal={"kind": "quiz", "score": score},
            event_type="quiz_attempt",
            fields={
                "last_quiz_score": score,
                "last_quiz_at": _now_iso(),
            },
            sources={"quiz_id": quiz.get("id")},
        )

    def record_flashcard_study(
        self,
        user_id: str,
        set_id: str,
        ratings: list[tuple[str, str]],
    ) -> None:
        """Fold a flashcard study session into the topic's schedule."""
        if not ratings:
            return
        fset = self.repo.get_flashcard_set(set_id, user_id)
        if not fset:
            return
        quality = round(engine.batch_quality([r for _, r in ratings]), 3)
        self._apply(
            user_id,
            fset.get("topic") or fset.get("title"),
            space_id=fset.get("space_id"),
            signal={"kind": "flashcards", "quality": quality},
            event_type="flashcard_study",
            fields={
                "last_flashcard_quality": quality,
                "last_flashcard_at": _now_iso(),
            },
            sources={"set_id": set_id},
            signal_extra={"rated": len(ratings)},
        )

    def record_confidence(
        self, user_id: str, data: ConfidenceData
    ) -> dict[str, Any]:
        """Record self-reported confidence and reschedule the topic.

        Creates the item if it doesn't exist yet, so this also serves as
        the manual/chat ingestion path.
        """
        cfg = RevisionConfig.from_app()
        sources: dict[str, Any] = {}
        if data.ref_id and data.source == "quiz":
            sources["quiz_id"] = data.ref_id
        elif data.ref_id and data.source == "flashcards":
            sources["set_id"] = data.ref_id
        item = self._apply(
            user_id,
            data.topic,
            space_id=data.space_id,
            signal={"kind": "confidence", "confidence": data.confidence},
            event_type="confidence",
            fields={
                "last_confidence": data.confidence,
                "last_confidence_at": _now_iso(),
            },
            sources=sources,
        )
        strength = int(item.get("strength") or 0)
        return {
            "topic": item.get("topic"),
            "strength": strength,
            "status": item.get("status"),
            "due_at": item.get("due_at"),
            "next_review_in_days": cfg.intervals_days[strength],
        }

    def _apply(
        self,
        user_id: str,
        topic: str | None,
        *,
        space_id: str | None,
        signal: dict[str, Any],
        event_type: str,
        fields: dict[str, Any],
        sources: dict[str, Any],
        signal_extra: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Shared ingestion: load item, apply signal, upsert, log event."""
        cfg = RevisionConfig.from_app()
        now = datetime.now(UTC)
        display, key = engine.normalize_topic(topic)

        existing = self.repo.get_item(user_id, key)
        before = int(existing.get("strength") or 0) if existing else None
        update = engine.apply_signal(before or 0, signal, cfg, now)

        merged_sources = {
            **((existing or {}).get("sources") or {}),
            **{k: v for k, v in sources.items() if v},
        }
        row = {
            "user_id": user_id,
            "topic_key": key,
            "topic": display,
            "strength": update.strength,
            "status": update.status,
            "due_at": update.due_at.isoformat(),
            "last_reviewed_at": now.isoformat(),
            "review_count": int((existing or {}).get("review_count") or 0) + 1,
            "sources": merged_sources,
            "updated_at": now.isoformat(),
            **fields,
        }
        if space_id:
            row["space_id"] = space_id
        item = self.repo.upsert_item(row)

        self.repo.insert_event(
            {
                "user_id": user_id,
                "item_id": item["id"],
                "event_type": event_type,
                "signal": {**signal, **(signal_extra or {})},
                "strength_before": before,
                "strength_after": update.strength,
                "due_at_after": update.due_at.isoformat(),
            }
        )
        return item

    # ------------------------------------------------------ lazy backfill

    def ensure_seeded(self, user_id: str) -> None:  # noqa: C901 - flat per-source aggregation
        """Fold pre-existing quizzes/flashcards into revision items, once.

        Idempotent under concurrent first-loads: the (user_id, topic_key)
        upsert makes a double run harmless.
        """
        if self.repo.seeded_at(user_id):
            return
        cfg = RevisionConfig.from_app()
        now = datetime.now(UTC)
        src = self.repo.backfill_sources(user_id, cfg.backfill_limit)

        # Per-topic aggregates. Source lists are newest-first, so the first
        # value seen per topic is the latest.
        topics: dict[str, dict[str, Any]] = {}

        def bucket(topic: str | None) -> dict[str, Any]:
            display, key = engine.normalize_topic(topic)
            return topics.setdefault(
                key,
                {
                    "topic": display,
                    "sources": {},
                    "space_id": None,
                    "last_at": None,
                    "quiz_score": None,
                    "quiz_at": None,
                    "ratings": [],
                    "fc_at": None,
                },
            )

        quiz_topic = {}
        for q in src["quizzes"]:
            quiz_topic[q["id"]] = q.get("topic") or q.get("title")
            b = bucket(quiz_topic[q["id"]])
            b["sources"].setdefault("quiz_id", q["id"])
            b["space_id"] = b["space_id"] or q.get("space_id")
            b["last_at"] = _max_ts(b["last_at"], q.get("created_at"))
        for a in src["attempts"]:
            topic = quiz_topic.get(a["quiz_id"])
            if topic is None:
                continue
            b = bucket(topic)
            if b["quiz_score"] is None:
                b["quiz_score"] = a.get("score")
                b["quiz_at"] = a.get("created_at")
            b["last_at"] = _max_ts(b["last_at"], a.get("created_at"))

        set_topic = {}
        for s in src["sets"]:
            set_topic[s["id"]] = s.get("topic") or s.get("title")
            b = bucket(set_topic[s["id"]])
            b["sources"].setdefault("set_id", s["id"])
            b["space_id"] = b["space_id"] or s.get("space_id")
            b["last_at"] = _max_ts(b["last_at"], s.get("created_at"))
        for r in src["study"]:
            topic = set_topic.get(r["set_id"])
            if topic is None:
                continue
            b = bucket(topic)
            b["ratings"].append(r.get("rating"))
            b["fc_at"] = _max_ts(b["fc_at"], r.get("updated_at"))
            b["last_at"] = _max_ts(b["last_at"], r.get("updated_at"))

        rows: list[dict[str, Any]] = []
        for key, b in topics.items():
            quality = (
                round(engine.batch_quality(b["ratings"]), 3)
                if b["ratings"]
                else None
            )
            score = (
                float(b["quiz_score"]) if b["quiz_score"] is not None else None
            )
            strength = engine.seed_strength(
                cfg, quiz_score=score, flashcard_quality=quality
            )
            last_at = engine.parse_ts(b["last_at"]) or now
            # Past-due dates are correct: dormant topics surface as overdue.
            due_at = last_at + timedelta(days=cfg.intervals_days[strength])
            rows.append(
                {
                    "user_id": user_id,
                    "topic_key": key,
                    "topic": b["topic"],
                    "space_id": b["space_id"],
                    "strength": strength,
                    "status": "learning" if strength == 0 else "reviewing",
                    "due_at": due_at.isoformat(),
                    "last_reviewed_at": b["last_at"],
                    "review_count": 0,
                    "last_quiz_score": score,
                    "last_quiz_at": b["quiz_at"],
                    "last_flashcard_quality": quality,
                    "last_flashcard_at": b["fc_at"],
                    "sources": b["sources"],
                }
            )

        items = self.repo.upsert_items(rows)
        self.repo.insert_events(
            [
                {
                    "user_id": user_id,
                    "item_id": item["id"],
                    "event_type": "backfill",
                    "signal": {
                        "score": item.get("last_quiz_score"),
                        "quality": item.get("last_flashcard_quality"),
                    },
                    "strength_after": item.get("strength"),
                    "due_at_after": item.get("due_at"),
                }
                for item in items
            ]
        )
        self.repo.mark_seeded(user_id, now.isoformat())

    # ------------------------------------------------------------- reads

    def dashboard(
        self, user_id: str, tz_offset_minutes: int = 0
    ) -> dict[str, Any]:
        """Full revision dashboard payload."""
        self._safe_seed(user_id)
        cfg = RevisionConfig.from_app()
        now = datetime.now(UTC)
        items = self.repo.list_items(user_id)
        buckets = engine.bucketize(items, cfg, now, tz_offset_minutes)
        due = len(buckets["needs_revision"]) + len(buckets["due_today"])
        return {
            **buckets,
            "streak_days": self._streak(user_id, tz_offset_minutes, now),
            "continue_learning": self.repo.latest_session(user_id),
            "counts": {
                "total_topics": len(items),
                "due": due,
                "mastered": sum(
                    1 for i in items if i.get("status") == "mastered"
                ),
            },
        }

    def home(
        self,
        user_id: str,
        name: str | None,
        tz_offset_minutes: int = 0,
    ) -> dict[str, Any]:
        """Lightweight payload for the chat welcome screen."""
        self._safe_seed(user_id)
        cfg = RevisionConfig.from_app()
        now = datetime.now(UTC)
        items = self.repo.list_items(user_id)
        buckets = engine.bucketize(items, cfg, now, tz_offset_minutes)
        due = len(buckets["needs_revision"]) + len(buckets["due_today"])

        # The welcome screen shows a fixed pair: one Practice Quiz card and
        # one Flashcards card. Due/weak topics rank first; when nothing is
        # due we still fill both slots from the most recently studied topics
        # so the home never feels empty for an active learner.
        home_cards = 2
        candidates = [*buckets["needs_revision"], *buckets["due_today"]]
        if len(candidates) < home_cards:
            seen = {c["id"] for c in candidates}
            candidates.extend(
                engine.decorate_item(i, cfg, now)
                for i in sorted(
                    items,
                    key=lambda x: x.get("last_reviewed_at") or "",
                    reverse=True,
                )
                if i.get("id") not in seen
            )

        recommendations = []
        if candidates:
            quiz_pick = candidates[0]
            fc_pick = candidates[1] if len(candidates) > 1 else quiz_pick
            recommendations = [
                {
                    "action": "quiz",
                    "topic": quiz_pick["topic"],
                    "reason": quiz_pick["reason"],
                    "quiz_id": (quiz_pick.get("sources") or {}).get(
                        "quiz_id"
                    ),
                    "set_id": None,
                },
                {
                    "action": "flashcards",
                    "topic": fc_pick["topic"],
                    "reason": fc_pick["reason"],
                    "quiz_id": None,
                    "set_id": (fc_pick.get("sources") or {}).get("set_id"),
                },
            ]

        day_start, _ = engine.local_day_bounds(tz_offset_minutes, now)
        yesterday: list[str] = []
        recent: list[str] = []
        for i in sorted(
            items,
            key=lambda x: x.get("last_reviewed_at") or "",
            reverse=True,
        ):
            reviewed = engine.parse_ts(i.get("last_reviewed_at"))
            if not reviewed:
                continue
            days_back = (day_start - reviewed).days
            if 0 <= days_back < 1:
                yesterday.append(i["topic"])
            elif reviewed >= day_start - timedelta(days=7):
                recent.append(i["topic"])
        return {
            "greeting": {
                "name": (name or "").split(" ")[0] or None,
                "streak_days": self._streak(user_id, tz_offset_minutes, now),
                "due_count": due,
            },
            "yesterday_topics": yesterday[:4],
            "recent_topics": recent[:4],
            "recommendations": recommendations,
        }

    # ----------------------------------------------------------- helpers

    def _safe_seed(self, user_id: str) -> None:
        """Backfill must never break a read — degrade to live data only."""
        try:
            self.ensure_seeded(user_id)
        except Exception:  # noqa: BLE001
            logger.warning("Revision backfill failed", exc_info=True)

    def _streak(
        self, user_id: str, tz_offset_minutes: int, now: datetime
    ) -> int:
        """Consecutive local-day streak across all study activity."""
        offset = timedelta(minutes=tz_offset_minutes)
        active: set[date] = set()
        for raw in (
            *self.repo.activity_dates(user_id),
            *self.repo.list_event_dates(user_id),
        ):
            ts = engine.parse_ts(raw)
            if ts:
                active.add((ts + offset).date())
        return engine.streak_from_days(active, (now + offset).date())


def _now_iso() -> str:
    """Return the current UTC time as an ISO string."""
    return datetime.now(UTC).isoformat()


def _max_ts(a: str | None, b: str | None) -> str | None:
    """Later of two ISO timestamps (None-safe)."""
    if not a:
        return b
    if not b:
        return a
    return max(a, b)
