"""Admin user list: plan tier on each row and the ``plan`` filter.

``AdminRepository.list_users`` over a fake PostgREST builder: rows carry
``plan`` / ``plan_status`` / ``pro_activated_at`` (defaulting like the
migration 040 columns), ``plan=pro|free`` adds an ``eq("plan", ...)``
filter and ``plan=all`` (the default) adds none. The query schema accepts
only ``all | free | pro``.
"""

from types import SimpleNamespace

import pytest
from marshmallow import ValidationError

from aeva.admin.admin_repository import AdminRepository
from aeva.admin.schema.admin_schema import UserListQuery, UserListQuerySchema

U1 = "11111111-1111-1111-1111-111111111111"
U2 = "22222222-2222-2222-2222-222222222222"

PROFILES = [
    {
        "id": U1,
        "email": "pro@example.com",
        "full_name": "Pro User",
        "created_at": "2026-10-01T00:00:00+00:00",
        "plan": "pro",
        "plan_status": "early_access",
        "pro_activated_at": "2026-10-02T00:00:00+00:00",
    },
    {
        # A row written before migration 040: no plan columns at all.
        "id": U2,
        "email": "free@example.com",
        "full_name": "Free User",
        "created_at": "2026-09-01T00:00:00+00:00",
    },
]


class FakeQuery:
    """Enough of the PostgREST builder for list_users()."""

    def __init__(self, client, table):
        self.client = client
        self.table = table
        self.eq_filters: list[tuple[str, str]] = []

    def select(self, *_a, **_k):
        return self

    def or_(self, *_a, **_k):
        return self

    def eq(self, column, value):
        self.eq_filters.append((column, value))
        return self

    def in_(self, *_a, **_k):
        return self

    def order(self, *_a, **_k):
        return self

    def range(self, *_a, **_k):
        return self

    def execute(self):
        self.client.calls.append((self.table, list(self.eq_filters)))
        rows = self.client.tables.get(self.table, [])
        if self.table == "profiles":
            for column, value in self.eq_filters:
                rows = [r for r in rows if r.get(column) == value]
        return SimpleNamespace(data=rows, count=len(rows))


class FakeClient:
    def __init__(self, tables):
        self.tables = tables
        self.calls: list[tuple[str, list[tuple[str, str]]]] = []

    def table(self, name):
        return FakeQuery(self, name)


def _repo(tables=None):
    client = FakeClient(tables or {"profiles": PROFILES})
    repo = AdminRepository(SimpleNamespace(client=client))
    return repo, client


def _profile_filters(client):
    return next(f for table, f in client.calls if table == "profiles")


def test_rows_carry_plan_fields_with_defaults():
    repo, _client = _repo()
    data = repo.list_users(UserListQuery())["data"]
    by_id = {u["id"]: u for u in data["users"]}

    assert by_id[U1]["plan"] == "pro"
    assert by_id[U1]["plan_status"] == "early_access"
    assert by_id[U1]["pro_activated_at"] == "2026-10-02T00:00:00+00:00"
    # Pre-migration row reports the column defaults.
    assert by_id[U2]["plan"] == "free"
    assert by_id[U2]["plan_status"] == "none"
    assert by_id[U2]["pro_activated_at"] is None


def test_default_plan_all_adds_no_filter():
    repo, client = _repo()
    data = repo.list_users(UserListQuery())["data"]

    assert data["total"] == 2
    assert ("plan", "pro") not in _profile_filters(client)
    assert ("plan", "free") not in _profile_filters(client)


@pytest.mark.parametrize("plan", ["pro", "free"])
def test_plan_filter_is_pushed_to_the_query(plan):
    repo, client = _repo()
    data = repo.list_users(UserListQuery(plan=plan))["data"]

    assert ("plan", plan) in _profile_filters(client)
    assert data["total"] == (1 if plan == "pro" else 0)


def test_plan_filter_combines_with_status_filter():
    repo, client = _repo()
    repo.list_users(UserListQuery(status="completed", plan="pro"))

    filters = _profile_filters(client)
    assert ("personalization_status", "completed") in filters
    assert ("plan", "pro") in filters


def test_schema_defaults_and_accepts_plan():
    assert UserListQuerySchema().load({}).plan == "all"
    assert UserListQuerySchema().load({"plan": "pro"}).plan == "pro"
    assert UserListQuerySchema().load({"plan": "free"}).plan == "free"


def test_schema_rejects_unknown_plan():
    with pytest.raises(ValidationError):
        UserListQuerySchema().load({"plan": "enterprise"})
