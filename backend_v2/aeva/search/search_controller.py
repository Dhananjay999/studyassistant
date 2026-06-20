"""Search controller."""

from typing import Any

from flask.views import MethodView
from flask_smorest import Blueprint

from aeva.common.decorators import user_required
from aeva.common.schema import ResponseEnvelopeSchema, UserData
from aeva.search.schema.search_schema import SearchQuerySchema
from aeva.search.search_repository import SearchRepository

blueprint = Blueprint(
    "search",
    __name__,
    url_prefix="/search",
    description="Global search",
)


class SearchEndpoint(MethodView):
    """Global search route."""

    @staticmethod
    @blueprint.arguments(SearchQuerySchema, location="query")
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def get(current_user: UserData, args: dict) -> dict[str, Any]:
        """Search across the user's chats, quizzes, and files."""
        return SearchRepository.search(current_user, args.get("q", ""))


blueprint.add_url_rule("/", view_func=SearchEndpoint, endpoint="search")
