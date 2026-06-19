"""Session controller."""

from typing import Any

from flask.views import MethodView
from flask_smorest import Blueprint

from aeva.common.decorators import user_required
from aeva.common.schema import ResponseEnvelopeSchema, UserData
from aeva.session.schema.session_schema import (
    CreateSessionSchema,
    UpdateSessionSchema,
)
from aeva.session.session_repository import SessionRepository

blueprint = Blueprint(
    "session",
    __name__,
    url_prefix="/sessions",
    description="Chat sessions",
)


class SessionList(MethodView):
    """Session list/create routes."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def get(current_user: UserData) -> dict[str, Any]:
        """List user sessions."""
        return SessionRepository.list_sessions(current_user)

    @staticmethod
    @blueprint.arguments(CreateSessionSchema)
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def post(
        current_user: UserData,
        request_data: object,
    ) -> dict[str, Any]:
        """Create a new session."""
        return SessionRepository.create_session(current_user, request_data)


class SessionDetail(MethodView):
    """Session detail routes."""

    @staticmethod
    @blueprint.arguments(UpdateSessionSchema)
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def patch(
        current_user: UserData,
        data: dict,
        session_id: str,
    ) -> dict[str, Any]:
        """Update session."""
        return SessionRepository.update_session(
            current_user, session_id, data
        )

    @staticmethod
    @blueprint.response(200)
    @user_required
    def delete(
        current_user: UserData,
        session_id: str,
    ) -> dict[str, Any]:
        """Delete session."""
        return SessionRepository.delete_session(current_user, session_id)


class SessionMessages(MethodView):
    """Session messages route."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def get(
        current_user: UserData,
        session_id: str,
    ) -> dict[str, Any]:
        """Get session messages."""
        return SessionRepository.get_messages(current_user, session_id)


blueprint.add_url_rule(
    "/", view_func=SessionList, endpoint="session_list"
)
blueprint.add_url_rule(
    "/<session_id>",
    view_func=SessionDetail,
    endpoint="session_detail",
)
blueprint.add_url_rule(
    "/<session_id>/messages",
    view_func=SessionMessages,
    endpoint="session_messages",
)
