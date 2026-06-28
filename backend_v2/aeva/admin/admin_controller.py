"""Admin controller: secret, JWT-guarded management endpoints.

The blueprint prefix is ``/admin``. Only ``/admin/auth/login`` is public
(it issues the token); every other route is wrapped in ``admin_required`` and
verifies the admin JWT server-side. Access never depends on the secret URL.
"""

from typing import Any

from flask.views import MethodView
from flask_smorest import Blueprint

from aeva.admin.admin_auth import (
    admin_required,
    issue_token,
    verify_credentials,
)
from aeva.admin.admin_repository import AdminRepository
from aeva.admin.schema.admin_schema import (
    AdminLoginData,
    AdminLoginSchema,
    ResourceListQuery,
    ResourceListQuerySchema,
    SearchQuery,
    SearchQuerySchema,
    UserListQuery,
    UserListQuerySchema,
)
from aeva.common.errors import ERROR_CODES, CustomError
from aeva.common.schema import ResponseEnvelopeSchema, success_response

blueprint = Blueprint(
    "admin",
    __name__,
    url_prefix="/admin",
    description="Super Admin panel (internal, JWT-guarded)",
)

repo = AdminRepository()


class AdminLogin(MethodView):
    """Exchange env credentials for a short-lived admin token."""

    @staticmethod
    @blueprint.arguments(AdminLoginSchema)
    @blueprint.response(200, ResponseEnvelopeSchema)
    @blueprint.doc(security=[])
    def post(login: AdminLoginData) -> dict[str, Any]:
        """Authenticate an admin and return a signed token."""
        if not verify_credentials(login.username, login.password):
            raise CustomError(ERROR_CODES["ADMIN_INVALID_CREDENTIALS"])
        token = issue_token(login.username)
        return success_response(
            "Authenticated",
            {"username": login.username, **token},
        )


class AdminVerify(MethodView):
    """Validate a stored admin token (used on panel reload)."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @admin_required
    def get(admin: str) -> dict[str, Any]:
        """Return the authenticated admin identity."""
        return success_response("Authorized", {"username": admin})


class AdminOverview(MethodView):
    """Dashboard statistics."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @admin_required
    def get(_admin: str) -> dict[str, Any]:
        """Platform-wide counters."""
        return repo.overview()


class AdminUsers(MethodView):
    """Paginated, searchable user list."""

    @staticmethod
    @blueprint.arguments(UserListQuerySchema, location="query")
    @blueprint.response(200, ResponseEnvelopeSchema)
    @admin_required
    def get(_admin: str, query: UserListQuery) -> dict[str, Any]:
        """List users with per-user counts."""
        return repo.list_users(query)


class AdminUserDetail(MethodView):
    """Single-user detail and full deletion."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @admin_required
    def get(_admin: str, user_id: str) -> dict[str, Any]:
        """Profile, counts, and recent items for one user."""
        return repo.get_user(user_id)

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @admin_required
    def delete(_admin: str, user_id: str) -> dict[str, Any]:
        """Delete the user and all of their data."""
        return repo.delete_user(user_id)


class AdminUserResetProfile(MethodView):
    """Reset a user's learning profile."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @admin_required
    def post(_admin: str, user_id: str) -> dict[str, Any]:
        """Clear personalization back to the pending state."""
        return repo.reset_learning_profile(user_id)


class AdminUserResource(MethodView):
    """Bulk-delete one resource type for a single user."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @admin_required
    def delete(
        _admin: str, user_id: str, resource: str
    ) -> dict[str, Any]:
        """Delete all chats/quizzes/flashcards/bookmarks/files for a user."""
        return repo.clear_user_resource(user_id, resource)


class AdminSession(MethodView):
    """A single session's full conversation history."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @admin_required
    def get(_admin: str, session_id: str) -> dict[str, Any]:
        """Session metadata plus every message."""
        return repo.get_session(session_id)


class AdminGlobalResource(MethodView):
    """List, or globally delete, a resource across all users."""

    @staticmethod
    @blueprint.arguments(ResourceListQuerySchema, location="query")
    @blueprint.response(200, ResponseEnvelopeSchema)
    @admin_required
    def get(
        _admin: str, query: ResourceListQuery, resource: str
    ) -> dict[str, Any]:
        """Paginated, searchable list of one resource (filterable by user)."""
        return repo.list_resource(resource, query)

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @admin_required
    def delete(_admin: str, resource: str) -> dict[str, Any]:
        """Global wipe of users/sessions/quizzes/flashcards/bookmarks/files."""
        return repo.delete_all(resource)


class AdminResourceItem(MethodView):
    """Delete one row of a resource."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @admin_required
    def delete(
        _admin: str, resource: str, item_id: str
    ) -> dict[str, Any]:
        """Delete a single quiz/flashcard set/bookmark/file/session."""
        return repo.delete_resource_item(resource, item_id)


class AdminSearch(MethodView):
    """Global search across users and every listable resource."""

    @staticmethod
    @blueprint.arguments(SearchQuerySchema, location="query")
    @blueprint.response(200, ResponseEnvelopeSchema)
    @admin_required
    def get(_admin: str, query: SearchQuery) -> dict[str, Any]:
        """Return grouped matches across users and listable resources."""
        return repo.search(query.q)


blueprint.add_url_rule(
    "/auth/login", view_func=AdminLogin, endpoint="admin_login"
)
blueprint.add_url_rule(
    "/auth/verify", view_func=AdminVerify, endpoint="admin_verify"
)
blueprint.add_url_rule(
    "/overview", view_func=AdminOverview, endpoint="admin_overview"
)
blueprint.add_url_rule(
    "/users", view_func=AdminUsers, endpoint="admin_users"
)
blueprint.add_url_rule(
    "/users/<user_id>",
    view_func=AdminUserDetail,
    endpoint="admin_user_detail",
)
blueprint.add_url_rule(
    "/users/<user_id>/reset-learning-profile",
    view_func=AdminUserResetProfile,
    endpoint="admin_user_reset_profile",
)
blueprint.add_url_rule(
    "/users/<user_id>/resources/<resource>",
    view_func=AdminUserResource,
    endpoint="admin_user_resource",
)
blueprint.add_url_rule(
    "/sessions/<session_id>",
    view_func=AdminSession,
    endpoint="admin_session",
)
blueprint.add_url_rule(
    "/resources/<resource>",
    view_func=AdminGlobalResource,
    endpoint="admin_global_resource",
)
blueprint.add_url_rule(
    "/resources/<resource>/<item_id>",
    view_func=AdminResourceItem,
    endpoint="admin_resource_item",
)
blueprint.add_url_rule(
    "/search", view_func=AdminSearch, endpoint="admin_search"
)
