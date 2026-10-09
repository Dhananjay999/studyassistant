"""Admin engagement drill-down: the users behind the window figures.

``AdminRepository.engagement_users`` over a fake Supabase client: it calls
``admin_engagement_users`` (migration 034) with bounded arguments and the
admin timezone, shapes rows like the user list plus ``active_days`` /
``is_new``, paginates by opaque keyset cursor, rejects bad input, and
degrades to ``available: false`` when the migration is not applied.
"""

from types import SimpleNamespace

import pytest

from aeva.admin import admin_repository
from aeva.admin.admin_repository import AdminRepository
from aeva.common.errors import CustomError

U1 = "11111111-1111-1111-1111-111111111111"
U2 = "22222222-2222-2222-2222-222222222222"


class FakeRpc:
    def __init__(self, client, name, params):
        self.client = client
        self.name = name
        self.params = params

    def execute(self):
        self.client.rpc_calls.append(self)
        answer = self.client.rpc_answer
        if isinstance(answer, Exception):
            raise answer
        return SimpleNamespace(data=answer, count=None)


class FakeQuery:
    """Just enough of the PostgREST builder for select().in_().execute()."""

    def __init__(self, client, table):
        self.client = client
        self.table = table
        self.filters = {}

    def select(self, *_a, **_k):
        return self

    def in_(self, column, values):
        self.filters[column] = list(values)
        return self

    def execute(self):
        self.client.table_calls.append((self.table, dict(self.filters)))
        return SimpleNamespace(
            data=self.client.tables.get(self.table, []), count=None
        )


class FakeClient:
    def __init__(self, rpc_answer, tables=None):
        self.rpc_answer = rpc_answer
        self.tables = tables or {}
        self.rpc_calls = []
        self.table_calls = []

    def rpc(self, name, params):
        return FakeRpc(self, name, params)

    def table(self, name):
        return FakeQuery(self, name)


def repo_for(rpc_answer, tables=None):
    client = FakeClient(rpc_answer, tables)
    return AdminRepository(supabase=SimpleNamespace(client=client)), client


ROWS = [
    {
        "user_id": U1,
        "last_active": "2026-10-09T05:00:00+00:00",
        "active_days": 3,
        "is_new": False,
    },
    {
        "user_id": U2,
        "last_active": "2026-10-08T12:00:00+00:00",
        "active_days": 1,
        "is_new": False,
    },
]
PROFILES = [
    {"id": U1, "email": "a@x.test", "full_name": "A", "created_at": "2026-09-01"},
    {"id": U2, "email": "b@x.test", "full_name": "B", "created_at": "2026-09-02"},
]
TABLES = {
    "profiles": PROFILES,
    "sessions": [{"user_id": U1, "updated_at": "2026-10-09T05:00:00+00:00"}],
    "quizzes": [{"user_id": U2}],
    "flashcard_sets": [],
    "media": [],
}


def test_calls_function_with_bounded_arguments_and_admin_timezone():
    repo, client = repo_for([], TABLES)
    repo.engagement_users(days=500, kind="new", limit=1000)
    (call,) = client.rpc_calls
    assert call.name == "admin_engagement_users"
    assert call.params == {
        "p_days": 90,
        "p_tz": admin_repository.ADMIN_TIMEZONE,
        "p_kind": "new",
        "p_limit": 100,
        "p_after_active": None,
        "p_after_id": None,
    }


def test_shapes_rows_like_the_user_list_plus_window_fields():
    repo, client = repo_for(ROWS, TABLES)
    data = repo.engagement_users(days=7, kind="returning", limit=25)["data"]

    assert data["available"] is True
    assert data["kind"] == "returning"
    assert data["days"] == 7
    assert data["timezone"] == admin_repository.ADMIN_TIMEZONE
    assert [u["id"] for u in data["users"]] == [U1, U2]
    first = data["users"][0]
    assert first["email"] == "a@x.test"
    assert first["total_chats"] == 1
    assert first["active_days"] == 3
    assert first["is_new"] is False
    assert data["users"][1]["total_quizzes"] == 1
    # Fewer rows than the page size: last page.
    assert data["next_cursor"] is None
    # The profile and aggregate reads are scoped to this page's ids only.
    for _table, filters in client.table_calls:
        assert set(next(iter(filters.values()))) == {U1, U2}


def test_full_page_yields_cursor_that_round_trips():
    repo, client = repo_for(ROWS, TABLES)
    data = repo.engagement_users(days=7, limit=2)["data"]
    cursor = data["next_cursor"]
    assert cursor == f"2026-10-08T12:00:00+00:00~{U2}"

    repo.engagement_users(days=7, limit=2, cursor=cursor)
    params = client.rpc_calls[-1].params
    assert params["p_after_active"] == "2026-10-08T12:00:00+00:00"
    assert params["p_after_id"] == U2


def test_skips_users_deleted_between_reads():
    repo, _ = repo_for(ROWS, {**TABLES, "profiles": PROFILES[:1]})
    data = repo.engagement_users()["data"]
    assert [u["id"] for u in data["users"]] == [U1]


@pytest.mark.parametrize("cursor", ["garbage", "2026-10-08~not-a-uuid", "~"])
def test_bad_cursor_is_rejected_before_the_database(cursor):
    repo, client = repo_for(ROWS, TABLES)
    with pytest.raises(CustomError):
        repo.engagement_users(cursor=cursor)
    assert client.rpc_calls == []


def test_bad_kind_is_rejected():
    repo, _ = repo_for(ROWS, TABLES)
    with pytest.raises(CustomError):
        repo.engagement_users(kind="everyone")


def test_missing_function_degrades_gracefully():
    exc = Exception("Could not find the function admin_engagement_users")
    exc.code = "PGRST202"
    repo, _ = repo_for(exc, TABLES)
    data = repo.engagement_users()["data"]
    assert data["available"] is False
    assert data["users"] == []
    assert data["next_cursor"] is None


def test_other_errors_propagate():
    repo, _ = repo_for(RuntimeError("connection reset"), TABLES)
    with pytest.raises(RuntimeError):
        repo.engagement_users()


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------


def _admin_app():
    from flask import Flask, jsonify
    from flask_smorest import Api

    from aeva.admin import admin_controller

    flask_app = Flask(__name__)
    flask_app.config.update(
        TESTING=True,
        API_TITLE="test",
        API_VERSION="1",
        OPENAPI_VERSION="3.0.2",
        ADMIN_USERNAME="root",
        ADMIN_PASSWORD="pw",  # noqa: S106
        ADMIN_JWT_SECRET="unit-test-secret-that-is-long-enough-for-hs256",  # noqa: S106
        ADMIN_PERMISSIONS="*",
    )

    @flask_app.errorhandler(CustomError)
    def handle(error):
        return jsonify({"msg": error.message, "code": error.code}), error.status

    Api(flask_app).register_blueprint(admin_controller.blueprint)
    return flask_app


def test_route_is_registered_guarded_and_validated():
    app = _admin_app()
    rules = {r.rule for r in app.url_map.iter_rules()}
    assert "/admin/overview/engagement/users" in rules
    client = app.test_client()
    path = "/admin/overview/engagement/users"
    assert client.get(path).get_json()["code"] == "ADMIN_UNAUTHORIZED"
    assert client.get(f"{path}?kind=everyone").status_code == 422
    assert client.get(f"{path}?limit=0").status_code == 422
    assert client.get(f"{path}?limit=101").status_code == 422
    assert client.get(f"{path}?days=91").status_code == 422


def test_route_passes_arguments_to_repository(monkeypatch):
    from aeva.admin import admin_controller
    from aeva.admin.admin_auth import issue_token

    app = _admin_app()
    calls = []

    class StubRepo:
        def engagement_users(self, **kwargs):
            calls.append(kwargs)
            return {"msg": "ok", "data": {"available": True}}

    monkeypatch.setattr(admin_controller, "repo", StubRepo())
    with app.app_context():
        token = issue_token("root")["token"]
    headers = {"Authorization": f"Bearer {token}"}
    client = app.test_client()
    path = "/admin/overview/engagement/users"

    assert client.get(path, headers=headers).status_code == 200
    assert (
        client.get(
            f"{path}?days=30&kind=new&limit=50&cursor=abc", headers=headers
        ).status_code
        == 200
    )
    assert calls == [
        {"days": 7, "kind": "returning", "limit": 25, "cursor": None},
        {"days": 30, "kind": "new", "limit": 50, "cursor": "abc"},
    ]
