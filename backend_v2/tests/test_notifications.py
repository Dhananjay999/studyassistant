"""Return hook: what counts as "waiting" for the chat strip.

``DigestService`` over a fake repository (no Supabase): the revision rule
it shares with the dashboard, the shape of the pending payload, the feature
flags, the off switch and the degrade path, plus the pending endpoint and
the one RPC the repository makes.
"""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from flask import Flask, jsonify
from flask_smorest import Api

from aeva.common.errors import CustomError
from aeva.feature_flag import feature_flag_service
from aeva.notifications import config as ncfg
from aeva.notifications import notification_controller
from aeva.notifications.config import NotificationSettings
from aeva.notifications.digest_service import DigestService, digest_from_row
from aeva.notifications.notification_repository import NotificationRepository
from aeva.revision import revision_engine as engine
from aeva.revision.revision_engine import RevisionConfig

NOW = datetime(2026, 10, 9, 6, 0, tzinfo=UTC)
TODAY = NOW.date()
U1 = "11111111-1111-4111-8111-111111111111"
U2 = "22222222-2222-4222-8222-222222222222"
U3 = "33333333-3333-4333-8333-333333333333"
DAY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
PLAN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
QUIZ = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
SET = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
ON = NotificationSettings(enabled=True)


def row(user_id, **over):
    """A ``notification_digest_counts`` row with nothing waiting."""
    base = {
        "user_id": user_id,
        "revision_due": 0,
        "plan_id": None,
        "plan_day_id": None,
        "plan_day_number": None,
        "plan_total_days": None,
        "plan_topics_open": 0,
        "quizzes_waiting": 0,
        "quiz_id": None,
        "sets_waiting": 0,
        "set_id": None,
    }
    return {**base, **over}


FULL = {
    "revision_due": 3,
    "plan_id": PLAN,
    "plan_day_id": DAY,
    "plan_day_number": 4,
    "plan_total_days": 14,
    "plan_topics_open": 4,
    "quizzes_waiting": 2,
    "quiz_id": QUIZ,
    "sets_waiting": 1,
    "set_id": SET,
}


class FakeRepo:
    """In-memory stand-in for NotificationRepository (records every call)."""

    def __init__(self, rows=None):
        self.rows = {r["user_id"]: r for r in rows or []}
        self.calls = []
        self.count_args = []
        self.fail_counts = False

    def digest_counts(self, user_ids, **window):
        self.calls.append("digest_counts")
        self.count_args.append((list(user_ids), window))
        if self.fail_counts:
            raise RuntimeError("function notification_digest_counts missing")
        return [self.rows[u] for u in user_ids if u in self.rows]


@pytest.fixture(autouse=True)
def flags(monkeypatch):
    """Both gated features on unless a test says otherwise."""
    state = {"exam_prep": True, "revision_mode": True}
    monkeypatch.setattr(feature_flag_service, "get_flags", lambda: state)
    return state


def service(repo, settings=ON):
    return DigestService(
        repo=repo, settings=settings, revision_config=RevisionConfig()
    )


# ------------------------------------------------------- revision rule


def test_due_window_counts_exactly_what_the_dashboard_counts():
    """is_due / due_window are the same rule as bucketize's due buckets."""
    cfg = RevisionConfig()

    def item(i, due, status="reviewing", updated=None, score=None):
        return {
            "id": str(i),
            "topic": f"t{i}",
            "status": status,
            "strength": 1,
            "due_at": due.isoformat() if due else None,
            "updated_at": (updated or NOW - timedelta(days=40)).isoformat(),
            "last_quiz_score": score,
        }

    items = [
        item(1, NOW - timedelta(days=5)),  # overdue, urgent
        item(2, NOW - timedelta(hours=7), score=40),  # overdue, weak
        item(3, NOW - timedelta(hours=7)),  # overdue yesterday, not urgent
        item(4, NOW + timedelta(hours=3)),  # due later today
        item(5, NOW + timedelta(days=1, hours=1)),  # tomorrow
        item(6, None),  # no schedule
        # Mastered a day ago: "recently mastered", not due, even if overdue.
        item(7, NOW - timedelta(days=1), "mastered", NOW - timedelta(days=1)),
        # Mastered long ago and due again: due.
        item(8, NOW - timedelta(days=1), "mastered", NOW - timedelta(days=30)),
        # Exactly on the recently-mastered boundary.
        item(
            9,
            NOW - timedelta(days=1),
            "mastered",
            NOW - timedelta(days=cfg.mastered_recent_days, hours=23),
        ),
        item(
            10,
            NOW - timedelta(days=1),
            "mastered",
            NOW - timedelta(days=cfg.mastered_recent_days + 1, minutes=1),
        ),
    ]
    due_by_offset = {}
    for offset in (0, 330, -480):
        buckets = engine.bucketize(items, cfg, NOW, offset)
        expected = {
            i["id"] for i in (*buckets["needs_revision"], *buckets["due_today"])
        }
        window = engine.due_window(cfg, NOW, offset)
        assert {i["id"] for i in items if engine.is_due(i, window)} == expected
        due_by_offset[offset] = expected
    assert due_by_offset[0] == {"1", "2", "3", "4", "8", "10"}
    # UTC-8: the local day ends at 08:00 UTC, before item 4 falls due.
    assert due_by_offset[-480] == {"1", "2", "3", "8", "10"}


# --------------------------------------------------------- computation


def test_digest_row_becomes_items_in_display_order():
    digest = digest_from_row(
        row(U1, **FULL), plan_enabled=True, revision_enabled=True
    )
    assert digest.kinds == ["plan", "revision", "quiz", "flashcards"]
    plan, revision, quiz, cards = digest.items
    assert (plan.count, plan.target_id, plan.day_number) == (4, DAY, 4)
    assert revision.count == 3
    assert (quiz.count, quiz.target_id) == (2, QUIZ)
    assert (cards.count, cards.target_id) == (1, SET)


def test_api_shape_has_ids_and_counts_but_no_titles():
    digest = digest_from_row(
        row(U1, **FULL), plan_enabled=True, revision_enabled=True
    )
    api = [item.to_api() for item in digest.items]
    assert api == [
        {
            "kind": "plan",
            "count": 4,
            "plan_id": PLAN,
            "day_id": DAY,
            "day_number": 4,
            "total_days": 14,
        },
        {"kind": "revision", "count": 3},
        {"kind": "quiz", "count": 2, "quiz_id": QUIZ},
        {"kind": "flashcards", "count": 1, "set_id": SET},
    ]


def test_disabled_features_drop_their_items():
    digest = digest_from_row(
        row(U1, **FULL), plan_enabled=False, revision_enabled=False
    )
    assert digest.kinds == ["quiz", "flashcards"]
    only_plan = row(U1, plan_day_id=DAY, plan_topics_open=2)
    assert (
        digest_from_row(only_plan, plan_enabled=False, revision_enabled=True)
        is None
    )


def test_a_finished_plan_day_and_empty_rows_are_not_waiting():
    done = row(U1, plan_day_id=DAY, plan_topics_open=0)
    assert (
        digest_from_row(done, plan_enabled=True, revision_enabled=True) is None
    )
    assert (
        digest_from_row(row(U1), plan_enabled=True, revision_enabled=True)
        is None
    )


def test_digests_for_passes_the_engine_window_and_reads_flags(flags):
    repo = FakeRepo(rows=[row(U1, **FULL), row(U2, revision_due=2)])
    flags["exam_prep"] = False
    digests = service(repo).digests_for(
        [U1, U2, U3], now=NOW, tz_offset_minutes=330
    )

    assert set(digests) == {U1, U2}
    assert digests[U1].kinds == ["revision", "quiz", "flashcards"]
    assert repo.calls == ["digest_counts"]  # one grouped query for 3 users
    ids, window = repo.count_args[0]
    assert ids == [U1, U2, U3]
    expected = engine.due_window(RevisionConfig(), NOW, 330)
    assert window["due_before"] == expected.due_before
    assert window["mastered_after"] == expected.mastered_after
    assert window["today"] == TODAY
    assert window["since"] == NOW - timedelta(days=ncfg.LOOKBACK_DAYS)
    assert window["until"] == NOW - timedelta(minutes=ncfg.SETTLE_MINUTES)


def test_pending_for_user_returns_counts():
    repo = FakeRepo(rows=[row(U1, revision_due=5)])
    data = service(repo).pending_for_user(U1, 330)
    assert data == {
        "enabled": True,
        "items": [{"kind": "revision", "count": 5}],
    }
    assert service(repo).pending_for_user(U2) == {"enabled": True, "items": []}


def test_pending_is_empty_and_reads_nothing_when_the_hook_is_off():
    repo = FakeRepo(rows=[row(U1, revision_due=5)])
    off = NotificationSettings(enabled=False)
    assert service(repo, settings=off).pending_for_user(U1) == {
        "enabled": False,
        "items": [],
    }
    assert repo.calls == []


def test_pending_degrades_when_the_migration_is_missing():
    repo = FakeRepo()
    repo.fail_counts = True
    assert service(repo).pending_for_user(U1) == {"enabled": True, "items": []}


def test_settings_from_env(monkeypatch):
    monkeypatch.delenv("NOTIFICATIONS_ENABLED", raising=False)
    assert NotificationSettings.from_env() == NotificationSettings()
    assert NotificationSettings.from_env().enabled is False

    monkeypatch.setenv("NOTIFICATIONS_ENABLED", "true")
    assert NotificationSettings.from_env().enabled is True
    monkeypatch.setenv("NOTIFICATIONS_ENABLED", "0")
    assert NotificationSettings.from_env().enabled is False


# ------------------------------------------------------------- endpoint


@pytest.fixture
def client(monkeypatch):
    """The notification blueprint on its own app, with fakes behind."""
    monkeypatch.setenv("NOTIFICATIONS_ENABLED", "true")
    state = SimpleNamespace(pending=[])

    class StubService:
        def pending_for_user(self, user_id, tz_offset_minutes=0):
            state.pending.append((user_id, tz_offset_minutes))
            return {
                "enabled": True,
                "items": [{"kind": "revision", "count": 2}],
            }

    class StubSupabase:
        def verify_token(self, token):
            return (
                {"id": U1, "email": "s@example.com"} if token == "jwt" else None  # noqa: S105
            )

    monkeypatch.setattr(notification_controller, "DigestService", StubService)
    monkeypatch.setattr("aeva.common.decorators.SupabaseService", StubSupabase)

    app = Flask(__name__)
    app.config.update(
        API_TITLE="t",
        API_VERSION="v",
        OPENAPI_VERSION="3.0.3",
        TESTING=True,
    )
    api = Api(app)
    api.register_blueprint(notification_controller.blueprint)

    @app.errorhandler(CustomError)
    def _err(error):
        return jsonify({"code": error.code}), error.status

    test_client = app.test_client()
    test_client.state = state
    return test_client


def test_pending_endpoint_needs_a_signed_in_user(client):
    assert client.get("/notifications/pending").status_code == 401
    ok = client.get(
        "/notifications/pending?tz_offset_minutes=330",
        headers={"Authorization": "Bearer jwt"},
    )
    assert ok.status_code == 200
    assert ok.get_json()["data"]["items"] == [{"kind": "revision", "count": 2}]
    assert client.state.pending == [(U1, 330)]


# ----------------------------------------------------------- repository


class FakeQuery:
    """Records PostgREST builder calls; returns the client's canned data."""

    def __init__(self, client, table):
        self.client = client
        self.ops = [("table", table)]

    def __getattr__(self, name):
        def call(*args, **kwargs):
            self.ops.append((name, args, kwargs))
            return self

        return call

    def execute(self):
        self.client.queries.append(self.ops)
        return SimpleNamespace(data=self.client.data)


class FakeClient:
    def __init__(self, data=None):
        self.data = data or []
        self.queries = []

    def table(self, name):
        return FakeQuery(self, name)

    def rpc(self, name, params):
        query = FakeQuery(self, f"rpc:{name}")
        query.ops.append(("params", params))
        return query


def repo_over(client):
    return NotificationRepository(SimpleNamespace(client=client))


def test_counts_rpc_gets_iso_arguments_and_empty_input_reads_nothing():
    client = FakeClient([row(U1, revision_due=1)])
    repo = repo_over(client)
    window = engine.due_window(RevisionConfig(), NOW)
    rows = repo.digest_counts(
        [U1],
        today=TODAY,
        due_before=window.due_before,
        mastered_after=window.mastered_after,
        since=NOW - timedelta(days=14),
        until=NOW - timedelta(minutes=30),
    )
    assert rows == client.data
    assert client.queries[0][0] == ("table", "rpc:notification_digest_counts")
    params = client.queries[0][1][1]
    assert params["p_user_ids"] == [U1]
    assert params["p_today"] == "2026-10-09"
    assert params["p_due_before"] == "2026-10-10T00:00:00+00:00"

    empty = FakeClient()
    quiet = repo_over(empty)
    assert (
        quiet.digest_counts(
            [],
            today=TODAY,
            due_before=NOW,
            mastered_after=NOW,
            since=NOW,
            until=NOW,
        )
        == []
    )
    assert empty.queries == []


def test_the_hook_has_no_email_or_cron_surface():
    """The return hook is the in-app strip only: one read route."""
    assert not hasattr(notification_controller, "internal_blueprint")
    app = Flask(__name__)
    app.config.update(API_TITLE="t", API_VERSION="v", OPENAPI_VERSION="3.0.3")
    Api(app).register_blueprint(notification_controller.blueprint)
    rules = sorted(
        str(rule)
        for rule in app.url_map.iter_rules()
        if str(rule).startswith(("/notifications", "/internal"))
    )
    assert rules == ["/notifications/pending"]
