"""Assistant controller."""

import json
from typing import Any

from flask import Response, current_app
from flask.views import MethodView
from flask_smorest import Blueprint

from aeva.assistant.assistant_repository import AssistantRepository
from aeva.assistant.schema.assistant_schema import AssistantRequestSchema
from aeva.common.decorators import user_required
from aeva.common.schema import UserData
from aeva.llm.llm_client import LLMClient

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

        def generate():
            with app.app_context():
                result = AssistantRepository.process(
                    current_user, request_data
                )
                data = result.get("data", {})
                status = data.get("status")

                if status == "clarification_required":
                    payload = json.dumps({
                        "type": "clarification",
                        "data": data,
                        "done": True,
                    })
                    yield f"data: {payload}\n\n"
                    return

                content = data.get("content", {})
                text = content.get("answer") or json.dumps(content)
                if data.get("tool_used") == "quiz_generator":
                    text = (
                        f"Quiz created: {content.get('title')} "
                        f"({len(content.get('questions', []))} questions)"
                    )
                yield LLMClient.format_sse_chunk(text)
                yield LLMClient.format_sse_chunk(
                    "",
                    done=True,
                    extra={
                        "tool_used": data.get("tool_used"),
                        "content": content,
                    },
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


blueprint.add_url_rule("/", view_func=AssistantEndpoint.as_view("assistant"))
blueprint.add_url_rule(
    "/stream",
    view_func=AssistantStreamEndpoint.as_view("assistant_stream"),
)
