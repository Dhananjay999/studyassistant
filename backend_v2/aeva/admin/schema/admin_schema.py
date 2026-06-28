"""Admin request schemas: login and the user-list query.

Response bodies use the shared ``ResponseEnvelopeSchema`` with a raw ``data``
payload (the admin UI is internal and evolves quickly, so responses are not
strictly typed field-by-field).
"""

from dataclasses import dataclass

from marshmallow import Schema, fields, post_load, validate

_SORT_FIELDS = ["created_at", "email", "full_name"]
_STATUSES = ["all", "completed", "pending", "skipped"]


@dataclass(frozen=True)
class AdminLoginData:
    """Validated admin login credentials."""

    username: str
    password: str


class AdminLoginSchema(Schema):
    """Admin login request."""

    username = fields.Str(
        required=True, validate=validate.Length(min=1, max=200)
    )
    password = fields.Str(
        required=True, validate=validate.Length(min=1, max=400)
    )

    @post_load
    def make_data(
        self, data: dict, **_kwargs: object
    ) -> AdminLoginData:
        """Convert to dataclass."""
        return AdminLoginData(**data)


@dataclass(frozen=True)
class UserListQuery:
    """Validated filters for the paginated user list."""

    q: str = ""
    page: int = 1
    page_size: int = 25
    sort: str = "created_at"
    order: str = "desc"
    status: str = "all"


class UserListQuerySchema(Schema):
    """Query-string filters for ``GET /admin/users``."""

    q = fields.Str(load_default="")
    page = fields.Int(load_default=1, validate=validate.Range(min=1))
    page_size = fields.Int(
        load_default=25, validate=validate.Range(min=1, max=100)
    )
    sort = fields.Str(
        load_default="created_at", validate=validate.OneOf(_SORT_FIELDS)
    )
    order = fields.Str(
        load_default="desc", validate=validate.OneOf(["asc", "desc"])
    )
    status = fields.Str(
        load_default="all", validate=validate.OneOf(_STATUSES)
    )

    @post_load
    def make_data(
        self, data: dict, **_kwargs: object
    ) -> UserListQuery:
        """Convert to dataclass."""
        return UserListQuery(**data)


@dataclass(frozen=True)
class ResourceListQuery:
    """Validated filters for a global resource listing."""

    q: str = ""
    user_id: str = ""
    page: int = 1
    page_size: int = 25


class ResourceListQuerySchema(Schema):
    """Query-string filters for ``GET /admin/resources/<resource>``."""

    q = fields.Str(load_default="")
    user_id = fields.Str(load_default="")
    page = fields.Int(load_default=1, validate=validate.Range(min=1))
    page_size = fields.Int(
        load_default=25, validate=validate.Range(min=1, max=100)
    )

    @post_load
    def make_data(
        self, data: dict, **_kwargs: object
    ) -> ResourceListQuery:
        """Convert to dataclass."""
        return ResourceListQuery(**data)


@dataclass(frozen=True)
class SearchQuery:
    """Validated global-search term."""

    q: str = ""


class SearchQuerySchema(Schema):
    """Query-string for ``GET /admin/search``."""

    q = fields.Str(load_default="")

    @post_load
    def make_data(self, data: dict, **_kwargs: object) -> SearchQuery:
        """Convert to dataclass."""
        return SearchQuery(**data)
