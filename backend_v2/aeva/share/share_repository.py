"""Data access for the generic `shares` table."""

from typing import Any

from aeva.supabase.supabase_service import SupabaseService


class ShareRepository:
    """Persist and load share rows and their anonymous guest attempts."""

    def __init__(self, supabase: SupabaseService | None = None) -> None:
        self._supabase = supabase

    @property
    def supabase(self) -> SupabaseService:
        """Lazy Supabase client."""
        return self._supabase or SupabaseService()

    def get_by_share_id(self, share_id: str) -> dict[str, Any] | None:
        """Load a live share by its public id (no user scoping)."""
        result = (
            self.supabase.client.table("shares")
            .select("*")
            .eq("share_id", share_id)
            .is_("deleted_at", None)
            .maybe_single()
            .execute()
        )
        if not result or not result.data:
            return None
        return result.data

    def get_by_content(
        self, owner_user_id: str, content_type: str, content_id: str
    ) -> dict[str, Any] | None:
        """Return the owner's live share for a resource, if any."""
        result = (
            self.supabase.client.table("shares")
            .select("*")
            .eq("owner_user_id", owner_user_id)
            .eq("content_type", content_type)
            .eq("content_id", content_id)
            .is_("deleted_at", None)
            .maybe_single()
            .execute()
        )
        if not result or not result.data:
            return None
        return result.data

    def insert(
        self,
        *,
        share_id: str,
        owner_user_id: str,
        content_type: str,
        content_id: str,
        metadata: dict[str, Any],
        visibility: str,
    ) -> dict[str, Any]:
        """Insert a new share row with the given opaque public id."""
        result = (
            self.supabase.client.table("shares")
            .insert({
                "share_id": share_id,
                "owner_user_id": owner_user_id,
                "content_type": content_type,
                "content_id": content_id,
                "metadata": metadata,
                "visibility": visibility,
            })
            .execute()
        )
        return result.data[0]

    def update(
        self, row_id: str, owner_user_id: str, fields: dict[str, Any]
    ) -> None:
        """Owner-scoped partial update (visibility, metadata, deleted_at...)."""
        (
            self.supabase.client.table("shares")
            .update({**fields, "updated_at": "now()"})
            .eq("id", row_id)
            .eq("owner_user_id", owner_user_id)
            .execute()
        )

    def increment(self, row_id: str, metric: str) -> None:
        """Atomically bump one analytics counter (views/opens/attempts)."""
        self.supabase.client.rpc(
            "increment_share_metric",
            {"p_share_id": row_id, "p_metric": metric},
        ).execute()

    def insert_attempt(
        self, row_id: str, metadata: dict[str, Any]
    ) -> None:
        """Record an anonymous guest attempt (analytics only, no identity)."""
        (
            self.supabase.client.table("share_attempts")
            .insert({"share_id": row_id, "metadata": metadata})
            .execute()
        )
