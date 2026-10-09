"""Notification data access (Supabase, service-role; ownership in queries).

One bounded read: the counts come from a single grouped RPC
(``notification_digest_counts``, migration 037) that filters every table on
the given user ids through its existing ``user_id`` index.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from aeva.supabase.supabase_service import SupabaseService

if TYPE_CHECKING:
    from datetime import date, datetime


class NotificationRepository:
    """Read behind the return hook (stateless)."""

    def __init__(self, supabase: SupabaseService | None = None) -> None:
        self._supabase = supabase

    @property
    def client(self) -> Any:
        """Raw table client."""
        if self._supabase is None:
            self._supabase = SupabaseService()
        return self._supabase.client

    def digest_counts(
        self,
        user_ids: list[str],
        *,
        today: date,
        due_before: datetime,
        mastered_after: datetime,
        since: datetime,
        until: datetime,
    ) -> list[dict[str, Any]]:
        """Return what each user has waiting (only users with something)."""
        if not user_ids:
            return []
        result = self.client.rpc(
            "notification_digest_counts",
            {
                "p_user_ids": user_ids,
                "p_today": today.isoformat(),
                "p_due_before": due_before.isoformat(),
                "p_mastered_after": mastered_after.isoformat(),
                "p_since": since.isoformat(),
                "p_until": until.isoformat(),
            },
        ).execute()
        return list(result.data or [])
