"""Study Spaces business logic.

A space owns sessions, media, quizzes, flashcard sets, and bookmarks via their
``space_id`` columns (children inherit through those parents). Every user has
exactly one default "General" space — created lazily here — which absorbs
unfiled and re-filed content. Spaces are opt-in at the product level: nothing
in this module changes behavior for users who never open the Spaces UI.
"""

import logging
from collections import Counter
from datetime import UTC, datetime, timedelta
from typing import Any

from aeva.common.errors import ERROR_CODES, CustomError
from aeva.common.schema import UserData, success_response
from aeva.space.schema.space_schema import (
    ConvertSessionData,
    CreateSpaceData,
)
from aeva.supabase.supabase_service import SupabaseService

logger = logging.getLogger(__name__)

# Content tables scoped by space_id (parents only — children cascade/follow).
_SCOPED_TABLES = (
    "sessions",
    "media",
    "quizzes",
    "flashcard_sets",
    "bookmarks",
    "notes",
)

# Overview tab payloads: table -> (response key, selected columns).
_OVERVIEW_SELECTS: dict[str, tuple[str, str]] = {
    "sessions": ("sessions", "id,title,updated_at,created_at"),
    "media": ("media", "id,file_name,mime_type,size_bytes,created_at"),
    "quizzes": ("quizzes", "id,title,topic,difficulty,created_at"),
    "flashcard_sets": ("flashcard_sets", "id,title,topic,created_at"),
    "bookmarks": ("bookmarks", "id,title,item_type,item_ref,created_at"),
    "notes": ("notes", "id,title,source_type,updated_at,created_at"),
}

# Tables whose recency is edit-driven rather than create-driven.
_ORDER_BY_UPDATED = ("sessions", "notes")
_OVERVIEW_LIMIT = 20


def _chunks(items: list[str], size: int) -> list[list[str]]:
    """Split ids into ``in_``-friendly batches (PostgREST URL length cap)."""
    return [items[i : i + size] for i in range(0, len(items), size)]


class SpaceRepository:
    """Study Spaces logic (stateless; per-request instances are fine)."""

    def __init__(self, supabase: SupabaseService | None = None) -> None:
        self._supabase = supabase

    @property
    def supabase(self) -> SupabaseService:
        """Lazy Supabase client."""
        if self._supabase is None:
            self._supabase = SupabaseService()
        return self._supabase

    @property
    def client(self) -> Any:
        """Raw table client (service-role; ownership filtered in queries)."""
        return self.supabase.client

    # ------------------------------------------------------------------
    # List / CRUD
    # ------------------------------------------------------------------

    def list_spaces(self, current_user: UserData) -> dict[str, Any]:
        """All spaces (General included) with per-space content counts."""
        # Heals brand-new accounts: guarantees General exists before listing.
        self.supabase.get_or_create_default_space(current_user.id)
        spaces = self.supabase.list_spaces(current_user.id)
        counts = self._counts_by_space(current_user.id)
        for sp in spaces:
            sp["counts"] = counts.get(sp["id"], {})
        return success_response("Spaces retrieved", spaces)

    def create_space(
        self, current_user: UserData, data: CreateSpaceData
    ) -> dict[str, Any]:
        """Create a study space."""
        space = self.supabase.create_space(
            current_user.id,
            {
                "name": data.name,
                "description": data.description,
                "subject": data.subject,
                "color": data.color,
                "icon": data.icon,
            },
        )
        return success_response("Space created", space)

    def get_space(
        self, current_user: UserData, space_id: str
    ) -> dict[str, Any]:
        """One space with its content counts."""
        space = self.supabase.get_space(space_id, current_user.id)
        if not space:
            raise CustomError(ERROR_CODES["NOT_FOUND"])
        space["counts"] = self._counts_by_space(
            current_user.id, only_space=space_id
        ).get(space_id, {})
        return success_response("Space retrieved", space)

    def update_space(
        self, current_user: UserData, space_id: str, data: dict[str, Any]
    ) -> dict[str, Any]:
        """Rename / restyle a space."""
        space = self.supabase.update_space(space_id, current_user.id, **data)
        if not space:
            raise CustomError(ERROR_CODES["NOT_FOUND"])
        return success_response("Space updated", space)

    def delete_space(
        self, current_user: UserData, space_id: str, mode: str
    ) -> dict[str, Any]:
        """Delete a space. ``move``: contents → General; ``purge``: delete all.

        General itself is undeletable. Deletion semantics live here on
        purpose — the DB FKs are SET NULL so no cascade can ever wipe content
        behind the API's back.
        """
        space = self.supabase.get_space(space_id, current_user.id)
        if not space:
            raise CustomError(ERROR_CODES["NOT_FOUND"])
        if space.get("is_default"):
            raise CustomError(ERROR_CODES["VALIDATION_ERROR"])

        if mode == "purge":
            self._purge_contents(current_user.id, space_id)
        else:
            default = self.supabase.get_or_create_default_space(
                current_user.id
            )
            self._reassign_contents(
                current_user.id, space_id, default["id"]
            )

        self.supabase.delete_space(space_id, current_user.id)
        logger.info(
            "Space %s deleted (mode=%s) for user %s",
            space_id, mode, current_user.id,
        )
        return success_response(
            "Space deleted", {"id": space_id, "mode": mode}
        )

    # ------------------------------------------------------------------
    # Overview / convert
    # ------------------------------------------------------------------

    def overview(
        self, current_user: UserData, space_id: str
    ) -> dict[str, Any]:
        """Workspace payload: the space + recent items of every content type.

        Each list query carries ``count="exact"`` so the tab badges get true
        totals without extra roundtrips.
        """
        space = self.supabase.get_space(space_id, current_user.id)
        if not space:
            raise CustomError(ERROR_CODES["NOT_FOUND"])

        data: dict[str, Any] = {"space": space}
        counts: dict[str, int] = {}
        for table, (key, columns) in _OVERVIEW_SELECTS.items():
            order = (
                "updated_at" if table in _ORDER_BY_UPDATED else "created_at"
            )
            res = (
                self.client.table(table)
                .select(columns, count="exact")
                .eq("user_id", current_user.id)
                .eq("space_id", space_id)
                .order(order, desc=True)
                .limit(_OVERVIEW_LIMIT)
                .execute()
            )
            data[key] = res.data or []
            counts[key] = res.count or 0
        data["counts"] = counts
        return success_response("Space overview", data)

    def convert_session(
        self, current_user: UserData, data: ConvertSessionData
    ) -> dict[str, Any]:
        """Promote a chat into a new space, re-filing its derived content.

        The session plus everything generated from it (media, quizzes,
        flashcard sets) moves into the new space. Bookmarks are left where
        they are: their ``item_ref`` points at messages/quizzes, not sessions,
        so re-filing them here would be guesswork.
        """
        session = self.supabase.get_session(data.session_id, current_user.id)
        if not session:
            raise CustomError(ERROR_CODES["NOT_FOUND"])

        space = self.supabase.create_space(
            current_user.id,
            {
                "name": data.name or session.get("title") or "New space",
                "subject": data.subject,
                "color": data.color,
                "icon": data.icon,
            },
        )

        self.client.table("sessions").update({"space_id": space["id"]}).eq(
            "id", data.session_id
        ).eq("user_id", current_user.id).execute()
        for table in ("media", "quizzes", "flashcard_sets"):
            self.client.table(table).update({"space_id": space["id"]}).eq(
                "session_id", data.session_id
            ).eq("user_id", current_user.id).execute()

        logger.info(
            "Session %s converted to space %s", data.session_id, space["id"]
        )
        return success_response("Space created from chat", space)

    # ------------------------------------------------------------------
    # Export
    # ------------------------------------------------------------------

    def export_markdown(
        self, current_user: UserData, space_id: str
    ) -> tuple[str, str]:
        """One markdown bundle of the whole space: ``(filename, markdown)``.

        Includes notes (full text), quizzes with questions + answers,
        flashcard decks, bookmarks, and the file list. Chats are summarized
        as a list (full transcripts would dwarf everything else and are
        already exportable per-conversation in the UI).
        """
        uid = current_user.id
        space = self.supabase.get_space(space_id, uid)
        if not space:
            raise CustomError(ERROR_CODES["NOT_FOUND"])

        def rows(table: str, columns: str, order: str) -> list[dict[str, Any]]:
            return (
                self.client.table(table)
                .select(columns)
                .eq("user_id", uid)
                .eq("space_id", space_id)
                .order(order, desc=True)
                .execute()
            ).data or []

        out: list[str] = [f"# {space['name']}"]
        sub = " · ".join(
            s for s in (space.get("subject"), space.get("description")) if s
        )
        if sub:
            out.append(f"\n> {sub}")
        out.append(
            f"\n_Exported from StudyAssistant on "
            f"{datetime.now(UTC).date().isoformat()}_\n"
        )

        notes = rows("notes", "title,content_md,updated_at", "updated_at")
        if notes:
            out.append("\n## Notes\n")
            for n in notes:
                out.append(f"### {n['title']}\n\n{n['content_md']}\n")

        quizzes = rows("quizzes", "id,title,topic,difficulty", "created_at")
        if quizzes:
            out.append("\n## Quizzes\n")
            for z in quizzes:
                out.append(
                    f"### {z['title']}"
                    + (f" ({z['difficulty']})" if z.get("difficulty") else "")
                    + "\n"
                )
                questions = (
                    self.client.table("quiz_questions")
                    .select("prompt,options,correct_answers,sort_order")
                    .eq("quiz_id", z["id"])
                    .order("sort_order")
                    .execute()
                ).data or []
                for i, qq in enumerate(questions, 1):
                    out.append(f"{i}. {qq['prompt']}")
                    for opt in qq.get("options") or []:
                        mark = (
                            "x"
                            if opt in (qq.get("correct_answers") or [])
                            else " "
                        )
                        out.append(f"    - [{mark}] {opt}")
                out.append("")

        sets = rows("flashcard_sets", "id,title,topic", "created_at")
        if sets:
            out.append("\n## Flashcards\n")
            for fs in sets:
                out.append(f"### {fs['title']}\n")
                cards = (
                    self.client.table("flashcards")
                    .select("front,back,sort_order")
                    .eq("set_id", fs["id"])
                    .order("sort_order")
                    .execute()
                ).data or []
                for c in cards:
                    out.append(f"- **Q:** {c['front']}\n  **A:** {c['back']}")
                out.append("")

        bookmarks = rows("bookmarks", "title,item_type,content", "created_at")
        if bookmarks:
            out.append("\n## Bookmarks\n")
            for b in bookmarks:
                out.append(f"- **{b['title'] or 'Bookmark'}** ({b['item_type']})")

        media = rows("media", "file_name,size_bytes", "created_at")
        if media:
            out.append("\n## Files\n")
            for m in media:
                kb = round((m.get("size_bytes") or 0) / 1024)
                out.append(f"- {m['file_name']} ({kb} KB)")

        sessions = rows("sessions", "title,updated_at", "updated_at")
        if sessions:
            out.append("\n## Chats\n")
            for s in sessions:
                out.append(f"- {s['title']}")

        safe_name = "".join(
            ch if ch.isalnum() or ch in " -_" else "_"
            for ch in space["name"]
        ).strip() or "study-space"
        return f"{safe_name}.md", "\n".join(out) + "\n"

    # ------------------------------------------------------------------
    # Progress stats
    # ------------------------------------------------------------------

    def stats(self, current_user: UserData, space_id: str) -> dict[str, Any]:
        """Learning-progress metrics for one space, from existing tables.

        Everything derives from rows that already exist (messages, attempts,
        study events) — no event tracking infrastructure. Study time is
        approximated by active days; weak/strong topics come from per-quiz
        average attempt scores.
        """
        space = self.supabase.get_space(space_id, current_user.id)
        if not space:
            raise CustomError(ERROR_CODES["NOT_FOUND"])
        uid = current_user.id

        session_ids = self._ids("sessions", uid, space_id)
        quizzes = (
            self.client.table("quizzes")
            .select("id,title,topic")
            .eq("user_id", uid)
            .eq("space_id", space_id)
            .execute()
        ).data or []
        set_ids = self._ids("flashcard_sets", uid, space_id)

        # Questions asked: the user's messages across the space's sessions.
        user_msgs: list[dict[str, Any]] = []
        for chunk in _chunks(session_ids, 100):
            user_msgs += (
                self.client.table("messages")
                .select("id,created_at")
                .eq("role", "user")
                .in_("session_id", chunk)
                .execute()
            ).data or []

        attempts: list[dict[str, Any]] = []
        for chunk in _chunks([q["id"] for q in quizzes], 100):
            attempts += (
                self.client.table("quiz_attempts")
                .select("quiz_id,score,created_at")
                .eq("user_id", uid)
                .in_("quiz_id", chunk)
                .execute()
            ).data or []

        reviews: list[dict[str, Any]] = []
        for chunk in _chunks(set_ids, 100):
            reviews += (
                self.client.table("flashcard_study")
                .select("id,updated_at")
                .eq("user_id", uid)
                .in_("set_id", chunk)
                .execute()
            ).data or []

        scores = [
            float(a["score"]) for a in attempts if a.get("score") is not None
        ]
        avg_score = round(sum(scores) / len(scores)) if scores else 0

        # Weak/strong topics: average score per quiz topic (attempted only).
        by_topic: dict[str, list[float]] = {}
        titles = {q["id"]: (q.get("topic") or q.get("title") or "").strip()
                  for q in quizzes}
        for a in attempts:
            if a.get("score") is None:
                continue
            topic = titles.get(a["quiz_id"]) or "General"
            by_topic.setdefault(topic, []).append(float(a["score"]))
        topic_avgs = {
            t: round(sum(s) / len(s)) for t, s in by_topic.items()
        }
        weak = [
            {"topic": t, "score": s}
            for t, s in sorted(
                ((t, s) for t, s in topic_avgs.items() if s < 60),
                key=lambda ts: ts[1],
            )[:5]
        ]
        strong = [
            {"topic": t, "score": s}
            for t, s in sorted(
                ((t, s) for t, s in topic_avgs.items() if s >= 80),
                key=lambda ts: -ts[1],
            )[:5]
        ]

        # Active days + streak from any activity timestamp in the space.
        days = {
            str(row.get("created_at") or row.get("updated_at") or "")[:10]
            for row in (*user_msgs, *attempts, *reviews)
        }
        days.discard("")
        streak = 0
        cursor = datetime.now(UTC).date()
        if cursor.isoformat() not in days:
            cursor -= timedelta(days=1)
        while cursor.isoformat() in days:
            streak += 1
            cursor -= timedelta(days=1)

        # Overall progress: engagement (questions + reviews + attempts,
        # saturating) blended with mastery (average score).
        engagement = min(
            1.0,
            (len(user_msgs) / 40 + len(attempts) / 8 + len(reviews) / 60) / 3,
        )
        mastery = avg_score / 100
        progress = round((0.5 * engagement + 0.5 * mastery) * 100)

        counts = self._counts_by_space(uid, only_space=space_id).get(
            space_id, {}
        )
        return success_response("Space stats", {
            "questions_asked": len(user_msgs),
            "media_uploaded": counts.get("media", 0),
            "notes_count": counts.get("notes", 0),
            "quizzes_total": len(quizzes),
            "quizzes_completed": len({a["quiz_id"] for a in attempts}),
            "attempts": len(attempts),
            "average_score": avg_score,
            "best_score": round(max(scores)) if scores else 0,
            "flashcards_reviewed": len(reviews),
            "active_days": len(days),
            "streak_days": streak,
            "weak_topics": weak,
            "strong_topics": strong,
            "progress": progress,
        })

    def _ids(self, table: str, user_id: str, space_id: str) -> list[str]:
        """Ids of a user's rows in one space."""
        rows = (
            self.client.table(table)
            .select("id")
            .eq("user_id", user_id)
            .eq("space_id", space_id)
            .execute()
        ).data or []
        return [r["id"] for r in rows]

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _counts_by_space(
        self, user_id: str, only_space: str | None = None
    ) -> dict[str, dict[str, int]]:
        """{space_id: {table: count}} across the scoped tables."""
        out: dict[str, dict[str, int]] = {}
        for table in _SCOPED_TABLES:
            query = (
                self.client.table(table)
                .select("space_id")
                .eq("user_id", user_id)
                .not_.is_("space_id", "null")
            )
            if only_space:
                query = query.eq("space_id", only_space)
            rows = query.execute().data or []
            for space_id, n in Counter(
                r["space_id"] for r in rows
            ).items():
                out.setdefault(space_id, {})[table] = n
        return out

    def _reassign_contents(
        self, user_id: str, from_space: str, to_space: str
    ) -> None:
        """Move every scoped row from one space to another."""
        for table in _SCOPED_TABLES:
            self.client.table(table).update({"space_id": to_space}).eq(
                "user_id", user_id
            ).eq("space_id", from_space).execute()

    def _purge_contents(self, user_id: str, space_id: str) -> None:
        """Delete all content in a space (storage files included).

        Order matters: media storage first (rows would orphan the files),
        then generated content, then sessions (whose FK cascades cover
        messages / runs / session-scoped quizzes).
        """
        media = self.supabase.list_media(user_id, space_id=space_id)
        for item in media:
            self.supabase.delete_storage_file(item["storage_path"])
        for table in ("media", "quizzes", "flashcard_sets", "bookmarks",
                      "notes", "sessions"):
            self.client.table(table).delete().eq("user_id", user_id).eq(
                "space_id", space_id
            ).execute()
