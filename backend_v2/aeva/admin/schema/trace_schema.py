"""Admin request schemas for AI execution traces and the prompt map.

Kept apart from ``admin_schema`` so the tracing feature adds nothing to the
admin panel's own files. Responses use the shared ``ResponseEnvelopeSchema``
with a raw ``data`` payload, like every other admin route.
"""

from dataclasses import dataclass

from marshmallow import Schema, fields, post_load, validate


@dataclass(frozen=True)
class TraceListQuery:
    """Validated filters for the AI trace list."""

    # Free text (matched against the user's message) or any id of the flow:
    # trace, session, user, message or run.
    q: str = ""
    user_id: str = ""
    session_id: str = ""
    status: str = ""
    tool: str = ""
    prompt: str = ""
    plan_source: str = ""
    page: int = 1
    page_size: int = 25


class TraceListQuerySchema(Schema):
    """Query-string filters for ``GET /admin/traces``."""

    q = fields.Str(load_default="", validate=validate.Length(max=200))
    user_id = fields.Str(load_default="", validate=validate.Length(max=64))
    session_id = fields.Str(load_default="", validate=validate.Length(max=64))
    status = fields.Str(load_default="", validate=validate.Length(max=40))
    tool = fields.Str(load_default="", validate=validate.Length(max=120))
    prompt = fields.Str(load_default="", validate=validate.Length(max=120))
    plan_source = fields.Str(load_default="", validate=validate.Length(max=60))
    page = fields.Int(load_default=1, validate=validate.Range(min=1))
    page_size = fields.Int(
        load_default=25, validate=validate.Range(min=1, max=100)
    )

    @post_load
    def make_data(self, data: dict, **_kwargs: object) -> TraceListQuery:
        """Convert to dataclass."""
        return TraceListQuery(**data)


@dataclass(frozen=True)
class TracePurgeData:
    """Validated body for purging old AI traces."""

    days: int


class TracePurgeSchema(Schema):
    """Body for ``POST /admin/traces/purge``: keep the last ``days`` days."""

    days = fields.Int(required=True, validate=validate.Range(min=1, max=3650))

    @post_load
    def make_data(self, data: dict, **_kwargs: object) -> TracePurgeData:
        """Convert to dataclass."""
        return TracePurgeData(**data)


@dataclass(frozen=True)
class PromptCatalogQuery:
    """Validated query for the prompt map: the usage-statistics window."""

    days: int = 7


class PromptCatalogQuerySchema(Schema):
    """Query-string for ``GET /admin/prompts``: the usage-stats window."""

    days = fields.Int(load_default=7, validate=validate.Range(min=1, max=365))

    @post_load
    def make_data(self, data: dict, **_kwargs: object) -> PromptCatalogQuery:
        """Convert to dataclass."""
        return PromptCatalogQuery(**data)
