"""Quiz controller."""

from typing import TYPE_CHECKING, Any, cast

from flask.views import MethodView
from flask_smorest import Blueprint

from aeva.common.decorators import user_required
from aeva.common.schema import ResponseEnvelopeSchema, UserData
from aeva.quiz.quiz_service import QuizService
from aeva.quiz.schema.quiz_schema import QuizAnalyzeSchema, QuizSubmitSchema

if TYPE_CHECKING:
    from aeva.quiz.schema.quiz_schema import QuizAnalyzeData, QuizSubmitData

blueprint = Blueprint(
    "quiz",
    __name__,
    url_prefix="/quiz",
    description="Quiz",
)


class QuizListEndpoint(MethodView):
    """List the user's quizzes."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def get(current_user: UserData) -> dict[str, Any]:
        """List quizzes (newest first) with counts and attempt summary."""
        return QuizService().list_quizzes(current_user.id)


class QuizDetailEndpoint(MethodView):
    """Get quiz by ID."""

    @staticmethod
    @blueprint.response(200)
    @user_required
    def get(current_user: UserData, quiz_id: str) -> dict[str, Any]:
        """Fetch quiz questions (no correct answers)."""
        return QuizService().get_quiz(quiz_id, current_user.id)


class QuizAttemptsEndpoint(MethodView):
    """List a quiz's attempt history."""

    @staticmethod
    @blueprint.response(200)
    @user_required
    def get(current_user: UserData, quiz_id: str) -> dict[str, Any]:
        """List attempts (newest first) with per-attempt summary."""
        return QuizService().list_attempts(quiz_id, current_user.id)


class QuizAttemptDetailEndpoint(MethodView):
    """Get a single attempt's full report card."""

    @staticmethod
    @blueprint.response(200)
    @user_required
    def get(
        current_user: UserData, quiz_id: str, attempt_id: str
    ) -> dict[str, Any]:
        """Fetch one attempt with quiz, evaluation, and AI analysis."""
        return QuizService().get_attempt_detail(
            quiz_id, attempt_id, current_user.id
        )


class QuizSubmitEndpoint(MethodView):
    """Submit quiz answers."""

    @staticmethod
    @blueprint.arguments(QuizSubmitSchema)
    @blueprint.response(200)
    @user_required
    def post(
        current_user: UserData,
        request_data: object,
        quiz_id: str,
    ) -> dict[str, Any]:
        """Submit answers and get an instant, locally-scored evaluation."""
        data = cast("QuizSubmitData", request_data)
        return QuizService().submit(
            quiz_id,
            current_user.id,
            data.answers,
            data.time_taken_seconds,
        )


class QuizAnalyzeEndpoint(MethodView):
    """Generate an AI performance analysis for a finished attempt."""

    @staticmethod
    @blueprint.arguments(QuizAnalyzeSchema)
    @blueprint.response(200)
    @user_required
    def post(
        current_user: UserData,
        request_data: object,
        quiz_id: str,
    ) -> dict[str, Any]:
        """Analyze an attempt with the LLM (cached after the first call)."""
        data = cast("QuizAnalyzeData", request_data)
        return QuizService().analyze(
            quiz_id,
            data.attempt_id,
            current_user.id,
        )


blueprint.add_url_rule(
    "/",
    view_func=QuizListEndpoint,
    endpoint="quiz_list",
)
blueprint.add_url_rule(
    "/<quiz_id>",
    view_func=QuizDetailEndpoint,
    endpoint="quiz_detail",
)
blueprint.add_url_rule(
    "/<quiz_id>/attempts",
    view_func=QuizAttemptsEndpoint,
    endpoint="quiz_attempts",
)
blueprint.add_url_rule(
    "/<quiz_id>/attempts/<attempt_id>",
    view_func=QuizAttemptDetailEndpoint,
    endpoint="quiz_attempt_detail",
)
blueprint.add_url_rule(
    "/<quiz_id>/submit",
    view_func=QuizSubmitEndpoint,
    endpoint="quiz_submit",
)
blueprint.add_url_rule(
    "/<quiz_id>/analyze",
    view_func=QuizAnalyzeEndpoint,
    endpoint="quiz_analyze",
)
