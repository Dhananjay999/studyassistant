"""Answer feedback controller: ``POST /chat/messages/<id>/feedback``.

Its own blueprint (same ``/chat`` prefix as the chat routes) so the chat
controller itself is untouched.
"""

from typing import Any

from flask.views import MethodView
from flask_smorest import Blueprint

from aeva.chat.feedback_repository import MessageFeedbackRepository
from aeva.chat.schema.feedback_schema import MessageFeedbackSchema
from aeva.common.decorators import user_required
from aeva.common.schema import ResponseEnvelopeSchema, UserData

blueprint = Blueprint(
    "chat_feedback",
    __name__,
    url_prefix="/chat",
    description="Answer feedback",
)


class MessageFeedbackEndpoint(MethodView):
    """Thumbs up / down on an assistant message."""

    @staticmethod
    @blueprint.arguments(MessageFeedbackSchema)
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def post(
        current_user: UserData,
        request_data: object,
        message_id: str,
    ) -> dict[str, Any]:
        """Set or clear the rating stored in ``messages.metadata.feedback``."""
        return MessageFeedbackRepository.set_feedback(
            current_user, message_id, request_data  # type: ignore[arg-type]
        )


blueprint.add_url_rule(
    "/messages/<message_id>/feedback",
    view_func=MessageFeedbackEndpoint,
    endpoint="message_feedback",
)
