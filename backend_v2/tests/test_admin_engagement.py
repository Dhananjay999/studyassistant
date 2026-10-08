"""Admin engagement stats (daily timeline + returning rate).

``AdminRepository.engagement`` over a fake Supabase client: it calls the
``admin_engagement`` function from migration 030 with bounded arguments,
turns the raw counts into rates, and degrades to ``available: false`` when
the migration has not been applied.
"""

from types import SimpleNamespace

import pytest

from aeva.admin.admin_repository import AdminRepository


class FakeRpc:
    def __init__(self, client, name, params):
        self.client = client
        self.name = name
        self.params = params

    def execute(self):
        self.client.executed.append(self)
        answer = self.client.answer
        if isinstance(answer, Exception):
            raise answer
        return SimpleNamespace(data=answer, count=None)


class FakeClient:
    def __init__(self, answer):
        self.answer = answer
        self.executed = []

    def rpc(self, name, params):
        return FakeRpc(self, name, params)

    def table(self, name):  # pragma: no cover - engagement never uses it
        raise AssertionError(f"unexpected table query: {name}")


def repo_for(answer):
    client = FakeClient(answer)
    return AdminRepository(supabase=SimpleNamespace(client=client)), client


RAW = {
    "days": 7,
    "daily": [
        {"day": "2026-10-02", "active_users": 3, "new_users": 1},
        {"day": "2026-10-03", "active_users": 0, "new_users": 0},
    ],
    "window": {"active_users": 10, "new_users": 4, "returning_users": 6},
    "retention": {
        "cohort_days": 30,
        "cohort_size": 20,
        "returned_any": 8,
        "returned_d1": 5,
        "eligible_d7": 16,
        "returned_d7": 6,
    },
}


def test_calls_function_with_bounded_arguments():
    repo, client = repo_for(RAW)
    repo.engagement(days=500, cohort_days=0)
    (call,) = client.executed
    assert call.name == "admin_engagement"
    assert call.params == {"p_days": 90, "p_cohort_days": 1}


def test_shapes_counts_into_rates():
    repo, _ = repo_for(RAW)
    data = repo.engagement()["data"]

    assert data["available"] is True
    assert data["days"] == 7
    assert data["daily"] == RAW["daily"]
    assert data["window"] == {
        "active_users": 10,
        "new_users": 4,
        "returning_users": 6,
        "returning_rate": 0.6,
    }
    assert data["retention"] == {
        "cohort_days": 30,
        "cohort_size": 20,
        "returned_any": 8,
        "returned_any_rate": 0.4,
        "returned_d1": 5,
        "d1_rate": 0.25,
        "eligible_d7": 16,
        "returned_d7": 6,
        "d7_rate": 0.375,
    }


def test_accepts_single_row_list_payload():
    repo, _ = repo_for([RAW])
    data = repo.engagement()["data"]
    assert data["available"] is True
    assert data["window"]["returning_rate"] == 0.6


def test_zero_denominators_give_null_rates():
    empty = {
        "days": 7,
        "daily": [],
        "window": {"active_users": 0, "new_users": 0, "returning_users": 0},
        "retention": {
            "cohort_days": 30,
            "cohort_size": 0,
            "returned_any": 0,
            "returned_d1": 0,
            "eligible_d7": 0,
            "returned_d7": 0,
        },
    }
    repo, _ = repo_for(empty)
    data = repo.engagement()["data"]
    assert data["window"]["returning_rate"] is None
    assert data["retention"]["returned_any_rate"] is None
    assert data["retention"]["d1_rate"] is None
    assert data["retention"]["d7_rate"] is None


@pytest.mark.parametrize("code", ["PGRST202", "42883"])
def test_missing_function_degrades_gracefully(code):
    exc = Exception("Could not find the function admin_engagement")
    exc.code = code
    repo, _ = repo_for(exc)
    data = repo.engagement()["data"]

    assert data["available"] is False
    assert data["daily"] == []
    assert data["window"]["active_users"] == 0
    assert data["retention"]["cohort_size"] == 0
    assert data["retention"]["d7_rate"] is None


def test_other_errors_propagate():
    repo, _ = repo_for(RuntimeError("connection reset"))
    with pytest.raises(RuntimeError):
        repo.engagement()


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------


def _admin_app():
    from flask import Flask, jsonify
    from flask_smorest import Api

    from aeva.admin import admin_controller
    from aeva.common.errors import CustomError

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


def test_engagement_route_is_registered_and_guarded():
    app = _admin_app()
    rules = {r.rule for r in app.url_map.iter_rules()}
    assert "/admin/overview/engagement" in rules
    assert "/admin/overview" in rules  # the existing route is untouched

    response = app.test_client().get("/admin/overview/engagement")
    assert response.get_json()["code"] == "ADMIN_UNAUTHORIZED"


def test_engagement_route_validates_days():
    app = _admin_app()
    client = app.test_client()
    assert client.get("/admin/overview/engagement?days=0").status_code == 422
    assert client.get("/admin/overview/engagement?days=91").status_code == 422
    assert client.get("/admin/overview/engagement?days=x").status_code == 422
    # A valid range gets past validation to the auth guard.
    ok = client.get("/admin/overview/engagement?days=90")
    assert ok.get_json()["code"] == "ADMIN_UNAUTHORIZED"


def test_engagement_route_passes_range_to_repository(monkeypatch):
    from aeva.admin import admin_controller
    from aeva.admin.admin_auth import issue_token

    app = _admin_app()
    calls = []

    class StubRepo:
        def engagement(self, days=7, cohort_days=30):
            calls.append((days, cohort_days))
            return {"msg": "ok", "data": {"available": True}}

    monkeypatch.setattr(admin_controller, "repo", StubRepo())
    with app.app_context():
        token = issue_token("root")["token"]
    headers = {"Authorization": f"Bearer {token}"}
    client = app.test_client()

    assert client.get("/admin/overview/engagement", headers=headers).status_code == 200
    assert client.get("/admin/overview/engagement?days=90", headers=headers).status_code == 200
    assert calls == [(7, 30), (90, 90)]
