"""Admin business logic: platform stats, user management, and deletions.

All queries run through the service-role Supabase client, which bypasses RLS,
so this layer can read and write across every user's data. That power is the
whole point of the admin panel — and the reason every route that reaches here
is guarded by ``admin_required``.

Aggregates for the user list are scoped to the current page's user ids
(``in_``), so list latency does not grow with total rows. The few full-table
scans that remain (storage sums, message counts for one user) are bounded to a
single user and acceptable for an internal tool.
"""

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from flask import current_app

from aeva.common.errors import ERROR_CODES, CustomError
from aeva.common.schema import success_response
from aeva.supabase.supabase_service import SupabaseService

logger = logging.getLogger(__name__)

# A sentinel that never matches a real uuid PK, used to satisfy PostgREST's
# requirement that a DELETE carries a filter while still matching every row.
_MATCH_ALL = "id.neq.00000000-0000-0000-0000-000000000000"

# Learning-profile columns cleared by a profile reset.
_LEARNING_FIELDS = (
    "education_level",
    "preferred_language",
    "explanation_style",
    "learning_goal",
)

# Per-user "delete all X" targets -> the table whose user_id rows to drop.
# Deleting a parent row cascades children via ON DELETE CASCADE FKs.
_USER_RESOURCE_TABLES = {
    "sessions": "sessions",
    "chats": "sessions",
    "quizzes": "quizzes",
    "flashcards": "flashcard_sets",
    "bookmarks": "bookmarks",
}

# Global "delete all X" targets (across every user). "files" and "users" are
# handled specially (storage cleanup / cascade through profiles).
_GLOBAL_RESOURCE_TABLES = {
    "sessions": "sessions",
    "chats": "sessions",
    "quizzes": "quizzes",
    "flashcards": "flashcard_sets",
    "bookmarks": "bookmarks",
}

# Listable/searchable resources for the global managers. "table" is the
# physical table, "columns" the safe projection, "search" the ilike-able text
# columns, and "order" the default newest-first sort key. Every table here has
# a user_id FK to profiles, so the owner can be embedded.
_RESOURCE_CONFIG: dict[str, dict[str, Any]] = {
    "sessions": {
        "table": "sessions",
        "columns": "id, title, mode, created_at, updated_at, user_id",
        "search": ["title"],
        "order": "updated_at",
    },
    "quizzes": {
        "table": "quizzes",
        "columns": "id, title, topic, created_at, user_id",
        "search": ["title", "topic"],
        "order": "created_at",
    },
    "flashcards": {
        "table": "flashcard_sets",
        "columns": "id, title, topic, source_type, created_at, user_id",
        "search": ["title", "topic"],
        "order": "created_at",
    },
    "bookmarks": {
        "table": "bookmarks",
        "columns": "id, title, item_type, created_at, user_id",
        "search": ["title"],
        "order": "created_at",
    },
    "files": {
        "table": "media",
        "columns": (
            "id, file_name, mime_type, size_bytes, created_at, user_id"
        ),
        "search": ["file_name"],
        "order": "created_at",
    },
}


class AdminRepository:
    """Stateless-ish admin operations over the service-role client."""

    def __init__(self, supabase: SupabaseService | None = None) -> None:
        self._supabase = supabase

    @property
    def supabase(self) -> SupabaseService:
        """Lazy Supabase service (service-role client)."""
        return self._supabase or SupabaseService()

    @property
    def client(self) -> Any:
        """Shortcut to the underlying Supabase client."""
        return self.supabase.client

    # ------------------------------------------------------------------
    # Count / time helpers
    # ------------------------------------------------------------------

    def _count(self, table: str) -> int:
        """Exact row count for a table."""
        res = (
            self.client.table(table)
            .select("id", count="exact")
            .limit(1)
            .execute()
        )
        return res.count or 0

    def _count_eq(self, table: str, column: str, value: str) -> int:
        """Exact row count filtered by a single equality."""
        res = (
            self.client.table(table)
            .select("id", count="exact")
            .eq(column, value)
            .limit(1)
            .execute()
        )
        return res.count or 0

    @staticmethod
    def _now() -> datetime:
        return datetime.now(tz=UTC)

    def _today_start_iso(self) -> str:
        start = self._now().replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        return start.isoformat()

    def _days_ago_iso(self, days: int) -> str:
        return (self._now() - timedelta(days=days)).isoformat()

    # ------------------------------------------------------------------
    # Overview
    # ------------------------------------------------------------------

    def overview(self) -> dict[str, Any]:
        """Platform-wide counters for the dashboard."""
        sessions = self._count("sessions")
        new_today = (
            self.client.table("profiles")
            .select("id", count="exact")
            .gte("created_at", self._today_start_iso())
            .limit(1)
            .execute()
            .count
            or 0
        )
        active_rows = (
            self.client.table("sessions")
            .select("user_id")
            .gte("updated_at", self._days_ago_iso(7))
            .execute()
            .data
            or []
        )
        active_users = len({r["user_id"] for r in active_rows})

        data = {
            "total_users": self._count("profiles"),
            # A "chat" is a session in this product; reported under both keys
            # so the dashboard can label them separately.
            "total_chats": sessions,
            "total_sessions": sessions,
            "total_messages": self._count("messages"),
            "total_quizzes": self._count("quizzes"),
            "total_flashcard_sets": self._count("flashcard_sets"),
            "total_bookmarks": self._count("bookmarks"),
            "total_files": self._count("media"),
            "active_users": active_users,
            "new_users_today": new_today,
        }
        return success_response("Overview loaded", data)

    # ------------------------------------------------------------------
    # User list
    # ------------------------------------------------------------------

    def list_users(self, query: Any) -> dict[str, Any]:
        """Paginated, searchable, sortable user list with per-user counts."""
        offset = (query.page - 1) * query.page_size
        base = self.client.table("profiles").select("*", count="exact")
        if query.q:
            like = query.q.replace(",", " ").replace("%", "").strip()
            base = base.or_(
                f"email.ilike.%{like}%,full_name.ilike.%{like}%"
            )
        if query.status != "all":
            base = base.eq("personalization_status", query.status)

        res = (
            base.order(query.sort, desc=(query.order == "desc"))
            .range(offset, offset + query.page_size - 1)
            .execute()
        )
        rows = res.data or []
        ids = [r["id"] for r in rows]
        agg = self._user_aggregates(ids)
        users = [self._user_summary(r, agg) for r in rows]

        data = {
            "users": users,
            "total": res.count or 0,
            "page": query.page,
            "page_size": query.page_size,
        }
        return success_response("Users loaded", data)

    def _user_aggregates(
        self, ids: list[str]
    ) -> dict[str, dict[str, Any]]:
        """Per-user counts + last-active + storage for a page of users."""
        agg: dict[str, dict[str, Any]] = {
            uid: {
                "sessions": 0,
                "quizzes": 0,
                "flashcards": 0,
                "storage_used": 0,
                "last_active": None,
            }
            for uid in ids
        }
        if not ids:
            return agg

        for row in self._rows("sessions", "user_id, updated_at", ids):
            entry = agg[row["user_id"]]
            entry["sessions"] += 1
            updated = row.get("updated_at")
            if updated and (
                entry["last_active"] is None
                or updated > entry["last_active"]
            ):
                entry["last_active"] = updated
        for row in self._rows("quizzes", "user_id", ids):
            agg[row["user_id"]]["quizzes"] += 1
        for row in self._rows("flashcard_sets", "user_id", ids):
            agg[row["user_id"]]["flashcards"] += 1
        for row in self._rows("media", "user_id, size_bytes", ids):
            agg[row["user_id"]]["storage_used"] += row.get("size_bytes") or 0
        return agg

    def _rows(
        self, table: str, columns: str, ids: list[str]
    ) -> list[dict[str, Any]]:
        """Fetch ``columns`` for rows whose user_id is in ``ids``."""
        return (
            self.client.table(table)
            .select(columns)
            .in_("user_id", ids)
            .execute()
            .data
            or []
        )

    @staticmethod
    def _user_summary(
        row: dict[str, Any], agg: dict[str, dict[str, Any]]
    ) -> dict[str, Any]:
        """Shape a profile row + aggregates into a list item."""
        counts = agg.get(row["id"], {})
        return {
            "id": row["id"],
            "email": row.get("email"),
            "full_name": row.get("full_name"),
            "avatar_url": row.get("avatar_url"),
            "login_provider": "google",
            "joined_at": row.get("created_at"),
            "personalization_status": row.get("personalization_status")
            or "pending",
            "last_active": counts.get("last_active"),
            "total_chats": counts.get("sessions", 0),
            "total_quizzes": counts.get("quizzes", 0),
            "total_flashcards": counts.get("flashcards", 0),
            "storage_used": counts.get("storage_used", 0),
        }

    # ------------------------------------------------------------------
    # User detail
    # ------------------------------------------------------------------

    def get_user(self, user_id: str) -> dict[str, Any]:
        """Full detail for one user: profile, counts, and recent items."""
        profile = self.supabase.get_profile(user_id)
        if not profile:
            raise CustomError(ERROR_CODES["NOT_FOUND"])

        session_ids = [
            r["id"]
            for r in (
                self.client.table("sessions")
                .select("id")
                .eq("user_id", user_id)
                .execute()
                .data
                or []
            )
        ]
        message_count = 0
        if session_ids:
            message_count = (
                self.client.table("messages")
                .select("id", count="exact")
                .in_("session_id", session_ids)
                .limit(1)
                .execute()
                .count
                or 0
            )

        storage_rows = (
            self.client.table("media")
            .select("size_bytes")
            .eq("user_id", user_id)
            .execute()
            .data
            or []
        )
        storage_used = sum(r.get("size_bytes") or 0 for r in storage_rows)

        data = {
            "profile": self._profile_view(profile),
            "counts": {
                "sessions": len(session_ids),
                "messages": message_count,
                "quizzes": self._count_eq("quizzes", "user_id", user_id),
                "flashcards": self._count_eq(
                    "flashcard_sets", "user_id", user_id
                ),
                "bookmarks": self._count_eq(
                    "bookmarks", "user_id", user_id
                ),
                "files": len(storage_rows),
            },
            "storage_used": storage_used,
            "sessions": self._recent(
                "sessions", user_id, "id, title, mode, created_at, updated_at"
            ),
            "quizzes": self._recent(
                "quizzes", user_id, "id, title, topic, created_at"
            ),
            "flashcards": self._recent(
                "flashcard_sets", user_id, "id, title, topic, created_at"
            ),
            "bookmarks": self._recent(
                "bookmarks", user_id, "id, title, item_type, created_at"
            ),
            "files": self._recent(
                "media",
                user_id,
                "id, file_name, mime_type, size_bytes, created_at",
            ),
            # Per-login history is not tracked yet; surfaced for the UI as an
            # empty list so the contract is stable when it lands.
            "login_history": [],
        }
        return success_response("User loaded", data)

    @staticmethod
    def _profile_view(profile: dict[str, Any]) -> dict[str, Any]:
        """Public-for-admin shape of a profile row, incl. learning fields."""
        return {
            "id": profile["id"],
            "email": profile.get("email"),
            "full_name": profile.get("full_name"),
            "avatar_url": profile.get("avatar_url"),
            "login_provider": "google",
            "joined_at": profile.get("created_at"),
            "personalization_status": profile.get("personalization_status")
            or "pending",
            "learning_profile": {
                "education_level": profile.get("education_level"),
                "preferred_language": profile.get("preferred_language"),
                "explanation_style": profile.get("explanation_style"),
                "favorite_subjects": profile.get("favorite_subjects") or [],
                "learning_goal": profile.get("learning_goal"),
            },
        }

    def _recent(
        self, table: str, user_id: str, columns: str, limit: int = 100
    ) -> list[dict[str, Any]]:
        """Recent rows for a user, newest first."""
        return (
            self.client.table(table)
            .select(columns)
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
            .data
            or []
        )

    def get_session(self, session_id: str) -> dict[str, Any]:
        """Return a session with its full conversation history."""
        res = (
            self.client.table("sessions")
            .select("*")
            .eq("id", session_id)
            .maybe_single()
            .execute()
        )
        if not res or not res.data:
            raise CustomError(ERROR_CODES["NOT_FOUND"])
        messages = self.supabase.get_messages(session_id)
        return success_response(
            "Session loaded",
            {"session": res.data, "messages": messages},
        )

    # ------------------------------------------------------------------
    # Destructive actions
    # ------------------------------------------------------------------

    def reset_learning_profile(self, user_id: str) -> dict[str, Any]:
        """Clear a user's learning profile back to the pending state."""
        if not self.supabase.get_profile(user_id):
            raise CustomError(ERROR_CODES["NOT_FOUND"])
        fields: dict[str, Any] = dict.fromkeys(_LEARNING_FIELDS)
        fields["favorite_subjects"] = []
        fields["personalization_status"] = "pending"
        self.supabase.update_learning_profile(user_id, fields)
        return success_response(
            "Learning profile reset", {"user_id": user_id}
        )

    def clear_user_resource(
        self, user_id: str, resource: str
    ) -> dict[str, Any]:
        """Delete all of one resource type for a single user."""
        if not self.supabase.get_profile(user_id):
            raise CustomError(ERROR_CODES["NOT_FOUND"])
        if resource == "files":
            self._delete_files_where("user_id", user_id)
        elif resource in _USER_RESOURCE_TABLES:
            table = _USER_RESOURCE_TABLES[resource]
            self.client.table(table).delete().eq(
                "user_id", user_id
            ).execute()
        else:
            raise CustomError(ERROR_CODES["VALIDATION_ERROR"])
        return success_response(
            f"Cleared {resource}",
            {"user_id": user_id, "resource": resource},
        )

    def delete_user(self, user_id: str) -> dict[str, Any]:
        """Delete a user and everything they own (DB cascade + storage)."""
        if not self.supabase.get_profile(user_id):
            raise CustomError(ERROR_CODES["NOT_FOUND"])
        # Storage objects are not FK-cascaded — remove them first.
        self._delete_files_where("user_id", user_id)
        try:
            self.client.auth.admin.delete_user(user_id)
        except Exception:
            logger.exception(
                "auth.admin delete failed for %s; deleting profile row",
                user_id,
            )
            # Deleting the profile row cascades sessions/quizzes/etc. via FKs.
            self.client.table("profiles").delete().eq(
                "id", user_id
            ).execute()
        return success_response("User deleted", {"user_id": user_id})

    def delete_all(self, resource: str) -> dict[str, Any]:
        """Delete every row of a resource across all users (DANGER)."""
        if resource == "files":
            self._delete_files_where(None, None)
        elif resource == "users":
            # Cascades through profiles -> all owned rows. Storage is wiped
            # first so nothing is orphaned in the bucket.
            self._delete_files_where(None, None)
            self.client.table("profiles").delete().or_(_MATCH_ALL).execute()
        elif resource in _GLOBAL_RESOURCE_TABLES:
            table = _GLOBAL_RESOURCE_TABLES[resource]
            self.client.table(table).delete().or_(_MATCH_ALL).execute()
        else:
            raise CustomError(ERROR_CODES["VALIDATION_ERROR"])
        return success_response(
            f"Deleted all {resource}", {"resource": resource}
        )

    # ------------------------------------------------------------------
    # Global resource managers + search
    # ------------------------------------------------------------------

    def list_resource(self, resource: str, query: Any) -> dict[str, Any]:
        """Paginated, searchable list of one resource across all users."""
        cfg = _RESOURCE_CONFIG.get(resource)
        if not cfg:
            raise CustomError(ERROR_CODES["VALIDATION_ERROR"])
        offset = (query.page - 1) * query.page_size
        select = f"{cfg['columns']}, owner:profiles(id, email, full_name)"
        base = self.client.table(cfg["table"]).select(select, count="exact")
        if query.user_id:
            base = base.eq("user_id", query.user_id)
        if query.q:
            like = query.q.replace(",", " ").replace("%", "").strip()
            clause = ",".join(f"{c}.ilike.%{like}%" for c in cfg["search"])
            base = base.or_(clause)
        res = (
            base.order(cfg["order"], desc=True)
            .range(offset, offset + query.page_size - 1)
            .execute()
        )
        items = [self._flatten_owner(r) for r in (res.data or [])]
        data = {
            "items": items,
            "total": res.count or 0,
            "page": query.page,
            "page_size": query.page_size,
            "resource": resource,
        }
        return success_response("Resource loaded", data)

    @staticmethod
    def _flatten_owner(row: dict[str, Any]) -> dict[str, Any]:
        """Lift the embedded ``owner`` profile into flat owner_* fields."""
        owner = row.pop("owner", None) or {}
        row["owner_id"] = owner.get("id")
        row["owner_email"] = owner.get("email")
        row["owner_name"] = owner.get("full_name")
        return row

    def delete_resource_item(
        self, resource: str, item_id: str
    ) -> dict[str, Any]:
        """Delete a single resource row (storage-aware for files)."""
        cfg = _RESOURCE_CONFIG.get(resource)
        if not cfg:
            raise CustomError(ERROR_CODES["VALIDATION_ERROR"])
        if resource == "files":
            self._delete_files_where("id", item_id)
        else:
            self.client.table(cfg["table"]).delete().eq(
                "id", item_id
            ).execute()
        return success_response(
            "Deleted", {"resource": resource, "id": item_id}
        )

    def search(self, q: str) -> dict[str, Any]:
        """Global search across users and every listable resource."""
        term = (q or "").replace(",", " ").replace("%", "").strip()
        if not term:
            return success_response("Search", {"query": "", "results": {}})
        results = {
            "users": self._search_users(term),
            "sessions": self._quick_search("sessions", term),
            "quizzes": self._quick_search("quizzes", term),
            "flashcards": self._quick_search("flashcards", term),
            "bookmarks": self._quick_search("bookmarks", term),
            "files": self._quick_search("files", term),
        }
        return success_response("Search", {"query": q, "results": results})

    def _search_users(
        self, term: str, limit: int = 8
    ) -> list[dict[str, Any]]:
        """Find users by email or name."""
        rows = (
            self.client.table("profiles")
            .select("id, email, full_name")
            .or_(f"email.ilike.%{term}%,full_name.ilike.%{term}%")
            .limit(limit)
            .execute()
            .data
            or []
        )
        return [
            {
                "id": r["id"],
                "label": r.get("full_name") or r.get("email") or r["id"],
                "sublabel": r.get("email"),
                "user_id": r["id"],
            }
            for r in rows
        ]

    def _quick_search(
        self, resource: str, term: str, limit: int = 8
    ) -> list[dict[str, Any]]:
        """Top matches for one resource, with owner email as the sublabel."""
        cfg = _RESOURCE_CONFIG[resource]
        clause = ",".join(f"{c}.ilike.%{term}%" for c in cfg["search"])
        select = f"{cfg['columns']}, owner:profiles(email, full_name)"
        rows = (
            self.client.table(cfg["table"])
            .select(select)
            .or_(clause)
            .order(cfg["order"], desc=True)
            .limit(limit)
            .execute()
            .data
            or []
        )
        out: list[dict[str, Any]] = []
        for r in rows:
            owner = r.get("owner") or {}
            out.append({
                "id": r["id"],
                "label": r.get("title") or r.get("file_name") or "(untitled)",
                "sublabel": owner.get("email"),
                "user_id": r.get("user_id"),
            })
        return out

    def _delete_files_where(
        self, column: str | None, value: str | None
    ) -> None:
        """Remove media rows (and their storage objects) by optional filter.

        ``column``/``value`` None means every file (global wipe).
        """
        query = self.client.table("media").select("id, storage_path")
        query = (
            query.eq(column, value)
            if column and value
            else query.or_(_MATCH_ALL)
        )
        rows = query.execute().data or []
        if not rows:
            return
        self._remove_storage([r["storage_path"] for r in rows if r])
        ids = [r["id"] for r in rows]
        # Delete in id batches to keep the request size bounded.
        for batch in self._chunk(ids, 200):
            self.client.table("media").delete().in_("id", batch).execute()

    def _remove_storage(self, paths: list[str]) -> None:
        """Best-effort removal of storage objects in batches."""
        bucket = current_app.config["SUPABASE_STORAGE_BUCKET"]
        for batch in self._chunk([p for p in paths if p], 100):
            try:
                self.client.storage.from_(bucket).remove(batch)
            except Exception:
                logger.exception("Storage removal failed for a batch")

    @staticmethod
    def _chunk(items: list[str], size: int) -> list[list[str]]:
        """Split a list into fixed-size chunks."""
        return [items[i : i + size] for i in range(0, len(items), size)]
