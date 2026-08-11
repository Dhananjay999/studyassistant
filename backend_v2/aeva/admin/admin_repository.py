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
from aeva.feature_flag import feature_flag_service
from aeva.supabase.supabase_service import SupabaseService

logger = logging.getLogger(__name__)

# A sentinel that never matches a real uuid PK, used to satisfy PostgREST's
# requirement that a DELETE carries a filter while still matching every row.
_MATCH_ALL = "id.neq.00000000-0000-0000-0000-000000000000"


def _chunks(items: list[str], size: int) -> list[list[str]]:
    """Split ids into ``in_``-friendly batches (PostgREST URL length cap)."""
    return [items[i : i + size] for i in range(0, len(items), size)]

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
            "is_debug_user": bool(row.get("is_debug_user")),
            "last_active": counts.get("last_active"),
            "total_chats": counts.get("sessions", 0),
            "total_quizzes": counts.get("quizzes", 0),
            "total_flashcards": counts.get("flashcards", 0),
            "storage_used": counts.get("storage_used", 0),
        }

    # ------------------------------------------------------------------
    # Feature flags
    # ------------------------------------------------------------------

    def list_feature_flags(self) -> dict[str, Any]:
        """Registry merged with DB overrides, in registry order."""
        return success_response(
            "Feature flags",
            {"flags": feature_flag_service.list_flags_with_meta()},
        )

    def set_feature_flag(self, key: str, enabled: bool) -> dict[str, Any]:
        """Upsert one flag override; 404 on a key not in the registry."""
        if key not in feature_flag_service.FLAG_KEYS:
            raise CustomError(ERROR_CODES["NOT_FOUND"])
        self.client.table("feature_flags").upsert({
            "key": key,
            "enabled": enabled,
            "updated_at": datetime.now(UTC).isoformat(),
        }).execute()
        feature_flag_service.invalidate_cache()
        logger.info(
            "Admin %s feature %s",
            "enabled" if enabled else "disabled",
            key,
        )
        return success_response(
            "Feature flag updated", {"key": key, "enabled": enabled}
        )

    # ------------------------------------------------------------------
    # Audit log
    # ------------------------------------------------------------------

    def _audit(
        self,
        admin: str,
        action: str,
        user_id: str | None = None,
        resource: str | None = None,
        detail: dict[str, Any] | None = None,
    ) -> None:
        """Record a sensitive admin action. Best-effort: never blocks."""
        try:
            self.client.table("admin_audit_log").insert({
                "admin_username": admin,
                "action": action,
                "user_id": user_id,
                "resource": resource,
                "detail": detail or {},
            }).execute()
        except Exception:  # noqa: BLE001 — audit is best-effort by design.
            logger.warning("Audit write failed (%s)", action, exc_info=True)

    def list_audit(
        self, user_id: str | None = None, limit: int = 100
    ) -> dict[str, Any]:
        """Recent audit entries, optionally for one user."""
        query = (
            self.client.table("admin_audit_log")
            .select("*")
            .order("created_at", desc=True)
            .limit(min(limit, 200))
        )
        if user_id:
            query = query.eq("user_id", user_id)
        try:
            rows = query.execute().data or []
        except Exception:  # migration 019 not applied yet
            logger.warning("Audit log unavailable", exc_info=True)
            rows = []
        return success_response("Audit log", {"entries": rows})

    # ------------------------------------------------------------------
    # Developer Mode (debug users)
    # ------------------------------------------------------------------

    def list_debug_users(self) -> dict[str, Any]:
        """All users with Developer Mode currently enabled."""
        res = (
            self.client.table("profiles")
            .select("id,email,full_name,avatar_url,created_at")
            .eq("is_debug_user", True)
            .order("email")
            .execute()
        )
        return success_response(
            "Debug users loaded", {"users": res.data or []}
        )

    def set_debug_user(
        self, admin: str, user_id: str, enabled: bool
    ) -> dict[str, Any]:
        """Enable/disable Developer Mode for one user (role-independent)."""
        res = (
            self.client.table("profiles")
            .update({"is_debug_user": enabled})
            .eq("id", user_id)
            .execute()
        )
        if not res.data:
            raise CustomError(ERROR_CODES["NOT_FOUND"])
        logger.info(
            "Admin %s Developer Mode for user %s",
            "enabled" if enabled else "disabled",
            user_id,
        )
        self._audit(
            admin,
            "debug_user.enable" if enabled else "debug_user.disable",
            user_id=user_id,
        )
        return success_response(
            "Debug flag updated",
            {"user_id": user_id, "is_debug_user": enabled},
        )

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
            "is_debug_user": bool(profile.get("is_debug_user")),
            "learning_profile": {
                "education_level": profile.get("education_level"),
                "preferred_language": profile.get("preferred_language"),
                "explanation_style": profile.get("explanation_style"),
                "favorite_subjects": profile.get("favorite_subjects") or [],
                "learning_goal": profile.get("learning_goal"),
                "ai_personality": profile.get("ai_personality"),
                "communication_style": profile.get("communication_style"),
                "custom_instructions": profile.get("custom_instructions"),
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

    def reset_learning_profile(
        self, admin: str, user_id: str
    ) -> dict[str, Any]:
        """Clear a user's learning profile back to the pending state."""
        if not self.supabase.get_profile(user_id):
            raise CustomError(ERROR_CODES["NOT_FOUND"])
        fields: dict[str, Any] = dict.fromkeys(_LEARNING_FIELDS)
        fields["favorite_subjects"] = []
        fields["personalization_status"] = "pending"
        self.supabase.update_learning_profile(user_id, fields)
        self._audit(admin, "profile.reset", user_id=user_id)
        return success_response(
            "Learning profile reset", {"user_id": user_id}
        )

    def edit_profile(
        self, admin: str, user_id: str, patch: dict[str, Any]
    ) -> dict[str, Any]:
        """Edit non-sensitive profile/personalization fields (audited)."""
        if not self.supabase.get_profile(user_id):
            raise CustomError(ERROR_CODES["NOT_FOUND"])
        if not patch:
            raise CustomError(ERROR_CODES["VALIDATION_ERROR"])
        res = (
            self.client.table("profiles")
            .update(patch)
            .eq("id", user_id)
            .execute()
        )
        if not res.data:
            raise CustomError(ERROR_CODES["NOT_FOUND"])
        self._audit(
            admin,
            "profile.edit",
            user_id=user_id,
            resource="profile",
            detail={"fields": sorted(patch)},
        )
        return success_response("Profile updated", res.data[0])

    def clear_user_resource(
        self, admin: str, user_id: str, resource: str
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
        self._audit(
            admin, "resource.clear", user_id=user_id, resource=resource
        )
        return success_response(
            f"Cleared {resource}",
            {"user_id": user_id, "resource": resource},
        )

    def delete_user(self, admin: str, user_id: str) -> dict[str, Any]:
        """Delete a user and everything they own (DB cascade + storage)."""
        if not self.supabase.get_profile(user_id):
            raise CustomError(ERROR_CODES["NOT_FOUND"])
        self._audit(admin, "user.delete", user_id=user_id)
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

    def delete_all(self, admin: str, resource: str) -> dict[str, Any]:
        """Delete every row of a resource across all users (DANGER)."""
        self._audit(admin, "resource.delete_all", resource=resource)
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
    # User inspection (quiz / flashcards / media / timeline / search)
    # ------------------------------------------------------------------

    def quiz_detail(self, quiz_id: str) -> dict[str, Any]:
        """Full quiz: config, every question with answers, all attempts."""
        quiz = (
            self.client.table("quizzes")
            .select("*")
            .eq("id", quiz_id)
            .maybe_single()
            .execute()
        )
        if not quiz or not quiz.data:
            raise CustomError(ERROR_CODES["NOT_FOUND"])
        questions = (
            self.client.table("quiz_questions")
            .select("*")
            .eq("quiz_id", quiz_id)
            .order("sort_order")
            .execute()
        ).data or []
        attempts = (
            self.client.table("quiz_attempts")
            .select("*")
            .eq("quiz_id", quiz_id)
            .order("created_at", desc=True)
            .execute()
        ).data or []
        return success_response("Quiz detail", {
            "quiz": quiz.data,
            "questions": questions,
            "attempts": attempts,
        })

    def flashcard_detail(self, set_id: str) -> dict[str, Any]:
        """Full flashcard set: cards + the user's per-card study state."""
        fset = (
            self.client.table("flashcard_sets")
            .select("*")
            .eq("id", set_id)
            .maybe_single()
            .execute()
        )
        if not fset or not fset.data:
            raise CustomError(ERROR_CODES["NOT_FOUND"])
        cards = (
            self.client.table("flashcards")
            .select("*")
            .eq("set_id", set_id)
            .order("sort_order")
            .execute()
        ).data or []
        study = (
            self.client.table("flashcard_study")
            .select("flashcard_id,rating,updated_at")
            .eq("set_id", set_id)
            .execute()
        ).data or []
        by_card = {s["flashcard_id"]: s for s in study}
        for card in cards:
            card["study"] = by_card.get(card["id"])
        return success_response("Flashcard detail", {
            "set": fset.data,
            "cards": cards,
        })

    def media_detail(self, media_id: str) -> dict[str, Any]:
        """One media row with processing/parsing/embedding state + URL."""
        row = (
            self.client.table("media")
            .select("*")
            .eq("id", media_id)
            .maybe_single()
            .execute()
        )
        if not row or not row.data:
            raise CustomError(ERROR_CODES["NOT_FOUND"])
        media = dict(row.data)
        media["signed_url"] = self.supabase.get_signed_url(
            media["storage_path"]
        )
        pages = (
            self.client.table("media_pages")
            .select("id", count="exact")
            .eq("media_id", media_id)
            .limit(1)
            .execute()
        )
        chunks = (
            self.client.table("media_chunks")
            .select("id", count="exact")
            .eq("media_id", media_id)
            .limit(1)
            .execute()
        )
        media["parsed_pages"] = pages.count or 0
        media["embedded_chunks"] = chunks.count or 0
        return success_response("Media detail", media)

    def timeline(self, user_id: str, limit: int = 100) -> dict[str, Any]:
        """Unified activity feed: questions, quizzes, attempts, cards, files.

        Each event: ``{at, type, label, ref}`` — enough for a readable
        timeline without exposing raw rows.
        """
        events: list[dict[str, Any]] = []

        session_rows = (
            self.client.table("sessions")
            .select("id,title")
            .eq("user_id", user_id)
            .execute()
        ).data or []
        titles = {s["id"]: s["title"] for s in session_rows}
        for chunk in _chunks(list(titles), 100):
            msgs = (
                self.client.table("messages")
                .select("id,session_id,content,created_at")
                .eq("role", "user")
                .in_("session_id", chunk)
                .order("created_at", desc=True)
                .limit(limit)
                .execute()
            ).data or []
            events += [
                {
                    "at": m["created_at"],
                    "type": "message",
                    "label": f"Asked: {(m['content'] or '')[:120]}",
                    "ref": m["session_id"],
                }
                for m in msgs
            ]

        quizzes = (
            self.client.table("quizzes")
            .select("id,title,created_at")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        ).data or []
        quiz_titles = {q["id"]: q["title"] for q in quizzes}
        events += [
            {
                "at": q["created_at"],
                "type": "quiz_created",
                "label": f"Generated Quiz — {q['title']}",
                "ref": q["id"],
            }
            for q in quizzes
        ]

        attempts = (
            self.client.table("quiz_attempts")
            .select("id,quiz_id,score,created_at")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        ).data or []
        events += [
            {
                "at": a["created_at"],
                "type": "quiz_attempt",
                "label": (
                    f"Completed Quiz — "
                    f"{quiz_titles.get(a['quiz_id'], 'Quiz')} "
                    f"({round(float(a.get('score') or 0))}%)"
                ),
                "ref": a["quiz_id"],
            }
            for a in attempts
        ]

        for table, ev_type, label_fn in (
            (
                "flashcard_sets",
                "flashcards_created",
                lambda r: f"Generated Flashcards — {r['title']}",
            ),
            (
                "media",
                "media_uploaded",
                lambda r: f"Uploaded {r['file_name']}",
            ),
            (
                "notes",
                "note_created",
                lambda r: f"Saved Note — {r['title']}",
            ),
        ):
            columns = (
                "id,file_name,created_at"
                if table == "media"
                else "id,title,created_at"
            )
            try:
                rows = (
                    self.client.table(table)
                    .select(columns)
                    .eq("user_id", user_id)
                    .order("created_at", desc=True)
                    .limit(limit)
                    .execute()
                ).data or []
            except Exception:  # table from a later migration may be absent
                rows = []
            events += [
                {
                    "at": r["created_at"],
                    "type": ev_type,
                    "label": label_fn(r),
                    "ref": r["id"],
                }
                for r in rows
            ]

        events.sort(key=lambda e: str(e["at"]), reverse=True)
        return success_response(
            "Timeline", {"events": events[:limit]}
        )

    def user_search(self, user_id: str, q: str) -> dict[str, Any]:
        """Everything matching ``q`` inside one user's content.

        Reuses the app's ranked ``search_all`` RPC scoped to the target user
        — the admin sees exactly what the student's own search would find.
        """
        term = (q or "").strip()
        if not term:
            return success_response("Search", {})
        try:
            result = self.client.rpc(
                "search_all", {"p_user": user_id, "p_q": term}
            ).execute()
            data = result.data
            if isinstance(data, list):
                data = data[0] if data else {}
            if not isinstance(data, dict):
                data = {}
        except Exception:  # RPC missing (migration not applied)
            logger.warning("search_all RPC unavailable", exc_info=True)
            data = {}
        return success_response("Search results", data)

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
        self, admin: str, resource: str, item_id: str
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
        self._audit(
            admin, "resource.delete", resource=f"{resource}:{item_id}"
        )
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
