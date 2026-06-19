"""Quiz controller."""

from typing import Any

from flask.views import MethodView
from flask_smorest import Blueprint

from aeva.common.decorators import user_required
from aeva.common.schema import UserData
from aeva.quiz.quiz_service import QuizService
from aeva.quiz.schema.quiz_schema import QuizSubmitSchema

blueprint = Blueprint(
    "quiz",
    __name__,
    url_prefix="/quiz",
    description="Quiz",
)


class QuizDetailEndpoint(MethodView):
    """Get quiz by ID."""

    @staticmethod
    @blueprint.response(200)
    @user_required
    def get(current_user: UserData, quiz_id: str) -> dict[str, Any]:
        """Fetch quiz questions (no correct answers)."""
        return QuizService().get_quiz(quiz_id, current_user.id)


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
        """Submit answers and get evaluation + feedback."""
        return QuizService().submit(
            quiz_id,
            current_user.id,
            request_data.answers,
        )


blueprint.add_url_rule(
    "/<quiz_id>",
    view_func=QuizDetailEndpoint.as_view("quiz_detail"),
)
blueprint.add_url_rule(
    "/<quiz_id>/submit",
    view_func=QuizSubmitEndpoint.as_view("quiz_submit"),
)
