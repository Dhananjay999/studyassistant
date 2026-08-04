"""Revision data access.

Service-role client bypasses RLS, so every query filters user_id manually
(same rule as every other repository in this codebase).
"""

from typing import Any

from aeva.supabase.supabase_service import SupabaseService

_CHUNK = 100


def _chunks(items: list[str], size: int) -> list[list[str]]:
    """Split ids for PostgREST .in_() calls (URL length limit)."""
    return [items[i : i + size] for i in range(0, len(items), size)]


class RevisionRepository:
    """Persist and load revision items, events, and backfill sources."""

    def __init__(self, supabase: SupabaseService | None = None) -> None:
        self._supabase = supabase

    @property
    def supabase(self) -> SupabaseService:
        """Lazy Supabase client."""
        return self._supabase or SupabaseService()

    # ------------------------------------------------------------- items

    def list_items(self, user_id: str) -> list[dict[str, Any]]:
        """All revision items for a user, soonest-due first."""
        return (
            self.supabase.client.table("revision_items")
            .select("*")
            .eq("user_id", user_id)
            .order("due_at")
            .execute()
        ).data or []

    def get_item(self, user_id: str, topic_key: str) -> dict[str, Any] | None:
        """Load one item by its normalized topic."""
        result = (
            self.supabase.client.table("revision_items")
            .select("*")
            .eq("user_id", user_id)
            .eq("topic_key", topic_key)
            .maybe_single()
            .execute()
        )
        return result.data if result and result.data else None

    def upsert_item(self, row: dict[str, Any]) -> dict[str, Any]:
        """Insert-or-update an item keyed by (user_id, topic_key)."""
        result = (
            self.supabase.client.table("revision_items")
            .upsert(row, on_conflict="user_id,topic_key")
            .execute()
        )
        return result.data[0]

    def upsert_items(self, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Batch upsert (backfill) keyed by (user_id, topic_key)."""
        if not rows:
            return []
        result = (
            self.supabase.client.table("revision_items")
            .upsert(rows, on_conflict="user_id,topic_key")
            .execute()
        )
        return result.data or []

    # ------------------------------------------------------------ events

    def insert_event(self, row: dict[str, Any]) -> None:
        """Append one schedule-change event."""
        self.supabase.client.table("revision_events").insert(row).execute()

    def insert_events(self, rows: list[dict[str, Any]]) -> None:
        """Append many events in one request (backfill)."""
        if rows:
            self.supabase.client.table("revision_events").insert(rows).execute()

    def list_event_dates(self, user_id: str) -> list[str]:
        """created_at of real study events (streak input).

        Backfill events are excluded — they land on seed day and would
        fake activity.
        """
        rows = (
            self.supabase.client.table("revision_events")
            .select("created_at")
            .eq("user_id", user_id)
            .neq("event_type", "backfill")
            .execute()
        ).data or []
        return [r["created_at"] for r in rows]

    # ----------------------------------------------------- seeded marker

    def seeded_at(self, user_id: str) -> str | None:
        """profiles.revision_seeded_at, or None if backfill never ran."""
        result = (
            self.supabase.client.table("profiles")
            .select("revision_seeded_at")
            .eq("id", user_id)
            .maybe_single()
            .execute()
        )
        if not result or not result.data:
            return None
        return result.data.get("revision_seeded_at")

    def mark_seeded(self, user_id: str, at_iso: str) -> None:
        """Record that historical data was folded into revision items."""
        self.supabase.client.table("profiles").update(
            {"revision_seeded_at": at_iso}
        ).eq("id", user_id).execute()

    # -------------------------------------------------- backfill sources

    def backfill_sources(
        self, user_id: str, limit: int
    ) -> dict[str, list[dict[str, Any]]]:
        """Historical study data to seed revision items from."""
        client = self.supabase.client
        quizzes = (
            client.table("quizzes")
            .select("id, topic, title, space_id, created_at")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        ).data or []
        attempts = (
            client.table("quiz_attempts")
            .select("quiz_id, score, created_at")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        ).data or []
        sets = (
            client.table("flashcard_sets")
            .select("id, topic, title, space_id, created_at")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        ).data or []
        study = (
            client.table("flashcard_study")
            .select("set_id, rating, updated_at")
            .eq("user_id", user_id)
            .order("updated_at", desc=True)
            .limit(limit)
            .execute()
        ).data or []
        return {
            "quizzes": quizzes,
            "attempts": attempts,
            "sets": sets,
            "study": study,
        }

    # ------------------------------------------------------ streak input

    def activity_dates(self, user_id: str) -> list[str]:
        """Timestamps of study activity (attempts + card reviews)."""
        client = self.supabase.client
        attempts = (
            client.table("quiz_attempts")
            .select("created_at")
            .eq("user_id", user_id)
            .execute()
        ).data or []
        study = (
            client.table("flashcard_study")
            .select("updated_at")
            .eq("user_id", user_id)
            .execute()
        ).data or []
        return [
            *(r["created_at"] for r in attempts),
            *(r["updated_at"] for r in study),
        ]

    # -------------------------------------------------------- misc reads

    def latest_session(self, user_id: str) -> dict[str, Any] | None:
        """Newest chat session (the "continue learning" pointer)."""
        rows = (
            self.supabase.client.table("sessions")
            .select("id, title, space_id, updated_at")
            .eq("user_id", user_id)
            .order("updated_at", desc=True)
            .limit(1)
            .execute()
        ).data or []
        return rows[0] if rows else None

    def get_flashcard_set(
        self, set_id: str, user_id: str
    ) -> dict[str, Any] | None:
        """Topic/space of a set (ingestion helper); None if not owner."""
        result = (
            self.supabase.client.table("flashcard_sets")
            .select("id, topic, title, space_id")
            .eq("id", set_id)
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
        return result.data if result and result.data else None
