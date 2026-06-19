"""Chat controller."""

from typing import Any

from flask import Response, current_app
from flask.views import MethodView
from flask_smorest import Blueprint

from aeva.chat.chat_repository import ChatRepository
from aeva.chat.schema.chat_schema import ChatRequestSchema
from aeva.common.decorators import user_required
from aeva.common.schema import ResponseEnvelopeSchema, UserData

blueprint = Blueprint(
    "chat",
    __name__,
    url_prefix="/chat",
    description="Chat",
)


class ChatEndpoint(MethodView):
    """Non-streaming chat route."""

    @staticmethod
    @blueprint.arguments(ChatRequestSchema)
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def post(
        current_user: UserData,
        request_data: object,
    ) -> dict[str, Any]:
        """Send a chat message."""
        return ChatRepository.process_chat(current_user, request_data)


class ChatStreamEndpoint(MethodView):
    """Streaming chat route."""

    @staticmethod
    @blueprint.arguments(ChatRequestSchema)
    @user_required
    def post(
        current_user: UserData,
        request_data: object,
    ) -> Response:
        """Stream a chat response via SSE."""
        app = current_app._get_current_object()  # noqa: SLF001

        def generate():
            with app.app_context():
                yield from ChatRepository.process_chat_stream(
                    current_user, request_data
                )

        return Response(
            generate(),
            mimetype="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )


blueprint.add_url_rule("/", view_func=ChatEndpoint, endpoint="chat")
blueprint.add_url_rule(
    "/stream", view_func=ChatStreamEndpoint, endpoint="chat_stream"
)
