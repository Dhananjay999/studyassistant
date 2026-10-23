"""Plan domain: the catalog, the profile projection and the ``/plan`` routes.

No database: the repository is exercised against a fake SupabaseService
that keeps one profile row in memory.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest
from flask import Flask, jsonify
from flask_smorest import Api

from aeva.common.errors import CustomError
from aeva.plan import plan_controller, plan_repository, plan_service

USER = "22222222-2222-2222-2222-222222222222"


# ------------------------------------------------------------- service


def test_catalog_lists_pro_prices_and_zero_today():
    plans = {p["key"]: p for p in plan_service.catalog()}
    assert set(plans) == {"free", "pro"}
    pro = plans["pro"]
    assert pro["label"] == "Aeva Pro"
    assert pro["current_amount"] == 0
    assert pro["early_access"] is True
    assert {
        (p["currency"], p["interval"], p["amount"]) for p in pro["prices"]
    } == {
        ("INR", "month", 99),
        ("INR", "year", 799),
        ("USD", "month", 4.99),
        ("USD", "year", 39),
    }


def test_prices_for_filters_one_currency():
    inr = plan_service.prices_for("pro", "INR")
    assert [(p.interval, p.amount) for p in inr] == [
        ("month", 99),
        ("year", 799),
    ]
    usd = plan_service.prices_for("pro", "USD")
    assert [(p.interval, p.amount) for p in usd] == [
        ("month", 4.99),
        ("year", 39),
    ]
    assert plan_service.prices_for("pro", "EUR") == []
    assert plan_service.prices_for("gold", "INR") == []


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("INR", "INR"),
        ("usd", "USD"),
        (" inr ", "INR"),
        ("EUR", None),
        ("", None),
        (None, None),
    ],
)
def test_normalize_currency(raw, expected):
    assert plan_service.normalize_currency(raw) == expected


@pytest.mark.parametrize(
    "profile",
    [None, {}, {"plan": None, "plan_status": None}, {"id": USER}],
)
def test_project_defaults_to_free_for_rows_without_plan(profile):
    assert plan_service.project(profile) == {
        "plan": "free",
        "plan_status": "none",
        "pro_activated_at": None,
        "pro_prompt_shown": False,
        "currency": None,
    }


def test_project_rejects_unknown_values():
    view = plan_service.project({"plan": "gold", "plan_status": "weird"})
    assert view["plan"] == "free"
    assert view["plan_status"] == "none"


def test_has_pro_access_follows_plan_and_status():
    assert plan_service.has_pro_access(None) is False
    assert plan_service.has_pro_access({"plan": "pro"}) is False
    assert (
        plan_service.has_pro_access(
            {"plan": "pro", "plan_status": "early_access"},
        )
        is True
    )
    assert (
        plan_service.has_pro_access({"plan": "pro", "plan_status": "active"})
        is True
    )
    assert (
        plan_service.has_pro_access({"plan": "pro", "plan_status": "expired"})
        is False
    )


# ---------------------------------------------------------- repository


class FakeSupabase:
    """One profile row in memory; records every write."""

    def __init__(self, row: dict[str, Any] | None) -> None:
        self.row = row
        self.writes: list[dict[str, Any]] = []

    def get_profile(self, user_id: str) -> dict[str, Any] | None:
        return (
            dict(self.row) if self.row and self.row["id"] == user_id else None
        )

    def upsert_profile(self, **kwargs: Any) -> dict[str, Any]:
        self.row = {"id": kwargs["user_id"], "email": kwargs["email"]}
        return dict(self.row)

    def update_profile_fields(
        self,
        user_id: str,
        fields: dict[str, Any],
    ) -> dict[str, Any] | None:
        assert self.row is not None
        assert self.row["id"] == user_id
        self.writes.append(dict(fields))
        self.row.update(fields)
        return dict(self.row)

    def verify_token(self, token: str) -> dict[str, Any] | None:
        if token == "jwt":  # noqa: S105
            return {"id": USER, "email": "s@example.com"}
        return None


@pytest.fixture
def user() -> SimpleNamespace:
    return SimpleNamespace(
        id=USER,
        email="s@example.com",
        full_name="S",
        avatar_url=None,
    )


@pytest.fixture
def fake(monkeypatch) -> FakeSupabase:
    fake = FakeSupabase({"id": USER, "email": "s@example.com"})
    monkeypatch.setattr(plan_repository, "SupabaseService", lambda: fake)
    return fake


def test_activate_marks_pro_early_access_and_prompt_shown(fake, user):
    res = plan_repository.PlanRepository.activate_early_access(user)
    data = res["data"]
    assert data["plan"] == "pro"
    assert data["plan_status"] == "early_access"
    assert data["pro_prompt_shown"] is True
    assert data["pro_activated_at"]
    assert data["currency"] is None
    assert fake.writes == [
        {
            "plan": "pro",
            "plan_status": "early_access",
            "pro_prompt_shown": True,
            "pro_activated_at": data["pro_activated_at"],
        },
    ]


def test_activate_records_the_quoted_currency_once(fake, user):
    first = plan_repository.PlanRepository.activate_early_access(user, "usd")
    assert first["data"]["currency"] == "USD"
    assert fake.writes[0]["currency"] == "USD"
    again = plan_repository.PlanRepository.activate_early_access(user, "INR")
    assert again["data"]["currency"] == "USD"
    assert "currency" not in fake.writes[1]


def test_activate_ignores_an_unknown_currency(fake, user):
    res = plan_repository.PlanRepository.activate_early_access(user, "EUR")
    assert res["data"]["currency"] is None
    assert "currency" not in fake.writes[0]


def test_activate_is_idempotent_and_keeps_first_activation_time(fake, user):
    first = plan_repository.PlanRepository.activate_early_access(user)
    again = plan_repository.PlanRepository.activate_early_access(user)
    assert (
        again["data"]["pro_activated_at"] == first["data"]["pro_activated_at"]
    )
    assert "pro_activated_at" not in fake.writes[1]


def test_activate_creates_the_profile_row_for_a_fresh_user(monkeypatch, user):
    fake = FakeSupabase(None)
    monkeypatch.setattr(plan_repository, "SupabaseService", lambda: fake)
    res = plan_repository.PlanRepository.activate_early_access(user)
    assert fake.row["id"] == USER
    assert res["data"]["plan"] == "pro"


def test_prompt_shown_only_touches_the_flag(fake, user):
    res = plan_repository.PlanRepository.mark_prompt_shown(user)
    assert res["data"] == {
        "plan": "free",
        "plan_status": "none",
        "pro_activated_at": None,
        "pro_prompt_shown": True,
        "currency": None,
    }
    assert fake.writes == [{"pro_prompt_shown": True}]


# ------------------------------------------------------------- endpoint


@pytest.fixture
def client(monkeypatch):
    """The plan blueprint on its own app, with the fake behind."""
    fake = FakeSupabase({"id": USER, "email": "s@example.com"})
    monkeypatch.setattr(plan_repository, "SupabaseService", lambda: fake)
    monkeypatch.setattr("aeva.common.decorators.SupabaseService", lambda: fake)

    app = Flask(__name__)
    app.config.update(
        API_TITLE="t",
        API_VERSION="v",
        OPENAPI_VERSION="3.0.3",
        TESTING=True,
    )
    api = Api(app)
    api.register_blueprint(plan_controller.blueprint)

    @app.errorhandler(CustomError)
    def _err(error):
        return jsonify({"code": error.code}), error.status

    test_client = app.test_client()
    test_client.fake = fake
    return test_client


def test_routes_need_a_signed_in_user(client):
    assert client.get("/plan/").status_code == 401
    assert client.post("/plan/activate-early-access").status_code == 401
    assert client.post("/plan/prompt-shown").status_code == 401


def test_get_then_activate_then_get(client):
    auth = {"Authorization": "Bearer jwt"}
    before = client.get("/plan/", headers=auth).get_json()["data"]
    assert before["plan"] == "free"

    activated = client.post(
        "/plan/activate-early-access",
        headers=auth,
        json={"currency": "USD"},
    ).get_json()["data"]
    assert activated["plan"] == "pro"
    assert activated["plan_status"] == "early_access"
    assert activated["currency"] == "USD"

    after = client.get("/plan/", headers=auth).get_json()["data"]
    assert after == activated


def test_activate_without_a_body_still_works(client):
    auth = {"Authorization": "Bearer jwt"}
    res = client.post("/plan/activate-early-access", headers=auth)
    assert res.status_code == 200
    assert res.get_json()["data"]["plan"] == "pro"
    assert res.get_json()["data"]["currency"] is None


def test_activate_with_an_empty_json_body_still_works(client):
    auth = {"Authorization": "Bearer jwt"}
    res = client.post(
        "/plan/activate-early-access",
        headers={**auth, "Content-Type": "application/json"},
    )
    assert res.status_code == 200


def test_activate_rejects_an_unsupported_currency(client):
    auth = {"Authorization": "Bearer jwt"}
    res = client.post(
        "/plan/activate-early-access",
        headers=auth,
        json={"currency": "EUR"},
    )
    assert res.status_code == 422


def test_prompt_shown_route(client):
    auth = {"Authorization": "Bearer jwt"}
    res = client.post("/plan/prompt-shown", headers=auth)
    assert res.status_code == 200
    assert res.get_json()["data"]["pro_prompt_shown"] is True
    assert client.fake.row["pro_prompt_shown"] is True


# ------------------------------------------------------ admin overrides


@pytest.fixture(autouse=True)
def _no_db_overrides(monkeypatch):
    """Every test sees the code catalog unless it installs overrides."""
    monkeypatch.setattr(plan_service, "_fetch_overrides", dict)
    plan_service.invalidate_cache()
    yield
    plan_service.invalidate_cache()


def test_apply_override_changes_prices_today_and_flag():
    pro = next(p for p in plan_service.PLAN_CATALOG if p.key == "pro")
    merged = plan_service.apply_override(
        pro,
        {
            "prices": [
                {"interval": "month", "currency": "INR", "amount": 149},
                {"interval": "year", "currency": "INR", "amount": 999},
                {"interval": "month", "currency": "USD", "amount": 5.99},
            ],
            "current_amount": 0,
            "early_access": False,
        },
    )
    assert {(p.currency, p.interval, p.amount) for p in merged.prices} == {
        ("INR", "month", 149.0),
        ("INR", "year", 999.0),
        ("USD", "month", 5.99),
    }
    assert merged.early_access is False
    assert merged.label == "Aeva Pro"


@pytest.mark.parametrize(
    "value",
    [
        None,
        {},
        {"prices": "nope", "current_amount": "x", "early_access": "yes"},
        {"prices": [{"interval": "week", "currency": "INR", "amount": 1}]},
        {"prices": [{"interval": "month", "currency": "EUR", "amount": 1}]},
        {"prices": [{"interval": "month", "currency": "INR", "amount": -1}]},
    ],
)
def test_apply_override_ignores_malformed_documents(value):
    pro = next(p for p in plan_service.PLAN_CATALOG if p.key == "pro")
    assert plan_service.apply_override(pro, value) == pro


def test_effective_catalog_merges_overrides_and_caches(monkeypatch):
    calls = []

    def fetch():
        calls.append(1)
        return {
            "pro": {
                "prices": [
                    {"interval": "month", "currency": "INR", "amount": 199}
                ]
            }
        }

    monkeypatch.setattr(plan_service, "_fetch_overrides", fetch)
    plan_service.invalidate_cache()
    first = plan_service.prices_for("pro", "INR")
    second = plan_service.prices_for("pro", "INR")
    assert [(p.interval, p.amount) for p in first] == [("month", 199.0)]
    assert second == first
    assert len(calls) == 1
    plan_service.invalidate_cache()
    plan_service.prices_for("pro", "INR")
    assert len(calls) == 2


def test_effective_catalog_fails_open_to_code_defaults(monkeypatch):
    def boom():
        raise RuntimeError("db down")

    monkeypatch.setattr(plan_service, "_fetch_overrides", boom)
    plan_service.invalidate_cache()
    assert [p.amount for p in plan_service.prices_for("pro", "INR")] == [
        99,
        799,
    ]


def test_prompt_knowledge_states_what_exists_and_what_does_not():
    text = plan_service.prompt_knowledge(list(plan_service.PLAN_CATALOG))
    assert "₹99/month or ₹799/year in India" in text
    assert "$4.99/month or $39/year elsewhere" in text
    assert "₹0 / $0 today" in text
    assert "Profile → Account → Plan" in text
    assert "Not available yet" in text
    assert "paid subscriptions" in text


def test_prompt_knowledge_follows_admin_overrides(monkeypatch):
    monkeypatch.setattr(
        plan_service,
        "_fetch_overrides",
        lambda: {
            "pro": {
                "prices": [
                    {"interval": "month", "currency": "INR", "amount": 149},
                    {"interval": "year", "currency": "INR", "amount": 1199},
                    {"interval": "month", "currency": "USD", "amount": 6},
                    {"interval": "year", "currency": "USD", "amount": 49},
                ]
            }
        },
    )
    plan_service.invalidate_cache()
    text = plan_service.prompt_knowledge()
    assert "₹149/month or ₹1199/year" in text
    assert "$6/month or $49/year" in text


def test_product_info_template_renders_plan_section():
    from aeva.llm import prompts

    live = prompts.PromptBuilder.build(
        prompts.PRODUCT_INFO_TEMPLATE,
        USER_MESSAGE="is aeva free?",
        USER_PROFILE="",
        PLAN_KNOWLEDGE=plan_service.prompt_knowledge(),
    )
    assert "Plan & pricing (Aeva Pro)" in live.user_message
    assert "₹99/month" in live.user_message
    # Optional: a caller that omits it gets the rest of the knowledge intact.
    without = prompts.PromptBuilder.build(
        prompts.PRODUCT_INFO_TEMPLATE,
        USER_MESSAGE="is aeva free?",
        USER_PROFILE="",
    )
    assert "Study Material" in without.user_message
    assert "Plan & pricing" not in without.user_message


# ----------------------------------------------------------- admin routes

ADMIN_SECRET = "s" * 32


class FakeOverridesTable:
    """In-memory ``plan_overrides`` for the admin repository."""

    def __init__(self) -> None:
        self.rows: dict[str, dict[str, Any]] = {}
        self._pending_delete: str | None = None

    # supabase-py style chain -----------------------------------------
    def select(self, *_cols: str) -> FakeOverridesTable:
        return self

    def upsert(self, row: dict[str, Any]) -> FakeOverridesTable:
        self.rows[row["plan_key"]] = dict(row)
        return self

    def delete(self) -> FakeOverridesTable:
        return self

    def eq(self, _col: str, key: str) -> FakeOverridesTable:
        self._pending_delete = key
        return self

    def execute(self) -> SimpleNamespace:
        if self._pending_delete is not None:
            self.rows.pop(self._pending_delete, None)
            self._pending_delete = None
        return SimpleNamespace(data=list(self.rows.values()))


@pytest.fixture
def admin_client(monkeypatch):
    """The admin blueprint with a fake ``plan_overrides`` table behind it."""
    import jwt

    from aeva.admin import admin_controller

    table = FakeOverridesTable()

    class FakeClient:
        def table(self, name: str) -> FakeOverridesTable:
            assert name in {"plan_overrides", "admin_audit_log"}
            return table if name == "plan_overrides" else FakeAudit()

    class FakeAudit:
        def insert(self, _row: dict[str, Any]) -> FakeAudit:
            return self

        def execute(self) -> SimpleNamespace:
            return SimpleNamespace(data=[])

    class FakeSupabase:
        client = FakeClient()

    monkeypatch.setattr(
        "aeva.supabase.supabase_service.SupabaseService", lambda: FakeSupabase()
    )
    monkeypatch.setattr(admin_controller.repo, "_supabase", FakeSupabase())
    # The public catalog reads the same fake table (the autouse stub above
    # would otherwise hide the override from prices_for / prompt_knowledge).
    monkeypatch.setattr(
        plan_service,
        "_fetch_overrides",
        lambda: {k: r["value"] for k, r in table.rows.items()},
    )
    plan_service.invalidate_cache()

    app = Flask(__name__)
    app.config.update(
        TESTING=True,
        API_TITLE="t",
        API_VERSION="v",
        OPENAPI_VERSION="3.0.3",
        ADMIN_USERNAME="root",
        ADMIN_PASSWORD="pw",  # noqa: S106
        ADMIN_JWT_SECRET=ADMIN_SECRET,
        ADMIN_PERMISSIONS="*",
    )
    api = Api(app)
    api.register_blueprint(admin_controller.blueprint)

    @app.errorhandler(CustomError)
    def _err(error):
        return jsonify({"code": error.code}), error.status

    def auth(perms: list[str] | None = None) -> dict[str, str]:
        tok = jwt.encode(
            {
                "sub": "root",
                "role": "admin",
                "perms": perms or ["*"],
                "exp": 4102444800,
            },
            ADMIN_SECRET,
            algorithm="HS256",
        )
        return {"Authorization": f"Bearer {tok}"}

    client = app.test_client()
    client.auth = auth
    client.table = table
    return client


VALID_BODY = {
    "prices": [
        {"interval": "month", "currency": "INR", "amount": 149},
        {"interval": "year", "currency": "INR", "amount": 1199},
        {"interval": "month", "currency": "USD", "amount": 5.99},
        {"interval": "year", "currency": "USD", "amount": 49},
    ],
    "current_amount": 0,
    "early_access": True,
}


def test_admin_plans_need_a_token(admin_client):
    assert admin_client.get("/admin/plans").status_code == 401
    assert (
        admin_client.put("/admin/plans/pro", json=VALID_BODY).status_code == 401
    )


def test_admin_plans_lists_defaults_then_overrides(admin_client):
    before = admin_client.get("/admin/plans", headers=admin_client.auth())
    assert before.status_code == 200
    plans = {p["key"]: p for p in before.get_json()["data"]["plans"]}
    assert set(plans) == {"free", "pro"}
    assert plans["pro"]["updated_at"] is None
    assert plans["pro"]["default"]["prices"][0]["amount"] == 99

    saved = admin_client.put(
        "/admin/plans/pro", headers=admin_client.auth(), json=VALID_BODY
    )
    assert saved.status_code == 200
    assert saved.get_json()["data"]["prices"][0]["amount"] == 149

    after = admin_client.get("/admin/plans", headers=admin_client.auth())
    pro = {p["key"]: p for p in after.get_json()["data"]["plans"]}["pro"]
    assert pro["updated_by"] == "root"
    assert pro["updated_at"]
    assert {
        (p["currency"], p["interval"], p["amount"]) for p in pro["prices"]
    } == {
        ("INR", "month", 149.0),
        ("INR", "year", 1199.0),
        ("USD", "month", 5.99),
        ("USD", "year", 49.0),
    }
    # The public catalog and the prompt follow the override (cache busted).
    assert [p.amount for p in plan_service.prices_for("pro", "INR")] == [
        149.0,
        1199.0,
    ]
    assert "₹149/month" in plan_service.prompt_knowledge()


def test_admin_plan_reset_returns_to_code_default(admin_client):
    admin_client.put(
        "/admin/plans/pro", headers=admin_client.auth(), json=VALID_BODY
    )
    reset = admin_client.delete("/admin/plans/pro", headers=admin_client.auth())
    assert reset.status_code == 200
    assert admin_client.table.rows == {}
    assert [p.amount for p in plan_service.prices_for("pro", "INR")] == [
        99,
        799,
    ]


def test_admin_plan_rejects_bad_bodies_and_unknown_keys(admin_client):
    auth = admin_client.auth()
    dup = {
        **VALID_BODY,
        "prices": [
            {"interval": "month", "currency": "INR", "amount": 1},
            {"interval": "month", "currency": "INR", "amount": 2},
        ],
    }
    assert (
        admin_client.put("/admin/plans/pro", headers=auth, json=dup).status_code
        == 422
    )
    bad_currency = {
        **VALID_BODY,
        "prices": [{"interval": "month", "currency": "EUR", "amount": 1}],
    }
    assert (
        admin_client.put(
            "/admin/plans/pro", headers=auth, json=bad_currency
        ).status_code
        == 422
    )
    negative = {**VALID_BODY, "current_amount": -1}
    assert (
        admin_client.put(
            "/admin/plans/pro", headers=auth, json=negative
        ).status_code
        == 422
    )
    assert (
        admin_client.put(
            "/admin/plans/gold", headers=auth, json=VALID_BODY
        ).status_code
        == 404
    )


def test_admin_plan_write_needs_manage_plans_permission(admin_client):
    viewer = admin_client.auth(["VIEW_USERS"])
    assert admin_client.get("/admin/plans", headers=viewer).status_code == 200
    denied = admin_client.put(
        "/admin/plans/pro", headers=viewer, json=VALID_BODY
    )
    # check_permission answers with ADMIN_UNAUTHORIZED (401) like every
    # other admin permission gate.
    assert denied.status_code == 401
    assert denied.get_json()["code"] == "ADMIN_UNAUTHORIZED"
    manager = admin_client.auth(["MANAGE_PLANS"])
    assert (
        admin_client.put(
            "/admin/plans/pro", headers=manager, json=VALID_BODY
        ).status_code
        == 200
    )
