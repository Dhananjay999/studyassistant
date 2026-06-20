"""Flashcard data access."""

import uuid
from typing import Any

from aeva.supabase.supabase_service import SupabaseService


class FlashcardRepository:
    """Persist and load flashcard sets, cards, and study ratings."""

    def __init__(self, supabase: SupabaseService | None = None) -> None:
        self._supabase = supabase

    @property
    def supabase(self) -> SupabaseService:
        """Lazy Supabase client."""
        return self._supabase or SupabaseService()

    def create(
        self,
        user_id: str,
        session_id: str | None,
        data: dict[str, Any],
        source_type: str = "chat",
    ) -> dict[str, Any]:
        """Create a flashcard set and its cards from LLM output."""
        set_row = (
            self.supabase.client.table("flashcard_sets")
            .insert({
                "user_id": user_id,
                "session_id": session_id,
                "title": data.get("title", "Flashcards"),
                "topic": data.get("topic", ""),
                "source_type": source_type,
            })
            .execute()
        )
        fset = set_row.data[0]
        set_id = fset["id"]

        cards_out: list[dict[str, Any]] = []
        for idx, c in enumerate(data.get("cards", [])):
            cid = str(uuid.uuid4())
            self.supabase.client.table("flashcards").insert({
                "id": cid,
                "set_id": set_id,
                "front": c["front"],
                "back": c["back"],
                "example": c.get("example") or None,
                "sort_order": idx,
            }).execute()
            cards_out.append({
                "id": cid,
                "front": c["front"],
                "back": c["back"],
                "example": c.get("example") or None,
            })

        return {
            "set_id": set_id,
            "title": fset["title"],
            "topic": fset["topic"],
            "source_type": fset["source_type"],
            "cards": cards_out,
        }

    def list_sets(self, user_id: str) -> list[dict[str, Any]]:
        """List the user's flashcard sets with card counts and progress."""
        sets = (
            self.supabase.client.table("flashcard_sets")
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .execute()
        ).data or []
        if not sets:
            return []

        ids = [s["id"] for s in sets]
        counts: dict[str, int] = {}
        cards = (
            self.supabase.client.table("flashcards")
            .select("id, set_id")
            .in_("set_id", ids)
            .execute()
        ).data or []
        for c in cards:
            counts[c["set_id"]] = counts.get(c["set_id"], 0) + 1

        studied: dict[str, int] = {}
        mastered: dict[str, int] = {}
        study = (
            self.supabase.client.table("flashcard_study")
            .select("set_id, rating")
            .eq("user_id", user_id)
            .in_("set_id", ids)
            .execute()
        ).data or []
        for s in study:
            studied[s["set_id"]] = studied.get(s["set_id"], 0) + 1
            if s["rating"] == "easy":
                mastered[s["set_id"]] = mastered.get(s["set_id"], 0) + 1

        return [
            {
                "id": s["id"],
                "set_id": s["id"],
                "title": s["title"],
                "topic": s["topic"],
                "source_type": s["source_type"],
                "created_at": s["created_at"],
                "card_count": counts.get(s["id"], 0),
                "studied": studied.get(s["id"], 0),
                "mastered": mastered.get(s["id"], 0),
            }
            for s in sets
        ]

    def get_set(
        self, set_id: str, user_id: str
    ) -> dict[str, Any] | None:
        """Load a set with its cards and study analytics."""
        result = (
            self.supabase.client.table("flashcard_sets")
            .select("*")
            .eq("id", set_id)
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
        if not result or not result.data:
            return None
        fset = result.data

        cards = (
            self.supabase.client.table("flashcards")
            .select("*")
            .eq("set_id", set_id)
            .order("sort_order")
            .execute()
        ).data or []

        return {
            "set_id": fset["id"],
            "title": fset["title"],
            "topic": fset["topic"],
            "source_type": fset["source_type"],
            "created_at": fset["created_at"],
            "cards": [
                {
                    "id": c["id"],
                    "front": c["front"],
                    "back": c["back"],
                    "example": c.get("example"),
                }
                for c in cards
            ],
            "analytics": self._analytics(set_id, user_id, len(cards)),
        }

    def record_study(
        self, user_id: str, set_id: str, flashcard_id: str, rating: str
    ) -> dict[str, Any]:
        """Upsert a study rating for a card, then return fresh analytics."""
        total = (
            self.supabase.client.table("flashcards")
            .select("id")
            .eq("set_id", set_id)
            .execute()
        ).data or []
        self.supabase.client.table("flashcard_study").upsert(
            {
                "user_id": user_id,
                "set_id": set_id,
                "flashcard_id": flashcard_id,
                "rating": rating,
            },
            on_conflict="user_id,flashcard_id",
        ).execute()
        return self._analytics(set_id, user_id, len(total))

    def _analytics(
        self, set_id: str, user_id: str, total: int
    ) -> dict[str, Any]:
        """Compute study analytics for a set."""
        study = (
            self.supabase.client.table("flashcard_study")
            .select("rating")
            .eq("user_id", user_id)
            .eq("set_id", set_id)
            .execute()
        ).data or []
        studied = len(study)
        mastered = sum(1 for s in study if s["rating"] == "easy")
        needs_revision = sum(
            1 for s in study if s["rating"] == "needs_revision"
        )
        completion = round(studied / total * 100) if total else 0
        return {
            "total": total,
            "studied": studied,
            "mastered": mastered,
            "needs_revision": needs_revision,
            "completion": completion,
        }
