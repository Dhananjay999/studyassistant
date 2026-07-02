"""Analytics controller — per-user learning dashboard data."""

from typing import Any

from flask.views import MethodView
from flask_smorest import Blueprint

from aeva.analytics.analytics_repository import AnalyticsRepository
from aeva.common.decorators import user_required
from aeva.common.schema import ResponseEnvelopeSchema, UserData

blueprint = Blueprint(
    "analytics",
    __name__,
    url_prefix="/analytics",
    description="Personal learning analytics",
)


class AnalyticsOverview(MethodView):
    """Aggregated learning insights for the current user."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def get(current_user: UserData) -> dict[str, Any]:
        """Return study overview, quiz analytics, activity, and achievements."""
        return AnalyticsRepository.overview(current_user)


blueprint.add_url_rule(
    "/overview", view_func=AnalyticsOverview, endpoint="analytics_overview"
)
