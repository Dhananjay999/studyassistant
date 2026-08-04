"""AI Notes controller."""

from typing import Any

from flask import request
from flask.views import MethodView
from flask_smorest import Blueprint

from aeva.common.decorators import user_required
from aeva.common.schema import ResponseEnvelopeSchema, UserData
from aeva.note.note_repository import NoteRepository
from aeva.note.schema.note_schema import (
    CreateNoteData,
    CreateNoteSchema,
    UpdateNoteSchema,
)

blueprint = Blueprint(
    "note",
    __name__,
    url_prefix="/notes",
    description="AI Notes (editable markdown, saved from answers)",
)

repo = NoteRepository()


class NoteList(MethodView):
    """Note list/create routes."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def get(current_user: UserData) -> dict[str, Any]:
        """List notes (optionally ?space_id=… scoped), with previews."""
        return repo.list_notes(
            current_user.id, space_id=request.args.get("space_id")
        )

    @staticmethod
    @blueprint.arguments(CreateNoteSchema)
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def post(
        current_user: UserData, data: CreateNoteData
    ) -> dict[str, Any]:
        """Create a note (manual, or saved from an assistant answer)."""
        return repo.create_note(current_user, data)


class NoteDetail(MethodView):
    """Single-note routes."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def get(current_user: UserData, note_id: str) -> dict[str, Any]:
        """Full note content."""
        return repo.get_note(current_user.id, note_id)

    @staticmethod
    @blueprint.arguments(UpdateNoteSchema)
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def patch(
        current_user: UserData, data: dict, note_id: str
    ) -> dict[str, Any]:
        """Edit a note (title / content / space)."""
        return repo.update_note(current_user.id, note_id, data)

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def delete(current_user: UserData, note_id: str) -> dict[str, Any]:
        """Delete a note."""
        return repo.delete_note(current_user.id, note_id)


blueprint.add_url_rule("/", view_func=NoteList, endpoint="note_list")
blueprint.add_url_rule(
    "/<note_id>", view_func=NoteDetail, endpoint="note_detail"
)
