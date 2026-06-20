"""Flashcard controller."""

from typing import Any

from flask.views import MethodView
from flask_smorest import Blueprint

from aeva.common.decorators import user_required
from aeva.common.errors import ERROR_CODES, CustomError
from aeva.common.schema import (
    ResponseEnvelopeSchema,
    UserData,
    success_response,
)
from aeva.flashcard.flashcard_repository import FlashcardRepository
from aeva.flashcard.schema.flashcard_schema import StudySchema

blueprint = Blueprint(
    "flashcard",
    __name__,
    url_prefix="/flashcards",
    description="Flashcards",
)


class FlashcardList(MethodView):
    """List flashcard sets."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def get(current_user: UserData) -> dict[str, Any]:
        """List the user's flashcard sets with progress."""
        sets = FlashcardRepository().list_sets(current_user.id)
        return success_response("Flashcard sets retrieved", sets)


class FlashcardDetail(MethodView):
    """Fetch a flashcard set with cards and analytics."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def get(current_user: UserData, set_id: str) -> dict[str, Any]:
        """Load a set with its cards and study analytics."""
        fset = FlashcardRepository().get_set(set_id, current_user.id)
        if not fset:
            raise CustomError(ERROR_CODES["NOT_FOUND"])
        return success_response("Flashcard set loaded", fset)


class FlashcardStudyEndpoint(MethodView):
    """Record a study rating for a card."""

    @staticmethod
    @blueprint.arguments(StudySchema)
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def post(
        current_user: UserData,
        request_data: object,
        set_id: str,
    ) -> dict[str, Any]:
        """Save an easy/medium/hard/needs_revision rating for a card."""
        analytics = FlashcardRepository().record_study(
            current_user.id,
            set_id,
            request_data.flashcard_id,
            request_data.rating,
        )
        return success_response("Study recorded", analytics)


blueprint.add_url_rule(
    "/", view_func=FlashcardList, endpoint="flashcard_list"
)
blueprint.add_url_rule(
    "/<set_id>",
    view_func=FlashcardDetail,
    endpoint="flashcard_detail",
)
blueprint.add_url_rule(
    "/<set_id>/study",
    view_func=FlashcardStudyEndpoint,
    endpoint="flashcard_study",
)
