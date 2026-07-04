"""Assistant controller."""

from collections.abc import Generator
from typing import Any

from flask import Response, current_app
from flask.views import MethodView
from flask_smorest import Blueprint

from aeva.assistant.assistant_repository import AssistantRepository
from aeva.assistant.schema.assistant_schema import AssistantRequestSchema
from aeva.common.decorators import user_required
from aeva.common.errors import CustomError
from aeva.common.schema import ResponseEnvelopeSchema, UserData
from aeva.llm.llm_client import LLMClient

blueprint = Blueprint(
    "assistant",
    __name__,
    url_prefix="/assistant",
    description="Assistant",
)

# Substrings that mark a provider overload / rate-limit / capacity error. Such
# turns get a "try again shortly" message instead of the generic one.
_OVERLOAD_MARKERS = (
    "rate limit",
    "rate_limit",
    "429",
    "503",
    "overload",
    "quota",
    "capacity",
    "too many requests",
    "unavailable",
)


def sse_error_for(exc: Exception) -> str:
    """Map a mid-stream exception to a safe, student-facing SSE error frame.

    The raw exception (which may leak provider/API-key details) is logged
    server-side; the client only receives a friendly, keyword-tagged message so
    its error card can categorize it (high-demand vs generic).
    """
    text = str(exc).lower()
    if any(marker in text for marker in _OVERLOAD_MARKERS):
        return LLMClient.format_sse_error(
            "The assistant is overloaded right now. Please try again shortly.",
            code="OVERLOADED",
        )
    code = exc.code if isinstance(exc, CustomError) else "INTERNAL_ERROR"
    return LLMClient.format_sse_error(
        "The assistant ran into a problem while responding.",
        code=code,
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
                try:
                    yield from AssistantRepository.process_stream(
                        current_user, request_data
                    )
                except Exception as exc:  # don't drop the stream
                    # The 200 response is already committed, so we can't return
                    # an HTTP error. Emit a terminal SSE error frame instead so
                    # the client renders a friendly card rather than silently
                    # completing with a half-written answer.
                    app.logger.exception("Assistant stream failed")
                    yield sse_error_for(exc)

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
