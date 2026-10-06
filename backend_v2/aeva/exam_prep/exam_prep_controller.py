"""Exam Prep controller (all routes behind the ``exam_prep`` flag)."""

from collections.abc import Generator
from typing import Any

from flask import Response, current_app
from flask.views import MethodView
from flask_smorest import Blueprint

from aeva.assistant.assistant_controller import sse_error_for
from aeva.common.decorators import user_required
from aeva.common.schema import (
    ResponseEnvelopeSchema,
    UserData,
    success_response,
)
from aeva.exam_prep.exam_prep_orchestrator import (
    ExamPrepContext,
    ExamPrepOrchestrator,
)
from aeva.exam_prep.exam_prep_service import ExamPrepService
from aeva.exam_prep.schema.exam_prep_schema import (
    CreateExamPlanData,
    CreateExamPlanSchema,
    ExamChatRequestData,
    ExamChatRequestSchema,
    ExamMessagesQuerySchema,
    LessonStreamData,
    LessonStreamSchema,
    TopicFlashcardsData,
    TopicFlashcardsSchema,
    TopicQuizData,
    TopicQuizSchema,
    UpdateTopicStatusData,
    UpdateTopicStatusSchema,
)
from aeva.tracing.services import turn_trace

blueprint = Blueprint(
    "exam_prep",
    __name__,
    url_prefix="/exam-prep",
    description="Exam Prep (study plan, lazy day detail, exam coach)",
)

service = ExamPrepService()


class ExamPlanEndpoint(MethodView):
    """The active plan's dashboard / plan creation."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def get(current_user: UserData) -> dict[str, Any]:
        """Dashboard of the active plan, or ``{"plan": null}``."""
        service.require_enabled()
        return success_response(
            "Exam plan", service.get_dashboard_for_user(current_user.id)
        )

    @staticmethod
    @blueprint.arguments(CreateExamPlanSchema)
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def post(
        current_user: UserData, data: CreateExamPlanData
    ) -> dict[str, Any]:
        """Create a plan (generates the roadmap; archives the active one)."""
        service.require_enabled()
        return success_response(
            "Exam plan created", service.create_plan(current_user.id, data)
        )


class ExamPlanArchiveEndpoint(MethodView):
    """Start over."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def post(current_user: UserData, plan_id: str) -> dict[str, Any]:
        """Archive a plan."""
        service.require_enabled()
        return success_response(
            "Exam plan archived",
            service.archive_plan(current_user.id, plan_id),
        )


class ExamDayEndpoint(MethodView):
    """One day with its lazily generated detail."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def get(
        current_user: UserData, plan_id: str, day_id: str
    ) -> dict[str, Any]:
        """Day summary + detail (generated on first open)."""
        service.require_enabled()
        return success_response(
            "Exam day",
            service.get_day_detail(current_user.id, plan_id, day_id),
        )


class ExamTopicEndpoint(MethodView):
    """Topic progress."""

    @staticmethod
    @blueprint.arguments(UpdateTopicStatusSchema)
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def patch(
        current_user: UserData, data: UpdateTopicStatusData, topic_id: str
    ) -> dict[str, Any]:
        """Set a topic's status."""
        service.require_enabled()
        return success_response(
            "Topic updated",
            service.update_topic_status(current_user.id, topic_id, data.status),
        )


def _sse_response(generate: Generator[str, None, None]) -> Response:
    """Wrap a frame generator the way the assistant stream does."""
    return Response(
        generate,
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


class ExamTopicLessonEndpoint(MethodView):
    """The lesson Aeva teaches for a topic (cached on the topic row)."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def get(current_user: UserData, topic_id: str) -> dict[str, Any]:
        """Topic, its day and the cached lesson (``null`` until taught)."""
        service.require_enabled()
        return success_response(
            "Topic lesson", service.get_topic_lesson(current_user.id, topic_id)
        )


class ExamTopicLessonStreamEndpoint(MethodView):
    """Stream the lesson (generating and caching it on first open)."""

    @staticmethod
    @blueprint.arguments(LessonStreamSchema)
    @user_required
    def post(
        current_user: UserData, data: LessonStreamData, topic_id: str
    ) -> Response:
        """SSE: markdown chunks, then a done frame with the whole lesson."""
        service.require_enabled()
        app = current_app._get_current_object()  # type: ignore[attr-defined]  # noqa: SLF001

        def generate() -> Generator[str, None, None]:
            with app.app_context():
                try:
                    yield from service.stream_topic_lesson(
                        current_user.id, topic_id, data
                    )
                except Exception as exc:
                    app.logger.exception("Exam lesson stream failed")
                    yield sse_error_for(exc)

        return _sse_response(generate())


class ExamTopicQuizEndpoint(MethodView):
    """On-demand quiz for a topic (synchronous, 20-90 s)."""

    @staticmethod
    @blueprint.arguments(TopicQuizSchema)
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def post(
        current_user: UserData, data: TopicQuizData, topic_id: str
    ) -> dict[str, Any]:
        """Generate and link a quiz."""
        service.require_enabled()
        return success_response(
            "Quiz created",
            service.generate_topic_quiz(current_user.id, topic_id, data),
        )


class ExamTopicFlashcardsEndpoint(MethodView):
    """On-demand flashcards for a topic (synchronous)."""

    @staticmethod
    @blueprint.arguments(TopicFlashcardsSchema)
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def post(
        current_user: UserData, data: TopicFlashcardsData, topic_id: str
    ) -> dict[str, Any]:
        """Generate and link a flashcard set."""
        service.require_enabled()
        return success_response(
            "Flashcards created",
            service.generate_topic_flashcards(current_user.id, topic_id, data),
        )


class ExamMessagesEndpoint(MethodView):
    """History of the plan's coach conversation."""

    @staticmethod
    @blueprint.arguments(ExamMessagesQuerySchema, location="query")
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def get(
        current_user: UserData, query: dict, plan_id: str
    ) -> dict[str, Any]:
        """Newest ``limit`` messages, oldest first (same rows as /sessions)."""
        service.require_enabled()
        return success_response(
            "Messages retrieved",
            service.list_messages(
                current_user.id,
                plan_id,
                int(query["limit"]),
                topic_id=query.get("topic_id"),
            ),
        )


class ExamChatStreamEndpoint(MethodView):
    """Streaming exam-coach turn (same SSE frames as /assistant/stream)."""

    @staticmethod
    @blueprint.arguments(ExamChatRequestSchema)
    @user_required
    def post(
        current_user: UserData, request_data: ExamChatRequestData, plan_id: str
    ) -> Response:
        """Stream the coach's answer via SSE."""
        service.require_enabled()
        parts = service.chat_parts(current_user.id, plan_id, request_data)
        ctx = ExamPrepContext(
            user_id=current_user.id,
            session_id=str(parts["plan"]["session_id"]),
            message=request_data.message,
            quiz_options=request_data.quiz_options,
            flashcard_options=request_data.flashcard_options,
            plan=parts["plan"],
            day=parts["day"],
            topic=parts["topic"],
            today=parts["today"],
        )
        app = current_app._get_current_object()  # type: ignore[attr-defined]  # noqa: SLF001

        def generate() -> Generator[str, None, None]:
            with app.app_context():
                try:
                    yield from ExamPrepOrchestrator().run_stream(ctx)
                except Exception as exc:
                    # Emit a terminal SSE error frame instead of an HTTP
                    # error so the client renders a friendly card.
                    app.logger.exception("Exam coach stream failed")
                    yield sse_error_for(exc)
                finally:
                    turn_trace.flush()

        return _sse_response(generate())


blueprint.add_url_rule(
    "/plan", view_func=ExamPlanEndpoint, endpoint="exam_plan"
)
blueprint.add_url_rule(
    "/plan/<plan_id>/archive",
    view_func=ExamPlanArchiveEndpoint,
    endpoint="exam_plan_archive",
)
blueprint.add_url_rule(
    "/plan/<plan_id>/days/<day_id>",
    view_func=ExamDayEndpoint,
    endpoint="exam_day",
)
blueprint.add_url_rule(
    "/topics/<topic_id>",
    view_func=ExamTopicEndpoint,
    endpoint="exam_topic",
)
blueprint.add_url_rule(
    "/topics/<topic_id>/lesson",
    view_func=ExamTopicLessonEndpoint,
    endpoint="exam_topic_lesson",
)
blueprint.add_url_rule(
    "/topics/<topic_id>/lesson/stream",
    view_func=ExamTopicLessonStreamEndpoint,
    endpoint="exam_topic_lesson_stream",
)
blueprint.add_url_rule(
    "/topics/<topic_id>/quiz",
    view_func=ExamTopicQuizEndpoint,
    endpoint="exam_topic_quiz",
)
blueprint.add_url_rule(
    "/topics/<topic_id>/flashcards",
    view_func=ExamTopicFlashcardsEndpoint,
    endpoint="exam_topic_flashcards",
)
blueprint.add_url_rule(
    "/plan/<plan_id>/messages",
    view_func=ExamMessagesEndpoint,
    endpoint="exam_messages",
)
blueprint.add_url_rule(
    "/plan/<plan_id>/chat/stream",
    view_func=ExamChatStreamEndpoint,
    endpoint="exam_chat_stream",
)
