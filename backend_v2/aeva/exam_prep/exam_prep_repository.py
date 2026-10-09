"""Exam Prep data access (Supabase, service-role; ownership in queries).

Every read filters by the owner where the row carries ``user_id``
(``exam_plans``); day / topic rows are reached through their plan, which
the service verifies first. ``updated_at`` is set here on every UPDATE (no
trigger exists for these tables).

Query plan (dashboard): plan by (user_id, status) → idx_exam_plans_one_active
/ idx_exam_plans_user_status; days by plan_id ordered by day_number → the
UNIQUE (plan_id, day_number) index; topics by plan_id →
idx_exam_topics_plan_status; one batched quiz_attempts read by quiz_id (IN)
→ idx_quiz_attempts_quiz. Four queries, no per-day or per-topic reads.
"""

from datetime import UTC, date, datetime, timedelta
from typing import Any

from aeva.supabase.supabase_service import SupabaseService

# PostgREST ``in_`` filters travel in the URL; keep batches small.
_IN_BATCH = 100


def _now() -> str:
    """UTC timestamp for ``updated_at`` / ``status_updated_at``."""
    return datetime.now(tz=UTC).isoformat()


def _chunks(items: list[str], size: int) -> list[list[str]]:
    """Split ids into ``in_``-friendly batches."""
    return [items[i : i + size] for i in range(0, len(items), size)]


class ExamPrepRepository:
    """Exam Prep tables (stateless; per-request instances are fine)."""

    def __init__(self, supabase: SupabaseService | None = None) -> None:
        self._supabase = supabase

    @property
    def supabase(self) -> SupabaseService:
        """Lazy Supabase service."""
        if self._supabase is None:
            self._supabase = SupabaseService()
        return self._supabase

    @property
    def client(self) -> Any:
        """Raw table client."""
        return self.supabase.client

    # ------------------------------------------------------------- plans

    def get_active_plan(self, user_id: str) -> dict[str, Any] | None:
        """Return the user's active plan (at most one, by unique index)."""
        rows = (
            self.client.table("exam_plans")
            .select("*")
            .eq("user_id", user_id)
            .eq("status", "active")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        ).data or []
        return dict(rows[0]) if rows else None

    def has_active_plan(self, user_id: str) -> bool:
        """Whether the user has an active plan (id only, one indexed row).

        Same (user_id, status) filter as ``get_active_plan``, served by
        idx_exam_plans_one_active, without loading the plan row.
        """
        rows = (
            self.client.table("exam_plans")
            .select("id")
            .eq("user_id", user_id)
            .eq("status", "active")
            .limit(1)
            .execute()
        ).data or []
        return bool(rows)

    def get_plan(self, plan_id: str, user_id: str) -> dict[str, Any] | None:
        """One plan, owner-filtered."""
        rows = (
            self.client.table("exam_plans")
            .select("*")
            .eq("id", plan_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        ).data or []
        return dict(rows[0]) if rows else None

    def archive_active_plans(self, user_id: str) -> list[str]:
        """Archive whatever plan is active; return the archived plan ids.

        The ids let ``create_plan`` restore the previous plan when the new
        one cannot be activated.
        """
        result = (
            self.client.table("exam_plans")
            .update({"status": "archived", "updated_at": _now()})
            .eq("user_id", user_id)
            .eq("status", "active")
            .execute()
        )
        return [str(row["id"]) for row in result.data or []]

    def insert_plan(self, row: dict[str, Any]) -> dict[str, Any]:
        """Insert the plan row and return it."""
        result = self.client.table("exam_plans").insert(row).execute()
        return dict(result.data[0])

    def update_plan(
        self, plan_id: str, user_id: str, fields: dict[str, Any]
    ) -> dict[str, Any] | None:
        """Patch plan fields (owner-filtered); stamps ``updated_at``."""
        result = (
            self.client.table("exam_plans")
            .update({**fields, "updated_at": _now()})
            .eq("id", plan_id)
            .eq("user_id", user_id)
            .execute()
        )
        return dict(result.data[0]) if result.data else None

    def delete_plan(self, plan_id: str, user_id: str) -> None:
        """Delete a plan (days / topics cascade)."""
        (
            self.client.table("exam_plans")
            .delete()
            .eq("id", plan_id)
            .eq("user_id", user_id)
            .execute()
        )

    def delete_plan_sessions(self, plan_id: str, user_id: str) -> None:
        """Delete the coach session(s) tagged with a plan (rollback only).

        Called before ``delete_plan`` — the plan's ON DELETE SET NULL would
        otherwise leave a ``kind='exam_prep'`` session nothing can reach.
        Served by idx_sessions_exam_plan (028).
        """
        (
            self.client.table("sessions")
            .delete()
            .eq("exam_plan_id", plan_id)
            .eq("user_id", user_id)
            .execute()
        )

    # ------------------------------------------------------------ roadmap

    def insert_roadmap(
        self, plan_id: str, start: date, days: list[dict[str, Any]]
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """Insert a normalised roadmap: days in one call, topics in one call.

        ``days`` is the service's normalised shape: ``day_number``, ``title``,
        ``focus`` and ``topics`` (``subject``, ``title``, ``description``,
        ``est_minutes``). Day 1 is ``start``; ``sort_order`` is the topic's
        position within its day.
        """
        day_rows = [
            {
                "plan_id": plan_id,
                "day_number": int(day["day_number"]),
                "date": (
                    start + timedelta(days=int(day["day_number"]) - 1)
                ).isoformat(),
                "title": str(day.get("title") or ""),
                "focus": str(day.get("focus") or ""),
            }
            for day in days
        ]
        inserted_days = list(
            self.client.table("exam_plan_days").insert(day_rows).execute().data
            or []
        )
        id_by_number = {int(d["day_number"]): d["id"] for d in inserted_days}
        topic_rows = [
            {
                "plan_id": plan_id,
                "day_id": id_by_number[int(day["day_number"])],
                "subject": str(topic["subject"]),
                "title": str(topic["title"]),
                "description": str(topic.get("description") or ""),
                "est_minutes": int(topic.get("est_minutes") or 30),
                "sort_order": position,
            }
            for day in days
            if int(day["day_number"]) in id_by_number
            for position, topic in enumerate(day.get("topics") or [])
        ]
        inserted_topics: list[dict[str, Any]] = []
        if topic_rows:
            inserted_topics = list(
                self.client.table("exam_plan_topics")
                .insert(topic_rows)
                .execute()
                .data
                or []
            )
        return inserted_days, inserted_topics

    # --------------------------------------------------------------- days

    def list_days(self, plan_id: str) -> list[dict[str, Any]]:
        """All days of a plan (≤60) in day order."""
        return list(
            (
                self.client.table("exam_plan_days")
                .select("*")
                .eq("plan_id", plan_id)
                .order("day_number")
                .execute()
            ).data
            or []
        )

    def get_day(self, day_id: str, plan_id: str) -> dict[str, Any] | None:
        """One day, scoped to its plan."""
        rows = (
            self.client.table("exam_plan_days")
            .select("*")
            .eq("id", day_id)
            .eq("plan_id", plan_id)
            .limit(1)
            .execute()
        ).data or []
        return dict(rows[0]) if rows else None

    def get_day_by_date(self, plan_id: str, day: date) -> dict[str, Any] | None:
        """Return the plan's day row for a calendar date (today), if any."""
        rows = (
            self.client.table("exam_plan_days")
            .select("*")
            .eq("plan_id", plan_id)
            .eq("date", day.isoformat())
            .limit(1)
            .execute()
        ).data or []
        return dict(rows[0]) if rows else None

    def save_day_detail(
        self, day_id: str, detail: dict[str, Any]
    ) -> dict[str, Any] | None:
        """Cache the generated detail on the day row."""
        now = _now()
        result = (
            self.client.table("exam_plan_days")
            .update(
                {
                    "detail": detail,
                    "detail_generated_at": now,
                    "updated_at": now,
                }
            )
            .eq("id", day_id)
            .execute()
        )
        return dict(result.data[0]) if result.data else None

    # ------------------------------------------------------------- topics

    def list_topics(self, plan_id: str) -> list[dict[str, Any]]:
        """All topics of a plan (bounded by the plan size)."""
        return list(
            (
                self.client.table("exam_plan_topics")
                .select("*")
                .eq("plan_id", plan_id)
                .order("sort_order")
                .execute()
            ).data
            or []
        )

    def list_day_topics(self, day_id: str) -> list[dict[str, Any]]:
        """Topics of one day in display order."""
        return list(
            (
                self.client.table("exam_plan_topics")
                .select("*")
                .eq("day_id", day_id)
                .order("sort_order")
                .execute()
            ).data
            or []
        )

    def get_topic(self, topic_id: str) -> dict[str, Any] | None:
        """One topic (the service checks the plan's owner)."""
        rows = (
            self.client.table("exam_plan_topics")
            .select("*")
            .eq("id", topic_id)
            .limit(1)
            .execute()
        ).data or []
        return dict(rows[0]) if rows else None

    def update_topic(
        self, topic_id: str, plan_id: str, fields: dict[str, Any]
    ) -> dict[str, Any] | None:
        """Patch topic fields (scoped to its plan); stamps ``updated_at``."""
        result = (
            self.client.table("exam_plan_topics")
            .update({**fields, "updated_at": _now()})
            .eq("id", topic_id)
            .eq("plan_id", plan_id)
            .execute()
        )
        return dict(result.data[0]) if result.data else None

    def save_topic_lesson(
        self, topic_id: str, plan_id: str, lesson_md: str
    ) -> dict[str, Any] | None:
        """Cache the taught lesson on the topic row."""
        now = _now()
        result = (
            self.client.table("exam_plan_topics")
            .update(
                {
                    "lesson_md": lesson_md,
                    "lesson_generated_at": now,
                    "updated_at": now,
                }
            )
            .eq("id", topic_id)
            .eq("plan_id", plan_id)
            .execute()
        )
        return dict(result.data[0]) if result.data else None

    # ------------------------------------------------------------ lookups

    def quiz_summaries(
        self, user_id: str, quiz_ids: list[str]
    ) -> dict[str, dict[str, Any]]:
        """Attempt count / best score / last attempt per linked quiz.

        One batched read of ``quiz_attempts`` (``quiz_id IN (...)``, owner
        filtered), aggregated here; bounded by the plan's linked quizzes.
        """
        ids = list(dict.fromkeys(q for q in quiz_ids if q))
        summaries: dict[str, dict[str, Any]] = {}
        for batch in _chunks(ids, _IN_BATCH):
            rows = (
                self.client.table("quiz_attempts")
                .select("quiz_id, score, created_at")
                .in_("quiz_id", batch)
                .eq("user_id", user_id)
                .execute()
            ).data or []
            for row in rows:
                entry = summaries.setdefault(
                    str(row["quiz_id"]),
                    {
                        "attempt_count": 0,
                        "best_score": None,
                        "last_attempt_at": None,
                    },
                )
                entry["attempt_count"] += 1
                score = row.get("score")
                if score is not None and (
                    entry["best_score"] is None or score > entry["best_score"]
                ):
                    entry["best_score"] = score
                created = row.get("created_at")
                if created and (
                    entry["last_attempt_at"] is None
                    or str(created) > str(entry["last_attempt_at"])
                ):
                    entry["last_attempt_at"] = created
        return summaries

    def owned_media(
        self, user_id: str, media_ids: list[str]
    ) -> list[dict[str, Any]]:
        """Return the requested media rows the user owns (id, file_name).

        One query; ids that are not the user's simply drop out. File names
        are used only to describe the material in the plan prompt — they are
        never stored on the plan.
        """
        ids = list(dict.fromkeys(m for m in media_ids if m))
        owned: list[dict[str, Any]] = []
        for batch in _chunks(ids, _IN_BATCH):
            rows = (
                self.client.table("media")
                .select("id, file_name")
                .in_("id", batch)
                .eq("user_id", user_id)
                .execute()
            ).data or []
            owned.extend(dict(r) for r in rows)
        return owned
