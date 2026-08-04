"""Revision controller."""

from typing import Any

from flask.views import MethodView
from flask_smorest import Blueprint

from aeva.common.decorators import user_required
from aeva.common.schema import (
    ResponseEnvelopeSchema,
    UserData,
    success_response,
)
from aeva.revision.revision_service import RevisionService
from aeva.revision.schema.revision_schema import (
    ConfidenceSchema,
    RevisionQuerySchema,
)

blueprint = Blueprint(
    "revision",
    __name__,
    url_prefix="/revision",
    description="AI Revision Mode",
)


class RevisionDashboard(MethodView):
    """Spaced-repetition dashboard."""

    @staticmethod
    @blueprint.arguments(RevisionQuerySchema, location="query")
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def get(current_user: UserData, query: object) -> dict[str, Any]:
        """Needs-revision / due-today / mastered buckets plus streak."""
        data = RevisionService().dashboard(
            current_user.id, query.tz_offset_minutes
        )
        return success_response("Revision dashboard", data)


class RevisionHome(MethodView):
    """Welcome-screen payload."""

    @staticmethod
    @blueprint.arguments(RevisionQuerySchema, location="query")
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def get(current_user: UserData, query: object) -> dict[str, Any]:
        """Greeting, recent topics, and top revision recommendations."""
        data = RevisionService().home(
            current_user.id,
            current_user.full_name,
            query.tz_offset_minutes,
        )
        return success_response("Revision home", data)


class RevisionConfidence(MethodView):
    """Post-session confidence check-in."""

    @staticmethod
    @blueprint.arguments(ConfidenceSchema)
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def post(current_user: UserData, request_data: object) -> dict[str, Any]:
        """Record confused/better/mastered and reschedule the topic."""
        data = RevisionService().record_confidence(
            current_user.id, request_data
        )
        return success_response("Confidence recorded", data)


blueprint.add_url_rule(
    "/dashboard",
    view_func=RevisionDashboard,
    endpoint="revision_dashboard",
)
blueprint.add_url_rule(
    "/home", view_func=RevisionHome, endpoint="revision_home"
)
blueprint.add_url_rule(
    "/confidence",
    view_func=RevisionConfidence,
    endpoint="revision_confidence",
)
