"""Global search across the user's content."""

import logging
from typing import Any

from aeva.common.schema import UserData, success_response
from aeva.supabase.supabase_service import SupabaseService

logger = logging.getLogger(__name__)

EMPTY: dict[str, list[Any]] = {
    "sessions": [],
    "messages": [],
    "quizzes": [],
    "media": [],
    "flashcards": [],
}


class SearchRepository:
    """Full-text + substring search across the user's content."""

    @staticmethod
    def search(current_user: UserData, query: str) -> dict[str, Any]:
        """Rank results with Postgres full-text search; ILIKE as a fallback.

        Prefers the ``search_all`` RPC (tsvector + ``ts_rank`` for relevance
        ranking, combined with ILIKE for partial/exact substring matches). If
        that RPC is missing — e.g. migration ``008`` hasn't been applied yet — it
        degrades gracefully to a plain ILIKE scan so search keeps working.
        """
        q = query.strip()
        if not q:
            return success_response("No query", dict(EMPTY))

        supabase = SupabaseService()
        uid = current_user.id
        # Any DB error (most likely: migration 008 not yet applied, so the RPC
        # is missing) falls back to the substring scan below.
        try:
            results = SearchRepository._search_fts(supabase, uid, q)
        except Exception:  # noqa: BLE001
            logger.warning(
                "Full-text search unavailable; using ILIKE fallback",
                exc_info=True,
            )
            results = SearchRepository._search_ilike(supabase, uid, q)
        return success_response("Search results", results)

    @staticmethod
    def _search_fts(
        supabase: SupabaseService, uid: str, q: str
    ) -> dict[str, Any]:
        """Ranked full-text search via the ``search_all`` RPC."""
        result = supabase.client.rpc(
            "search_all", {"p_user": uid, "p_q": q}
        ).execute()
        data = result.data
        # A jsonb-returning function comes back as the object itself; tolerate a
        # single-row wrapping just in case.
        if isinstance(data, list):
            data = data[0] if data else {}
        if isinstance(data, dict) and isinstance(data.get("search_all"), dict):
            data = data["search_all"]
        if not isinstance(data, dict):
            return dict(EMPTY)
        return {**EMPTY, **data}

    @staticmethod
    def _search_ilike(
        supabase: SupabaseService, uid: str, q: str
    ) -> dict[str, Any]:
        """Substring (ILIKE) search fallback."""
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

        flashcards = SearchRepository._search_flashcards(supabase, uid, like)

        return {
            "sessions": sessions,
            "messages": messages,
            "quizzes": quizzes,
            "media": media,
            "flashcards": flashcards,
        }

    @staticmethod
    def _search_flashcards(
        supabase: SupabaseService,
        uid: str,
        like: str,
    ) -> list[dict[str, Any]]:
        """Match flashcard sets on title or topic, de-duplicated by id."""
        by_id: dict[str, dict[str, Any]] = {}
        for column in ("title", "topic"):
            rows = (
                supabase.client.table("flashcard_sets")
                .select("id, title, topic, created_at")
                .eq("user_id", uid)
                .ilike(column, like)
                .limit(8)
                .execute()
            ).data or []
            for r in rows:
                by_id[r["id"]] = r
        return list(by_id.values())

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
