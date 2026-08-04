"""AI Notes business logic.

Notes are user-editable markdown documents, usually saved from an assistant
answer and refined over time. Every note lives in exactly one Study Space
(General when unspecified). Quiz/flashcard generation from a note reuses the
existing ``source_content`` chat flow client-side, so this slice stays pure
CRUD.
"""

from typing import Any

from aeva.common.errors import ERROR_CODES, CustomError
from aeva.common.schema import UserData, success_response
from aeva.note.schema.note_schema import CreateNoteData
from aeva.supabase.supabase_service import SupabaseService

# Columns returned by list endpoints; content_md is trimmed to a preview so a
# long notebook never bloats the list payload.
_LIST_COLUMNS = (
    "id,space_id,title,source_type,source_ref,created_at,updated_at"
)
_PREVIEW_CHARS = 240


class NoteRepository:
    """Notes logic (stateless; per-request instances are fine)."""

    def __init__(self, supabase: SupabaseService | None = None) -> None:
        self._supabase = supabase

    @property
    def supabase(self) -> SupabaseService:
        """Lazy Supabase client."""
        if self._supabase is None:
            self._supabase = SupabaseService()
        return self._supabase

    def list_notes(
        self, user_id: str, space_id: str | None = None
    ) -> dict[str, Any]:
        """Notes newest-first, optionally scoped to a space, with previews."""
        query = (
            self.supabase.client.table("notes")
            .select(f"{_LIST_COLUMNS},content_md")
            .eq("user_id", user_id)
        )
        if space_id:
            query = query.eq("space_id", space_id)
        rows = query.order("updated_at", desc=True).execute().data or []
        for row in rows:
            body = row.pop("content_md", "") or ""
            row["preview"] = body[:_PREVIEW_CHARS]
        return success_response("Notes retrieved", rows)

    def get_note(self, user_id: str, note_id: str) -> dict[str, Any]:
        """One full note."""
        note = self._fetch(user_id, note_id)
        return success_response("Note retrieved", note)

    def create_note(
        self, current_user: UserData, data: CreateNoteData
    ) -> dict[str, Any]:
        """Create a note, filed into a space (explicit > session's > General)."""
        space_id = self.supabase.resolve_space(
            current_user.id, data.space_id, data.session_id
        )
        result = (
            self.supabase.client.table("notes")
            .insert({
                "user_id": current_user.id,
                "space_id": space_id,
                "title": data.title.strip() or "Untitled note",
                "content_md": data.content_md,
                "source_type": data.source_type,
                "source_ref": data.source_ref,
            })
            .execute()
        )
        return success_response("Note created", result.data[0])

    def update_note(
        self, user_id: str, note_id: str, patch: dict[str, Any]
    ) -> dict[str, Any]:
        """Edit title/content or move the note to another space."""
        if "space_id" in patch:
            patch["space_id"] = self.supabase.resolve_space(
                user_id, patch.get("space_id")
            )
        result = (
            self.supabase.client.table("notes")
            .update(patch)
            .eq("id", note_id)
            .eq("user_id", user_id)
            .execute()
        )
        if not result.data:
            raise CustomError(ERROR_CODES["NOT_FOUND"])
        return success_response("Note updated", result.data[0])

    def delete_note(self, user_id: str, note_id: str) -> dict[str, Any]:
        """Delete a note."""
        self._fetch(user_id, note_id)  # 404 before a silent no-op delete
        self.supabase.client.table("notes").delete().eq("id", note_id).eq(
            "user_id", user_id
        ).execute()
        return success_response("Note deleted", {"id": note_id})

    # Used by the share resolver too (ownership-checked full fetch).
    def _fetch(self, user_id: str, note_id: str) -> dict[str, Any]:
        result = (
            self.supabase.client.table("notes")
            .select("*")
            .eq("id", note_id)
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
        if not result or not result.data:
            raise CustomError(ERROR_CODES["NOT_FOUND"])
        return dict(result.data)
