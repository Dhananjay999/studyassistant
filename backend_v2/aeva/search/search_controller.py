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
        """Search chats, notes, quizzes, flashcards and files.

        ``space_id`` scopes every category to one Study Space (in-space
        search); omitted, it searches everything.
        """
        return SearchRepository.search(
            current_user, args.get("q", ""), args.get("space_id")
        )


blueprint.add_url_rule("/", view_func=SearchEndpoint, endpoint="search")
