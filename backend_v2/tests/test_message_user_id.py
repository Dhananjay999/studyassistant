"""``messages.user_id`` on insert, behind ``MESSAGES_USER_ID_ENABLED``.

The column arrives with migration 036 PART 1. Until it exists PostgREST
rejects an insert that names it, so ``SupabaseService.add_message`` sends
``user_id`` only when the flag is on (default off) and an owner was passed.
"""

from types import SimpleNamespace

import pytest
from flask import Flask

from aeva.app import load_env_vars
from aeva.supabase.supabase_service import SupabaseService

USER = "33333333-3333-4333-8333-333333333333"
SESSION = "55555555-5555-4555-8555-555555555555"


class FakeTable:
    def __init__(self, client):
        self.client = client

    def insert(self, row):
        self.client.inserted.append(row)
        return self

    def execute(self):
        return SimpleNamespace(data=[{"id": "m1", **self.client.inserted[-1]}])


class FakeClient:
    def __init__(self):
        self.inserted = []
        self.tables = []

    def table(self, name):
        self.tables.append(name)
        return FakeTable(self)


@pytest.fixture
def client(monkeypatch):
    # The real client lives in class-level thread-local storage.
    fake = FakeClient()
    monkeypatch.setattr(
        SupabaseService, "_local", SimpleNamespace(client=fake)
    )
    return fake


@pytest.fixture
def service(client):
    return SupabaseService()


def _app(**config):
    app = Flask(__name__)
    app.config.update(**config)
    return app


def test_user_id_is_omitted_when_the_flag_is_off(service, client):
    with _app(MESSAGES_USER_ID_ENABLED=False).app_context():
        row = service.add_message(SESSION, "user", "hi", user_id=USER)
    assert client.tables == ["messages"]
    assert client.inserted == [
        {"session_id": SESSION, "role": "user", "content": "hi", "metadata": {}}
    ]
    assert "user_id" not in row


def test_user_id_is_omitted_when_the_flag_is_not_configured(service, client):
    with _app().app_context():
        service.add_message(SESSION, "assistant", "hello", user_id=USER)
    assert "user_id" not in client.inserted[0]


def test_user_id_is_written_when_the_flag_is_on(service, client):
    with _app(MESSAGES_USER_ID_ENABLED=True).app_context():
        row = service.add_message(
            SESSION, "assistant", "hello", {"status": "completed"}, user_id=USER
        )
    assert client.inserted == [
        {
            "session_id": SESSION,
            "role": "assistant",
            "content": "hello",
            "metadata": {"status": "completed"},
            "user_id": USER,
        }
    ]
    assert row["user_id"] == USER


def test_no_owner_means_no_column_even_with_the_flag_on(service, client):
    with _app(MESSAGES_USER_ID_ENABLED=True).app_context():
        service.add_message(SESSION, "user", "hi")
    assert "user_id" not in client.inserted[0]


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("", False),
        ("0", False),
        ("false", False),
        ("1", True),
        ("true", True),
        ("YES", True),
        ("on", True),
    ],
)
def test_app_config_reads_the_env_flag(monkeypatch, value, expected):
    # Set (never unset) the variable: load_dotenv does not override it.
    monkeypatch.setenv("MESSAGES_USER_ID_ENABLED", value)
    app = Flask(__name__)
    load_env_vars(app)
    assert app.config["MESSAGES_USER_ID_ENABLED"] is expected
