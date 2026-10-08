"""Media controller."""

from collections.abc import Generator
from typing import Any

from flask import Response, current_app, request
from flask.views import MethodView
from flask_smorest import Blueprint

from aeva.common.decorators import user_required
from aeva.common.schema import ResponseEnvelopeSchema, UserData
from aeva.media.media_repository import MediaRepository
from aeva.media.schema.media_schema import (
    AttachMediaData,
    AttachMediaSchema,
    CompleteUploadData,
    CompleteUploadSchema,
    UploadUrlData,
    UploadUrlSchema,
)

blueprint = Blueprint(
    "media",
    __name__,
    url_prefix="/media",
    description="Media uploads",
)


class MediaUpload(MethodView):
    """Media upload/list routes."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def post(current_user: UserData) -> dict[str, Any]:
        """Upload media files."""
        files = request.files.getlist("files")
        session_id = request.form.get("session_id")
        space_id = request.form.get("space_id")
        return MediaRepository.upload_media(
            current_user, files, session_id, space_id
        )

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def get(current_user: UserData) -> dict[str, Any]:
        """List media files (optionally ?session_id= / ?space_id= scoped)."""
        session_id = request.args.get("session_id")
        space_id = request.args.get("space_id")
        return MediaRepository.list_media(current_user, session_id, space_id)


class MediaUploadUrl(MethodView):
    """Direct upload, step 1: a signed URL the browser PUTs the file to."""

    @staticmethod
    @blueprint.arguments(UploadUrlSchema)
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def post(
        current_user: UserData,
        request_data: UploadUrlData,
    ) -> dict[str, Any]:
        """Validate the file's type and size, then mint the upload URL."""
        return MediaRepository.create_upload_url(current_user, request_data)


class MediaComplete(MethodView):
    """Direct upload, step 2: register the object now in storage."""

    @staticmethod
    @blueprint.arguments(CompleteUploadSchema)
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def post(
        current_user: UserData,
        request_data: CompleteUploadData,
    ) -> dict[str, Any]:
        """Check the stored object and create its media record."""
        return MediaRepository.complete_upload(current_user, request_data)


class MediaAttach(MethodView):
    """Link uploads to a chat session."""

    @staticmethod
    @blueprint.arguments(AttachMediaSchema)
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def post(
        current_user: UserData,
        request_data: AttachMediaData,
    ) -> dict[str, Any]:
        """Attach media uploaded before the chat existed to that session."""
        return MediaRepository.attach_media(current_user, request_data)


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


class MediaStatus(MethodView):
    """Media processing-status route (polling / reconnect)."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def get(
        current_user: UserData,
        media_id: str,
    ) -> dict[str, Any]:
        """Return a media record with its current processing status."""
        return MediaRepository.get_status(current_user, media_id)


class MediaProcess(MethodView):
    """Media processing route: streams RAG-pipeline progress via SSE."""

    @staticmethod
    @user_required
    def get(
        current_user: UserData,
        media_id: str,
    ) -> Response:
        """Run (or resume) processing, streaming stage progress as SSE."""
        app = current_app._get_current_object()  # noqa: SLF001

        def generate() -> Generator[str, None, None]:
            with app.app_context():
                yield from MediaRepository.process_stream(
                    current_user, media_id
                )

        return Response(
            generate(),
            mimetype="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )


blueprint.add_url_rule(
    "/", view_func=MediaUpload, endpoint="media_upload"
)
blueprint.add_url_rule(
    "/upload-url", view_func=MediaUploadUrl, endpoint="media_upload_url"
)
blueprint.add_url_rule(
    "/complete", view_func=MediaComplete, endpoint="media_complete"
)
blueprint.add_url_rule(
    "/attach", view_func=MediaAttach, endpoint="media_attach"
)
blueprint.add_url_rule(
    "/<media_id>",
    view_func=MediaDetail,
    endpoint="media_detail",
)
blueprint.add_url_rule(
    "/<media_id>/status",
    view_func=MediaStatus,
    endpoint="media_status",
)
blueprint.add_url_rule(
    "/<media_id>/process",
    view_func=MediaProcess,
    endpoint="media_process",
)
