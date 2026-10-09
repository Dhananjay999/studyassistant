"""Notification routes.

* ``GET /notifications/pending``: what the signed-in user has waiting (the
  chat "waiting for you" strip).
"""

from __future__ import annotations

from typing import Any

from flask.views import MethodView
from flask_smorest import Blueprint

from aeva.common.decorators import user_required
from aeva.common.schema import (
    ResponseEnvelopeSchema,
    UserData,
    success_response,
)
from aeva.notifications.digest_service import DigestService
from aeva.revision.schema.revision_schema import RevisionQuerySchema

blueprint = Blueprint(
    "notifications",
    __name__,
    url_prefix="/notifications",
    description="Return hook: what is waiting for the user",
)


class PendingNotifications(MethodView):
    """Counts for the chat strip."""

    @staticmethod
    @blueprint.arguments(RevisionQuerySchema, location="query")
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def get(current_user: UserData, query: object) -> dict[str, Any]:
        """Today's plan day, revision due, quizzes and sets never opened."""
        data = DigestService().pending_for_user(
            current_user.id,
            query.tz_offset_minutes,  # type: ignore[attr-defined]
        )
        return success_response("Pending notifications", data)


blueprint.add_url_rule(
    "/pending",
    view_func=PendingNotifications,
    endpoint="notifications_pending",
)
