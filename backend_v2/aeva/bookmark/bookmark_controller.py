"""Bookmark controller."""

from typing import Any

from flask.views import MethodView
from flask_smorest import Blueprint

from aeva.bookmark.bookmark_repository import BookmarkRepository
from aeva.bookmark.schema.bookmark_schema import (
    CreateBookmarkSchema,
    CreateCollectionSchema,
    UpdateBookmarkSchema,
    UpdateCollectionSchema,
)
from aeva.common.decorators import user_required
from aeva.common.schema import ResponseEnvelopeSchema, UserData

blueprint = Blueprint(
    "bookmark",
    __name__,
    url_prefix="/bookmarks",
    description="Bookmarks and collections",
)


class BookmarkList(MethodView):
    """Bookmark list/create routes."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def get(current_user: UserData) -> dict[str, Any]:
        """List all bookmarks."""
        return BookmarkRepository.list_bookmarks(current_user)

    @staticmethod
    @blueprint.arguments(CreateBookmarkSchema)
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def post(
        current_user: UserData,
        request_data: object,
    ) -> dict[str, Any]:
        """Create a bookmark."""
        return BookmarkRepository.create_bookmark(current_user, request_data)


class BookmarkDetail(MethodView):
    """Bookmark fetch/update/delete routes."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def get(current_user: UserData, bookmark_id: str) -> dict[str, Any]:
        """Fetch a single bookmark with full content."""
        return BookmarkRepository.get_bookmark(current_user, bookmark_id)

    @staticmethod
    @blueprint.arguments(UpdateBookmarkSchema)
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def patch(
        current_user: UserData,
        data: dict,
        bookmark_id: str,
    ) -> dict[str, Any]:
        """Update a bookmark (move folder / rename)."""
        return BookmarkRepository.update_bookmark(
            current_user, bookmark_id, data
        )

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def delete(
        current_user: UserData,
        bookmark_id: str,
    ) -> dict[str, Any]:
        """Delete a bookmark."""
        return BookmarkRepository.delete_bookmark(current_user, bookmark_id)


class CollectionList(MethodView):
    """Collection list/create routes."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def get(current_user: UserData) -> dict[str, Any]:
        """List collections."""
        return BookmarkRepository.list_collections(current_user)

    @staticmethod
    @blueprint.arguments(CreateCollectionSchema)
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def post(
        current_user: UserData,
        request_data: object,
    ) -> dict[str, Any]:
        """Create a collection."""
        return BookmarkRepository.create_collection(current_user, request_data)


class CollectionDetail(MethodView):
    """Collection update/delete routes."""

    @staticmethod
    @blueprint.arguments(UpdateCollectionSchema)
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def patch(
        current_user: UserData,
        request_data: object,
        collection_id: str,
    ) -> dict[str, Any]:
        """Rename a collection."""
        return BookmarkRepository.rename_collection(
            current_user, collection_id, request_data
        )

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def delete(
        current_user: UserData,
        collection_id: str,
    ) -> dict[str, Any]:
        """Delete a collection (its bookmarks move to Favorites)."""
        return BookmarkRepository.delete_collection(
            current_user, collection_id
        )


blueprint.add_url_rule(
    "/", view_func=BookmarkList, endpoint="bookmark_list"
)
blueprint.add_url_rule(
    "/collections",
    view_func=CollectionList,
    endpoint="collection_list",
)
blueprint.add_url_rule(
    "/collections/<collection_id>",
    view_func=CollectionDetail,
    endpoint="collection_detail",
)
blueprint.add_url_rule(
    "/<bookmark_id>",
    view_func=BookmarkDetail,
    endpoint="bookmark_detail",
)
