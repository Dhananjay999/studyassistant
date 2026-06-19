"""Media controller."""

from typing import Any

from flask import request
from flask.views import MethodView
from flask_smorest import Blueprint

from aeva.common.decorators import user_required
from aeva.common.schema import UserData
from aeva.media.media_repository import MediaRepository
from aeva.media.schema.media_schema import MediaSchema

blueprint = Blueprint(
    "media",
    __name__,
    url_prefix="/media",
    description="Media uploads",
)


class MediaUpload(MethodView):
    """Media upload/list routes."""

    @staticmethod
    @user_required
    def post(current_user: UserData) -> dict[str, Any]:
        """Upload media files."""
        files = request.files.getlist("files")
        session_id = request.form.get("session_id")
        return MediaRepository.upload_media(
            current_user, files, session_id
        )

    @staticmethod
    @user_required
    def get(current_user: UserData) -> dict[str, Any]:
        """List media files."""
        session_id = request.args.get("session_id")
        return MediaRepository.list_media(current_user, session_id)


class MediaDetail(MethodView):
    """Media delete route."""

    @staticmethod
    @blueprint.response(200)
    @user_required
    def delete(
        current_user: UserData,
        media_id: str,
    ) -> dict[str, Any]:
        """Delete a media file."""
        return MediaRepository.delete_media(current_user, media_id)


blueprint.add_url_rule(
    "/", view_func=MediaUpload.as_view("media_upload")
)
blueprint.add_url_rule(
    "/<media_id>",
    view_func=MediaDetail.as_view("media_detail"),
)
