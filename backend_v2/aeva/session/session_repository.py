"""Session repository."""

from typing import Any

from aeva.common.errors import ERROR_CODES, CustomError
from aeva.common.schema import UserData, success_response
from aeva.session.schema.session_schema import CreateSessionData
from aeva.supabase.supabase_service import SupabaseService


class SessionRepository:
    """Session business logic."""

    @staticmethod
    def create_session(
        current_user: UserData,
        request_data: CreateSessionData,
    ) -> dict[str, Any]:
        """Create a new chat session."""
        supabase = SupabaseService()
        session = supabase.create_session(
            user_id=current_user.id,
            title=request_data.title,
            mode=request_data.mode,
        )
        if request_data.media_ids:
            supabase.attach_media_to_session(
                request_data.media_ids,
                session["id"],
                current_user.id,
            )
        return success_response("Session created", session)

    @staticmethod
    def list_sessions(current_user: UserData) -> dict[str, Any]:
        """List all sessions for user."""
        supabase = SupabaseService()
        sessions = supabase.list_sessions(current_user.id)
        return success_response("Sessions retrieved", sessions)

    @staticmethod
    def delete_session(
        current_user: UserData,
        session_id: str,
    ) -> dict[str, Any]:
        """Delete a session."""
        supabase = SupabaseService()
        session = supabase.get_session(session_id, current_user.id)
        if not session:
            raise CustomError(ERROR_CODES["NOT_FOUND"])

        media_items = supabase.list_media(
            current_user.id, session_id=session_id
        )
        for item in media_items:
            supabase.delete_storage_file(item["storage_path"])
            supabase.delete_media_record(item["id"], current_user.id)

        supabase.delete_session(session_id, current_user.id)
        return success_response("Session deleted", {"id": session_id})

    @staticmethod
    def update_session(
        current_user: UserData,
        session_id: str,
        data: dict,
    ) -> dict[str, Any]:
        """Update session title."""
        supabase = SupabaseService()
        session = supabase.update_session(
            session_id, current_user.id, **data
        )
        if not session:
            raise CustomError(ERROR_CODES["NOT_FOUND"])
        return success_response("Session updated", session)

    @staticmethod
    def get_messages(
        current_user: UserData,
        session_id: str,
    ) -> dict[str, Any]:
        """Get messages for a session."""
        supabase = SupabaseService()
        session = supabase.get_session(session_id, current_user.id)
        if not session:
            raise CustomError(ERROR_CODES["NOT_FOUND"])

        messages = supabase.get_messages(session_id)
        return success_response("Messages retrieved", messages)
