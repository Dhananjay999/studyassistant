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
    check_permission,
    configured_permissions,
    issue_token,
    verify_credentials,
)
from aeva.admin.admin_repository import AdminRepository
from aeva.admin.schema.admin_schema import (
    AdminLoginData,
    AdminLoginSchema,
    AuditLogQuerySchema,
    DebugUserToggleData,
    DebugUserToggleSchema,
    EditProfileSchema,
    FeatureFlagToggleData,
    FeatureFlagToggleSchema,
    ResourceListQuery,
    ResourceListQuerySchema,
    SearchQuery,
    SearchQuerySchema,
    UserListQuery,
    UserListQuerySchema,
    UserSearchQuerySchema,
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
        """Return the authenticated admin identity and permission grants."""
        return success_response(
            "Authorized",
            {"username": admin, "permissions": configured_permissions()},
        )


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
    def delete(admin: str, user_id: str) -> dict[str, Any]:
        """Delete the user and all of their data."""
        check_permission("DELETE_USERS")
        return repo.delete_user(admin, user_id)


class AdminUserResetProfile(MethodView):
    """Reset a user's learning profile."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @admin_required
    def post(admin: str, user_id: str) -> dict[str, Any]:
        """Clear personalization back to the pending state."""
        check_permission("EDIT_PROFILE")
        return repo.reset_learning_profile(admin, user_id)


class AdminUserResource(MethodView):
    """Bulk-delete one resource type for a single user."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @admin_required
    def delete(
        admin: str, user_id: str, resource: str
    ) -> dict[str, Any]:
        """Delete all chats/quizzes/flashcards/bookmarks/files for a user."""
        check_permission("DELETE_DATA")
        return repo.clear_user_resource(admin, user_id, resource)


class AdminUserProfile(MethodView):
    """Edit non-sensitive profile/personalization fields (audited)."""

    @staticmethod
    @blueprint.arguments(EditProfileSchema)
    @blueprint.response(200, ResponseEnvelopeSchema)
    @admin_required
    def patch(admin: str, patch: dict, user_id: str) -> dict[str, Any]:
        """Partial profile update; only provided fields change."""
        check_permission("EDIT_PROFILE")
        return repo.edit_profile(admin, user_id, patch)


class AdminUserTimeline(MethodView):
    """Unified activity feed for one user."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @admin_required
    def get(_admin: str, user_id: str) -> dict[str, Any]:
        """Questions, quizzes, attempts, flashcards, uploads, notes."""
        return repo.timeline(user_id)


class AdminUserSearch(MethodView):
    """Search everything inside one user's content."""

    @staticmethod
    @blueprint.arguments(UserSearchQuerySchema, location="query")
    @blueprint.response(200, ResponseEnvelopeSchema)
    @admin_required
    def get(_admin: str, query: dict, user_id: str) -> dict[str, Any]:
        """Ranked matches across chats, notes, quizzes, cards, files."""
        return repo.user_search(user_id, query["q"])


class AdminQuizDetail(MethodView):
    """Complete quiz inspection."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @admin_required
    def get(_admin: str, quiz_id: str) -> dict[str, Any]:
        """Quiz config, questions with answers, and all attempts."""
        return repo.quiz_detail(quiz_id)


class AdminFlashcardDetail(MethodView):
    """Complete flashcard set inspection."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @admin_required
    def get(_admin: str, set_id: str) -> dict[str, Any]:
        """Cards plus per-card study state."""
        return repo.flashcard_detail(set_id)


class AdminMediaDetail(MethodView):
    """Media processing/parsing/embedding inspection."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @admin_required
    def get(_admin: str, media_id: str) -> dict[str, Any]:
        """Full media row + parsed pages / embedded chunk counts + URL."""
        return repo.media_detail(media_id)


class AdminAuditLog(MethodView):
    """Sensitive-action audit trail."""

    @staticmethod
    @blueprint.arguments(AuditLogQuerySchema, location="query")
    @blueprint.response(200, ResponseEnvelopeSchema)
    @admin_required
    def get(_admin: str, query: dict) -> dict[str, Any]:
        """Recent audit entries (optionally one user's)."""
        return repo.list_audit(query.get("user_id"), query["limit"])


class AdminDebugUsers(MethodView):
    """Users with Developer Mode enabled."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @admin_required
    def get(_admin: str) -> dict[str, Any]:
        """List all active debug users."""
        return repo.list_debug_users()


class AdminUserDebugFlag(MethodView):
    """Enable/disable Developer Mode for one user."""

    @staticmethod
    @blueprint.arguments(DebugUserToggleSchema)
    @blueprint.response(200, ResponseEnvelopeSchema)
    @admin_required
    def put(
        admin: str, body: DebugUserToggleData, user_id: str
    ) -> dict[str, Any]:
        """Set the user's debug flag (independent of any role)."""
        check_permission("MANAGE_DEBUG_USERS")
        return repo.set_debug_user(admin, user_id, body.enabled)


class AdminFeatureFlags(MethodView):
    """Global feature flags (registry merged with DB overrides)."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @admin_required
    def get(_admin: str) -> dict[str, Any]:
        """List every flag with its label, description and state."""
        return repo.list_feature_flags()


class AdminFeatureFlag(MethodView):
    """Enable/disable one feature globally."""

    @staticmethod
    @blueprint.arguments(FeatureFlagToggleSchema)
    @blueprint.response(200, ResponseEnvelopeSchema)
    @admin_required
    def put(
        _admin: str, body: FeatureFlagToggleData, key: str
    ) -> dict[str, Any]:
        """Set a flag's enabled state (404 on unknown key)."""
        return repo.set_feature_flag(key, body.enabled)


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
    def delete(admin: str, resource: str) -> dict[str, Any]:
        """Global wipe of users/sessions/quizzes/flashcards/bookmarks/files."""
        check_permission("DELETE_DATA")
        return repo.delete_all(admin, resource)


class AdminResourceItem(MethodView):
    """Delete one row of a resource."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @admin_required
    def delete(
        admin: str, resource: str, item_id: str
    ) -> dict[str, Any]:
        """Delete a single quiz/flashcard set/bookmark/file/session."""
        check_permission("DELETE_DATA")
        return repo.delete_resource_item(admin, resource, item_id)


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
    "/users/<user_id>/profile",
    view_func=AdminUserProfile,
    endpoint="admin_user_profile",
)
blueprint.add_url_rule(
    "/users/<user_id>/timeline",
    view_func=AdminUserTimeline,
    endpoint="admin_user_timeline",
)
blueprint.add_url_rule(
    "/users/<user_id>/search",
    view_func=AdminUserSearch,
    endpoint="admin_user_search",
)
blueprint.add_url_rule(
    "/quizzes/<quiz_id>/detail",
    view_func=AdminQuizDetail,
    endpoint="admin_quiz_detail",
)
blueprint.add_url_rule(
    "/flashcard-sets/<set_id>/detail",
    view_func=AdminFlashcardDetail,
    endpoint="admin_flashcard_detail",
)
blueprint.add_url_rule(
    "/media/<media_id>/detail",
    view_func=AdminMediaDetail,
    endpoint="admin_media_detail",
)
blueprint.add_url_rule(
    "/audit-log",
    view_func=AdminAuditLog,
    endpoint="admin_audit_log",
)
blueprint.add_url_rule(
    "/debug-users",
    view_func=AdminDebugUsers,
    endpoint="admin_debug_users",
)
blueprint.add_url_rule(
    "/users/<user_id>/debug",
    view_func=AdminUserDebugFlag,
    endpoint="admin_user_debug_flag",
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
blueprint.add_url_rule(
    "/feature-flags",
    view_func=AdminFeatureFlags,
    endpoint="admin_feature_flags",
)
blueprint.add_url_rule(
    "/feature-flags/<key>",
    view_func=AdminFeatureFlag,
    endpoint="admin_feature_flag",
)
