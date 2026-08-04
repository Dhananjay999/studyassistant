"""Bookmark data access."""

from typing import Any, cast

from aeva.bookmark.schema.bookmark_schema import (
    CollectionData,
    CreateBookmarkData,
)
from aeva.common.errors import ERROR_CODES, CustomError
from aeva.common.schema import UserData, success_response
from aeva.supabase.supabase_service import SupabaseService

DEFAULT_COLLECTION = "Favorites"

# item_type -> source table whose row carries the origin session_id.
# `item_ref` holds that row's id (message id / quiz id / flashcard set id).
_SESSION_SOURCE = {
    "response": "messages",
    "quiz": "quizzes",
    "flashcard": "flashcard_sets",
}


class BookmarkRepository:
    """Persist and load bookmarks and collections."""

    @staticmethod
    def _attach_session_ids(
        supabase: SupabaseService,
        user_id: str,
        bookmarks: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        """Backfill each bookmark's origin ``session_id`` (best-effort).

        Bookmarks store only the id of their source in ``item_ref``, not the
        conversation it belongs to. Each source table (messages, quizzes,
        flashcard sets) carries ``session_id``, so one batched,
        ownership-scoped lookup per type resolves it. The value is ``None``
        when the source was deleted or never had a session, letting the
        client reopen the exact chat instead of starting a new one.
        """
        refs_by_type: dict[str, list[str]] = {}
        for bookmark in bookmarks:
            ref = bookmark.get("item_ref")
            if ref and bookmark["item_type"] in _SESSION_SOURCE:
                refs_by_type.setdefault(bookmark["item_type"], []).append(ref)

        session_of: dict[str, str] = {}
        for item_type, refs in refs_by_type.items():
            table = _SESSION_SOURCE[item_type]
            if item_type == "response":
                # messages has no user_id; scope via its session's owner.
                query = (
                    supabase.client.table(table)
                    .select("id, session_id, sessions!inner(user_id)")
                    .eq("sessions.user_id", user_id)
                )
            else:
                query = (
                    supabase.client.table(table)
                    .select("id, session_id")
                    .eq("user_id", user_id)
                )
            rows = query.in_("id", refs).execute()
            for row in cast("list[dict[str, Any]]", rows.data or []):
                session_id = row.get("session_id")
                if session_id:
                    session_of[row["id"]] = session_id

        for bookmark in bookmarks:
            bookmark["session_id"] = session_of.get(
                bookmark.get("item_ref") or ""
            )
        return bookmarks

    @staticmethod
    def _ensure_default_collection(
        supabase: SupabaseService,
        user_id: str,
    ) -> dict[str, Any]:
        """Return the user's default Favorites collection, creating it once."""
        existing = (
            supabase.client.table("bookmark_collections")
            .select("*")
            .eq("user_id", user_id)
            .eq("name", DEFAULT_COLLECTION)
            .limit(1)
            .execute()
        )
        if existing.data:
            return existing.data[0]
        created = (
            supabase.client.table("bookmark_collections")
            .insert({"user_id": user_id, "name": DEFAULT_COLLECTION})
            .execute()
        )
        return created.data[0]

    @staticmethod
    def list_collections(current_user: UserData) -> dict[str, Any]:
        """List collections, ensuring a default Favorites exists."""
        supabase = SupabaseService()
        BookmarkRepository._ensure_default_collection(
            supabase, current_user.id
        )
        result = (
            supabase.client.table("bookmark_collections")
            .select("*")
            .eq("user_id", current_user.id)
            .order("created_at")
            .execute()
        )
        return success_response("Collections retrieved", result.data or [])

    @staticmethod
    def create_collection(
        current_user: UserData,
        request_data: CollectionData,
    ) -> dict[str, Any]:
        """Create a new collection."""
        supabase = SupabaseService()
        result = (
            supabase.client.table("bookmark_collections")
            .insert({"user_id": current_user.id, "name": request_data.name})
            .execute()
        )
        return success_response("Collection created", result.data[0])

    @staticmethod
    def rename_collection(
        current_user: UserData,
        collection_id: str,
        request_data: CollectionData,
    ) -> dict[str, Any]:
        """Rename a collection."""
        supabase = SupabaseService()
        result = (
            supabase.client.table("bookmark_collections")
            .update({"name": request_data.name})
            .eq("id", collection_id)
            .eq("user_id", current_user.id)
            .execute()
        )
        if not result.data:
            raise CustomError(ERROR_CODES["NOT_FOUND"])
        return success_response("Collection renamed", result.data[0])

    @staticmethod
    def delete_collection(
        current_user: UserData,
        collection_id: str,
    ) -> dict[str, Any]:
        """Delete a collection, moving its bookmarks to Favorites."""
        supabase = SupabaseService()
        favorites = BookmarkRepository._ensure_default_collection(
            supabase, current_user.id
        )
        if collection_id != favorites["id"]:
            supabase.client.table("bookmarks").update(
                {"collection_id": favorites["id"]}
            ).eq("collection_id", collection_id).eq(
                "user_id", current_user.id
            ).execute()
        supabase.client.table("bookmark_collections").delete().eq(
            "id", collection_id
        ).eq("user_id", current_user.id).execute()
        return success_response("Collection deleted", {"id": collection_id})

    @staticmethod
    def list_bookmarks(
        current_user: UserData, space_id: str | None = None
    ) -> dict[str, Any]:
        """List bookmarks for the user, optionally scoped to one space."""
        supabase = SupabaseService()
        query = (
            supabase.client.table("bookmarks")
            .select("*")
            .eq("user_id", current_user.id)
        )
        if space_id:
            query = query.eq("space_id", space_id)
        result = query.order("created_at", desc=True).execute()
        bookmarks = BookmarkRepository._attach_session_ids(
            supabase,
            current_user.id,
            cast("list[dict[str, Any]]", result.data or []),
        )
        return success_response("Bookmarks retrieved", bookmarks)

    @staticmethod
    def get_bookmark(
        current_user: UserData,
        bookmark_id: str,
    ) -> dict[str, Any]:
        """Fetch a single bookmark with its full stored content."""
        supabase = SupabaseService()
        result = (
            supabase.client.table("bookmarks")
            .select("*")
            .eq("id", bookmark_id)
            .eq("user_id", current_user.id)
            .maybe_single()
            .execute()
        )
        if not result or not result.data:
            raise CustomError(ERROR_CODES["NOT_FOUND"])
        bookmark = BookmarkRepository._attach_session_ids(
            supabase,
            current_user.id,
            [cast("dict[str, Any]", result.data)],
        )[0]
        return success_response("Bookmark retrieved", bookmark)

    @staticmethod
    def create_bookmark(
        current_user: UserData,
        request_data: CreateBookmarkData,
    ) -> dict[str, Any]:
        """Create a bookmark, defaulting to the Favorites collection."""
        supabase = SupabaseService()
        collection_id = request_data.collection_id
        if not collection_id:
            favorites = BookmarkRepository._ensure_default_collection(
                supabase, current_user.id
            )
            collection_id = favorites["id"]
        result = (
            supabase.client.table("bookmarks")
            .insert({
                "user_id": current_user.id,
                "collection_id": collection_id,
                "item_type": request_data.item_type,
                "item_ref": request_data.item_ref,
                "title": request_data.title,
                "content": request_data.content,
                "metadata": request_data.metadata,
                # Always filed into a space (explicit > General).
                "space_id": supabase.resolve_space(
                    current_user.id, request_data.space_id
                ),
            })
            .execute()
        )
        return success_response("Bookmark created", result.data[0])

    @staticmethod
    def update_bookmark(
        current_user: UserData,
        bookmark_id: str,
        data: dict[str, Any],
    ) -> dict[str, Any]:
        """Update a bookmark (move collection / rename)."""
        supabase = SupabaseService()
        result = (
            supabase.client.table("bookmarks")
            .update(data)
            .eq("id", bookmark_id)
            .eq("user_id", current_user.id)
            .execute()
        )
        if not result.data:
            raise CustomError(ERROR_CODES["NOT_FOUND"])
        return success_response("Bookmark updated", result.data[0])

    @staticmethod
    def delete_bookmark(
        current_user: UserData,
        bookmark_id: str,
    ) -> dict[str, Any]:
        """Delete a bookmark."""
        supabase = SupabaseService()
        supabase.client.table("bookmarks").delete().eq(
            "id", bookmark_id
        ).eq("user_id", current_user.id).execute()
        return success_response("Bookmark deleted", {"id": bookmark_id})
