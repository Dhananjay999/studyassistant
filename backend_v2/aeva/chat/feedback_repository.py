"""Answer feedback: store a thumbs rating in ``messages.metadata.feedback``.

The rating lives next to the turn's own metadata (``tool_used``,
``content``) so quality reviews can join it to traces without a new table.
One primary-key read and one primary-key update per call; ownership is
checked through the message's session (``messages`` has no ``user_id``).
"""

import uuid
from datetime import UTC, datetime
from typing import Any, cast

from aeva.chat.schema.feedback_schema import MessageFeedbackData
from aeva.common.errors import ERROR_CODES, CustomError
from aeva.common.schema import UserData, success_response
from aeva.supabase.supabase_service import SupabaseService

FEEDBACK_KEY = "feedback"


def _is_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
    except (ValueError, AttributeError, TypeError):
        return False
    return True


class MessageFeedbackRepository:
    """Persist and clear per-message ratings."""

    @staticmethod
    def set_feedback(
        current_user: UserData,
        message_id: str,
        data: MessageFeedbackData,
        supabase: SupabaseService | None = None,
    ) -> dict[str, Any]:
        """Write ``metadata.feedback`` on one of the user's assistant messages.

        A client-side placeholder (``stream-…``) or any non-UUID id is a
        validation error, never a database round-trip.
        """
        if not _is_uuid(message_id):
            raise CustomError(ERROR_CODES["VALIDATION_ERROR"])
        supabase = supabase or SupabaseService()

        found = (
            supabase.client.table("messages")
            .select("id, role, metadata, sessions!inner(user_id)")
            .eq("id", message_id)
            .eq("sessions.user_id", current_user.id)
            .limit(1)
            .execute()
        )
        rows = cast("list[dict[str, Any]]", found.data or [])
        if not rows:
            raise CustomError(ERROR_CODES["NOT_FOUND"])
        row = rows[0]
        if row.get("role") != "assistant":
            raise CustomError(ERROR_CODES["VALIDATION_ERROR"])

        metadata = dict(row.get("metadata") or {})
        if data.rating is None:
            metadata.pop(FEEDBACK_KEY, None)
        else:
            entry: dict[str, Any] = {
                "rating": data.rating,
                "updated_at": datetime.now(UTC).isoformat(),
            }
            if data.reason:
                entry["reason"] = data.reason
            metadata[FEEDBACK_KEY] = entry

        (
            supabase.client.table("messages")
            .update({"metadata": metadata})
            .eq("id", message_id)
            .execute()
        )
        return success_response(
            "Feedback saved",
            {"message_id": message_id, "rating": data.rating},
        )
