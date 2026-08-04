"""Study Spaces controller."""

from typing import Any

from flask import Response
from flask.views import MethodView
from flask_smorest import Blueprint

from aeva.common.decorators import user_required
from aeva.common.schema import ResponseEnvelopeSchema, UserData
from aeva.space.schema.space_schema import (
    ConvertSessionData,
    ConvertSessionSchema,
    CreateSpaceData,
    CreateSpaceSchema,
    DeleteSpaceQuerySchema,
    UpdateSpaceSchema,
)
from aeva.space.space_repository import SpaceRepository

blueprint = Blueprint(
    "space",
    __name__,
    url_prefix="/spaces",
    description="Study Spaces (subject workspaces)",
)

repo = SpaceRepository()


class SpaceList(MethodView):
    """Space list/create routes."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def get(current_user: UserData) -> dict[str, Any]:
        """List my spaces with content counts."""
        return repo.list_spaces(current_user)

    @staticmethod
    @blueprint.arguments(CreateSpaceSchema)
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def post(
        current_user: UserData, data: CreateSpaceData
    ) -> dict[str, Any]:
        """Create a study space."""
        return repo.create_space(current_user, data)


class SpaceDetail(MethodView):
    """Single-space routes."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def get(current_user: UserData, space_id: str) -> dict[str, Any]:
        """Space detail with counts."""
        return repo.get_space(current_user, space_id)

    @staticmethod
    @blueprint.arguments(UpdateSpaceSchema)
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def patch(
        current_user: UserData, data: dict, space_id: str
    ) -> dict[str, Any]:
        """Rename / restyle a space."""
        return repo.update_space(current_user, space_id, data)

    @staticmethod
    @blueprint.arguments(DeleteSpaceQuerySchema, location="query")
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def delete(
        current_user: UserData, query: dict, space_id: str
    ) -> dict[str, Any]:
        """Delete a space (?mode=move|purge; General is undeletable)."""
        return repo.delete_space(current_user, space_id, query["mode"])


class SpaceOverview(MethodView):
    """Aggregated workspace payload."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def get(current_user: UserData, space_id: str) -> dict[str, Any]:
        """Space + recent items of every content type + counts."""
        return repo.overview(current_user, space_id)


class SpaceStats(MethodView):
    """Learning-progress metrics for one space."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def get(current_user: UserData, space_id: str) -> dict[str, Any]:
        """Questions, uploads, quiz performance, streak, weak/strong topics."""
        return repo.stats(current_user, space_id)


class SpaceExport(MethodView):
    """Download the whole space as one markdown document."""

    @staticmethod
    @user_required
    def get(current_user: UserData, space_id: str) -> Response:
        """Notes, quizzes (with answers), flashcards, bookmarks, file list."""
        filename, markdown = repo.export_markdown(current_user, space_id)
        return Response(
            markdown,
            mimetype="text/markdown; charset=utf-8",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"'
            },
        )


class SpaceConvert(MethodView):
    """Promote an existing chat into a new space."""

    @staticmethod
    @blueprint.arguments(ConvertSessionSchema)
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def post(
        current_user: UserData, data: ConvertSessionData
    ) -> dict[str, Any]:
        """Create a space from a session and re-file its content."""
        return repo.convert_session(current_user, data)


blueprint.add_url_rule("/", view_func=SpaceList, endpoint="space_list")
blueprint.add_url_rule(
    "/convert", view_func=SpaceConvert, endpoint="space_convert"
)
blueprint.add_url_rule(
    "/<space_id>", view_func=SpaceDetail, endpoint="space_detail"
)
blueprint.add_url_rule(
    "/<space_id>/overview",
    view_func=SpaceOverview,
    endpoint="space_overview",
)
blueprint.add_url_rule(
    "/<space_id>/stats",
    view_func=SpaceStats,
    endpoint="space_stats",
)
blueprint.add_url_rule(
    "/<space_id>/export",
    view_func=SpaceExport,
    endpoint="space_export",
)
