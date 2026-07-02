"""Learning analytics: per-user study insights for the Analytics dashboard.

Everything is derived from data the app already stores (sessions, messages,
quizzes, attempts, flashcards, media) — there is no separate tracking table.
"Study time" is therefore an *estimate*: measured quiz time plus a modest
reading allowance per AI response. All aggregates are computed defensively so a
brand-new user (no data) still gets a well-formed, all-zero payload.
"""

from datetime import UTC, date, datetime, timedelta
from typing import Any

from aeva.common.schema import UserData, success_response
from aeva.supabase.supabase_service import SupabaseService

# Rows fetched per `IN` clause when pulling messages across a user's sessions.
_CHUNK = 100
# Days of day-by-day activity returned for the weekly/streak charts.
_ACTIVITY_DAYS = 14
# Rough minutes of "reading" credited per AI response when no timer exists.
_MINUTES_PER_RESPONSE = 1.5


def _day(iso: str | None) -> str:
    """YYYY-MM-DD prefix of an ISO timestamp (safe for empty/None)."""
    return (iso or "")[:10]


def _chunks(items: list[str], size: int) -> list[list[str]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


class AnalyticsRepository:
    """Aggregate a single user's learning activity."""

    @staticmethod
    def overview(current_user: UserData) -> dict[str, Any]:
        """Build the full analytics payload for the current user."""
        supabase = SupabaseService()
        client = supabase.client
        uid = current_user.id

        sessions = (
            client.table("sessions")
            .select("id, created_at, updated_at")
            .eq("user_id", uid)
            .execute()
            .data
            or []
        )
        session_ids = [s["id"] for s in sessions]

        # Messages carry no user_id, so pull them by the user's session ids.
        messages: list[dict[str, Any]] = []
        for chunk in _chunks(session_ids, _CHUNK):
            messages += (
                client.table("messages")
                .select("role, created_at")
                .in_("session_id", chunk)
                .execute()
                .data
                or []
            )
        user_msgs = [m for m in messages if m.get("role") == "user"]
        ai_msgs = [m for m in messages if m.get("role") == "assistant"]

        quizzes = (
            client.table("quizzes")
            .select("id, topic, difficulty, created_at")
            .eq("user_id", uid)
            .execute()
            .data
            or []
        )
        attempts = (
            client.table("quiz_attempts")
            .select("quiz_id, score, evaluation, created_at")
            .eq("user_id", uid)
            .execute()
            .data
            or []
        )
        flashcard_sets = (
            client.table("flashcard_sets")
            .select("id, topic, created_at")
            .eq("user_id", uid)
            .execute()
            .data
            or []
        )
        media = (
            client.table("media")
            .select("id")
            .eq("user_id", uid)
            .execute()
            .data
            or []
        )
        bookmark_count = (
            client.table("bookmarks")
            .select("id", count="exact")
            .eq("user_id", uid)
            .limit(1)
            .execute()
            .count
            or 0
        )

        quiz_seconds = sum(
            int((a.get("evaluation") or {}).get("time_taken_seconds") or 0)
            for a in attempts
        )
        study_minutes = round(
            quiz_seconds / 60 + len(ai_msgs) * _MINUTES_PER_RESPONSE
        )

        overview = {
            "total_study_minutes": study_minutes,
            "total_questions_asked": len(user_msgs),
            "total_ai_responses": len(ai_msgs),
            "uploaded_documents": len(media),
            "quizzes_created": len(quizzes),
            "flashcards_created": len(flashcard_sets),
            "total_chats": len(sessions),
            "total_bookmarks": bookmark_count,
        }

        quiz_analytics = AnalyticsRepository._quiz_analytics(attempts)
        activity = AnalyticsRepository._daily_activity(user_msgs, attempts)
        streak = AnalyticsRepository._streak(user_msgs, attempts)
        subjects = AnalyticsRepository._subjects(quizzes, flashcard_sets)
        achievements = AnalyticsRepository._achievements(
            questions=len(user_msgs),
            attempts=len(attempts),
            avg_score=quiz_analytics["average_score"],
            documents=len(media),
            streak=streak,
        )

        data = {
            "overview": overview,
            "quiz_analytics": quiz_analytics,
            "activity": activity,
            "streak": streak,
            "subjects": subjects,
            "achievements": achievements,
        }
        return success_response("Analytics loaded", data)

    @staticmethod
    def _quiz_analytics(attempts: list[dict[str, Any]]) -> dict[str, Any]:
        """Score aggregates + a chronological performance trend."""
        scores = [
            float(a["score"])
            for a in attempts
            if a.get("score") is not None
        ]
        attempted_quiz_ids = {a["quiz_id"] for a in attempts}

        total_correct = 0
        total_questions = 0
        for a in attempts:
            ev = a.get("evaluation") or {}
            total_correct += int(ev.get("correct_count") or 0)
            total_questions += int(ev.get("total") or 0)

        accuracy = (
            round(total_correct / total_questions * 100)
            if total_questions
            else 0
        )

        # Trend: score per attempt in chronological order (cap for the chart).
        ordered = sorted(attempts, key=lambda a: a.get("created_at") or "")
        trend = [
            {
                "date": _day(a.get("created_at")),
                "score": round(float(a.get("score") or 0)),
            }
            for a in ordered
            if a.get("score") is not None
        ][-30:]

        return {
            "attempts": len(attempts),
            "quizzes_attempted": len(attempted_quiz_ids),
            "average_score": round(sum(scores) / len(scores)) if scores else 0,
            "best_score": round(max(scores)) if scores else 0,
            "accuracy": accuracy,
            "trend": trend,
        }

    @staticmethod
    def _daily_activity(
        user_msgs: list[dict[str, Any]],
        attempts: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Questions asked + quizzes taken per day for the last N days."""
        today = datetime.now(UTC).date()
        window = {
            (today - timedelta(days=i)).isoformat(): {"questions": 0, "quizzes": 0}
            for i in range(_ACTIVITY_DAYS - 1, -1, -1)
        }
        for m in user_msgs:
            d = _day(m.get("created_at"))
            if d in window:
                window[d]["questions"] += 1
        for a in attempts:
            d = _day(a.get("created_at"))
            if d in window:
                window[d]["quizzes"] += 1
        return [
            {"date": d, "questions": v["questions"], "quizzes": v["quizzes"]}
            for d, v in window.items()
        ]

    @staticmethod
    def _streak(
        user_msgs: list[dict[str, Any]],
        attempts: list[dict[str, Any]],
    ) -> int:
        """Consecutive days (ending today/yesterday) with any activity."""
        active: set[date] = set()
        for row in (*user_msgs, *attempts):
            d = _day(row.get("created_at"))
            try:
                active.add(date.fromisoformat(d))
            except ValueError:
                continue
        if not active:
            return 0
        today = datetime.now(UTC).date()
        cursor = today if today in active else today - timedelta(days=1)
        streak = 0
        while cursor in active:
            streak += 1
            cursor -= timedelta(days=1)
        return streak

    @staticmethod
    def _subjects(
        quizzes: list[dict[str, Any]],
        flashcard_sets: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Study volume grouped by topic (quizzes + flashcard sets)."""
        counts: dict[str, int] = {}
        for row in (*quizzes, *flashcard_sets):
            topic = (row.get("topic") or "").strip() or "General"
            counts[topic] = counts.get(topic, 0) + 1
        ranked = sorted(counts.items(), key=lambda kv: kv[1], reverse=True)
        return [{"subject": s, "count": c} for s, c in ranked[:8]]

    @staticmethod
    def _achievements(
        *,
        questions: int,
        attempts: int,
        avg_score: int,
        documents: int,
        streak: int,
    ) -> list[dict[str, Any]]:
        """Motivational badges — each with an unlocked flag + progress."""

        def badge(
            key: str, icon: str, title: str, value: int, target: int
        ) -> dict[str, Any]:
            return {
                "key": key,
                "icon": icon,
                "title": title,
                "unlocked": value >= target,
                "progress": min(value, target),
                "target": target,
            }

        return [
            badge("streak_7", "🔥", "7-Day Study Streak", streak, 7),
            badge("questions_100", "📚", "100 Questions Asked", questions, 100),
            badge("quizzes_50", "📝", "50 Quizzes Completed", attempts, 50),
            badge("avg_90", "🎯", "90% Average Score", avg_score, 90),
            badge("first_doc", "🚀", "First Uploaded Document", documents, 1),
        ]
