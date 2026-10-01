"""Admin routes for AI execution traces and the prompt map.

A second blueprint under the same ``/admin`` prefix as ``admin_controller``,
so the tracing feature registers its routes without touching that file. Every
route is wrapped in ``admin_required`` and verifies the admin JWT server-side.

Permissions differ from the rest of the panel in one respect: a valid token
that lacks a grant gets **403** here. ``check_permission`` answers that case
with ``ADMIN_UNAUTHORIZED`` (401), which the admin UI reads as an expired
session and logs the admin out.
"""

from typing import Any

from flask.views import MethodView
from flask_smorest import Blueprint

from aeva.admin.admin_auth import admin_required, check_permission
from aeva.admin.schema.trace_schema import (
    PromptCatalogQuery,
    PromptCatalogQuerySchema,
    TraceListQuery,
    TraceListQuerySchema,
    TracePurgeData,
    TracePurgeSchema,
)
from aeva.admin.trace_repository import TraceRepository
from aeva.common.errors import CustomError
from aeva.common.schema import ResponseEnvelopeSchema, success_response

blueprint = Blueprint(
    "admin_traces",
    __name__,
    url_prefix="/admin",
    description="Super Admin panel: AI execution traces and the prompt map",
)

trace_repo = TraceRepository()

# Same shape as the entries of ``aeva.common.errors.ERROR_CODES``.
ADMIN_FORBIDDEN: dict[str, Any] = {
    "code": "ADMIN_FORBIDDEN",
    "message": "Your admin account does not have permission to do this",
    "status": 403,
}

_VIEW = "VIEW_DEBUG_DATA"
_VIEW_ACTION = "view AI traces and prompts"
_PURGE = "DELETE_DATA"
_PURGE_ACTION = "delete AI traces"


def _granted(permission: str) -> bool:
    """Whether the current admin token grants ``permission``."""
    try:
        check_permission(permission)
    except CustomError:
        return False
    return True


def _require(permission: str, action: str) -> None:
    """Raise 403 (not 401) unless the admin token grants ``permission``."""
    if not _granted(permission):
        raise CustomError(
            ADMIN_FORBIDDEN,
            details=(
                f"Your admin account does not have permission to {action} "
                f"(missing admin permission: {permission})"
            ),
        )


class AdminSessionTraces(MethodView):
    """AI execution traces recorded for one session."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @admin_required
    def get(_admin: str, session_id: str) -> dict[str, Any]:
        """Trace summaries of the session's turns, newest first.

        The session dialog asks for these on its own, for every admin who
        opens a chat. Without the permission it therefore gets an empty,
        unavailable list (it shows no trace links) instead of an error.
        """
        if not _granted(_VIEW):
            return success_response(
                "Session traces", {"traces": [], "available": False}
            )
        return trace_repo.session_traces(session_id)


class AdminTraces(MethodView):
    """Paginated, searchable list of AI execution traces."""

    @staticmethod
    @blueprint.arguments(TraceListQuerySchema, location="query")
    @blueprint.response(200, ResponseEnvelopeSchema)
    @admin_required
    def get(_admin: str, query: TraceListQuery) -> dict[str, Any]:
        """List traces; ``q`` is free text or any id of the flow."""
        _require(_VIEW, _VIEW_ACTION)
        return trace_repo.list_traces(query)


class AdminTracePurge(MethodView):
    """Retention: delete old AI execution traces (audited)."""

    @staticmethod
    @blueprint.arguments(TracePurgeSchema)
    @blueprint.response(200, ResponseEnvelopeSchema)
    @admin_required
    def post(admin: str, body: TracePurgeData) -> dict[str, Any]:
        """Delete traces older than ``days`` days."""
        _require(_PURGE, _PURGE_ACTION)
        return trace_repo.purge_traces(admin, body.days)


class AdminTraceDetail(MethodView):
    """One AI execution trace with every recorded step."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @admin_required
    def get(_admin: str, trace_id: str) -> dict[str, Any]:
        """Return the trace row plus its spans in creation order."""
        _require(_VIEW, _VIEW_ACTION)
        return trace_repo.get_trace(trace_id)


class AdminPrompts(MethodView):
    """Prompt map: every template, where it is used, what it affects."""

    @staticmethod
    @blueprint.arguments(PromptCatalogQuerySchema, location="query")
    @blueprint.response(200, ResponseEnvelopeSchema)
    @admin_required
    def get(_admin: str, query: PromptCatalogQuery) -> dict[str, Any]:
        """Templates, shared blocks and the flow, with recent usage."""
        _require(_VIEW, _VIEW_ACTION)
        return trace_repo.prompt_catalog(query.days)


class AdminPromptVersion(MethodView):
    """The text of one version of a prompt template."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @admin_required
    def get(_admin: str, name: str, digest: str) -> dict[str, Any]:
        """One template version, identified by its content hash."""
        _require(_VIEW, _VIEW_ACTION)
        return trace_repo.prompt_version(name, digest)


blueprint.add_url_rule(
    "/sessions/<session_id>/traces",
    view_func=AdminSessionTraces,
    endpoint="session_traces",
)
blueprint.add_url_rule("/traces", view_func=AdminTraces, endpoint="traces")
# Registered before ``/traces/<trace_id>``; werkzeug also ranks the static
# rule first, so "purge" is never read as a trace id.
blueprint.add_url_rule(
    "/traces/purge", view_func=AdminTracePurge, endpoint="trace_purge"
)
blueprint.add_url_rule(
    "/traces/<trace_id>", view_func=AdminTraceDetail, endpoint="trace_detail"
)
blueprint.add_url_rule("/prompts", view_func=AdminPrompts, endpoint="prompts")
blueprint.add_url_rule(
    "/prompts/<name>/versions/<digest>",
    view_func=AdminPromptVersion,
    endpoint="prompt_version",
)
