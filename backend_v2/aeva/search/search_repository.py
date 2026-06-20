"""Global search across the user's content."""

from typing import Any

from aeva.common.schema import UserData, success_response
from aeva.supabase.supabase_service import SupabaseService

EMPTY: dict[str, list[Any]] = {
    "sessions": [],
    "messages": [],
    "quizzes": [],
    "media": [],
}


class SearchRepository:
    """Search sessions, messages, quizzes, and media by keyword."""

    @staticmethod
    def search(current_user: UserData, query: str) -> dict[str, Any]:
        """Run an ILIKE search across the user's content."""
        q = query.strip()
        if not q:
            return success_response("No query", dict(EMPTY))

        supabase = SupabaseService()
        uid = current_user.id
        like = f"%{q}%"

        sessions = (
            supabase.client.table("sessions")
            .select("id, title, updated_at")
            .eq("user_id", uid)
            .ilike("title", like)
            .limit(8)
            .execute()
        ).data or []

        # Messages have no user_id; scope by the user's own session ids.
        owned = (
            supabase.client.table("sessions")
            .select("id, title")
            .eq("user_id", uid)
            .execute()
        ).data or []
        title_by_id = {s["id"]: s["title"] for s in owned}
        messages: list[dict[str, Any]] = []
        if owned:
            messages = (
                supabase.client.table("messages")
                .select("id, session_id, role, content, created_at")
                .in_("session_id", list(title_by_id))
                .ilike("content", like)
                .limit(12)
                .execute()
            ).data or []
            for m in messages:
                m["session_title"] = title_by_id.get(m["session_id"], "")

        quizzes = SearchRepository._search_quizzes(supabase, uid, like)

        media = (
            supabase.client.table("media")
            .select("id, file_name, mime_type, created_at")
            .eq("user_id", uid)
            .ilike("file_name", like)
            .limit(8)
            .execute()
        ).data or []

        return success_response(
            "Search results",
            {
                "sessions": sessions,
                "messages": messages,
                "quizzes": quizzes,
                "media": media,
            },
        )

    @staticmethod
    def _search_quizzes(
        supabase: SupabaseService,
        uid: str,
        like: str,
    ) -> list[dict[str, Any]]:
        """Match quizzes on title or topic, de-duplicated by id."""
        by_id: dict[str, dict[str, Any]] = {}
        for column in ("title", "topic"):
            rows = (
                supabase.client.table("quizzes")
                .select("id, title, topic, session_id, created_at")
                .eq("user_id", uid)
                .ilike(column, like)
                .limit(8)
                .execute()
            ).data or []
            for r in rows:
                by_id[r["id"]] = r
        return list(by_id.values())
