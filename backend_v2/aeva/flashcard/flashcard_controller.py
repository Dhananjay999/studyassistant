"""Flashcard controller."""

import logging
from typing import Any

from flask import request
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
from aeva.flashcard.schema.flashcard_schema import (
    StudyBatchSchema,
    StudySchema,
)
from aeva.revision.revision_service import RevisionService

logger = logging.getLogger(__name__)


def _record_revision(
    user_id: str, set_id: str, ratings: list[tuple[str, str]]
) -> None:
    """Best-effort spaced-repetition update — never blocks the study save."""
    try:
        RevisionService().record_flashcard_study(user_id, set_id, ratings)
    except Exception:  # noqa: BLE001
        logger.debug("Revision update failed", exc_info=True)

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
        sets = FlashcardRepository().list_sets(
            current_user.id, request.args.get("space_id")
        )
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
        _record_revision(
            current_user.id,
            set_id,
            [(request_data.flashcard_id, request_data.rating)],
        )
        return success_response("Study recorded", analytics)


class FlashcardStudyBatchEndpoint(MethodView):
    """Record a whole study session's ratings in one request."""

    @staticmethod
    @blueprint.arguments(StudyBatchSchema)
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def post(
        current_user: UserData,
        request_data: object,
        set_id: str,
    ) -> dict[str, Any]:
        """Persist all card ratings from a completed study session at once."""
        ratings = [
            (r.flashcard_id, r.rating) for r in request_data.ratings
        ]
        analytics = FlashcardRepository().record_study_batch(
            current_user.id, set_id, ratings
        )
        _record_revision(current_user.id, set_id, ratings)
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
blueprint.add_url_rule(
    "/<set_id>/study/batch",
    view_func=FlashcardStudyBatchEndpoint,
    endpoint="flashcard_study_batch",
)
