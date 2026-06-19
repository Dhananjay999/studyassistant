"""Assistant controller."""

from collections.abc import Generator
from typing import Any

from flask import Response, current_app
from flask.views import MethodView
from flask_smorest import Blueprint

from aeva.assistant.assistant_repository import AssistantRepository
from aeva.assistant.schema.assistant_schema import AssistantRequestSchema
from aeva.common.decorators import user_required
from aeva.common.schema import ResponseEnvelopeSchema, UserData

blueprint = Blueprint(
    "assistant",
    __name__,
    url_prefix="/assistant",
    description="Assistant",
)


class AssistantEndpoint(MethodView):
    """Orchestrated assistant route."""

    @staticmethod
    @blueprint.arguments(AssistantRequestSchema)
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def post(
        current_user: UserData,
        request_data: object,
    ) -> dict[str, Any]:
        """Send a message through the orchestrator."""
        return AssistantRepository.process(current_user, request_data)


class AssistantStreamEndpoint(MethodView):
    """Streaming assistant route (content events)."""

    @staticmethod
    @blueprint.arguments(AssistantRequestSchema)
    @user_required
    def post(
        current_user: UserData,
        request_data: object,
    ) -> Response:
        """Stream assistant response via SSE."""
        app = current_app._get_current_object()  # noqa: SLF001

        def generate() -> Generator[str, None, None]:
            with app.app_context():
                yield from AssistantRepository.process_stream(
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


blueprint.add_url_rule("/", view_func=AssistantEndpoint, endpoint="assistant")
blueprint.add_url_rule(
    "/stream",
    view_func=AssistantStreamEndpoint,
    endpoint="assistant_stream",
)
