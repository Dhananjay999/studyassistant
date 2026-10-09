"""Answer feedback: ``POST /chat/messages/<id>/feedback``.

``MessageFeedbackRepository`` over a fake Supabase client (ownership is
checked through the message's session; the rating is merged into the
existing ``metadata`` and cleared with ``rating: null``), plus the blueprint
registered on its own Flask app: URL rule, validation and auth.
"""

from types import SimpleNamespace

import pytest
from flask import Flask, jsonify
from flask_smorest import Api

from aeva.chat import feedback_controller
from aeva.chat.feedback_repository import (
    FEEDBACK_KEY,
    MessageFeedbackRepository,
)
from aeva.chat.schema.feedback_schema import (
    MessageFeedbackData,
    MessageFeedbackSchema,
)
from aeva.common.errors import CustomError
from aeva.common.schema import UserData

USER = UserData(id="33333333-3333-4333-8333-333333333333", email="s@x.io")
MSG = "44444444-4444-4444-8444-444444444444"


class FakeQuery:
    """Records select/update builder calls on the ``messages`` table."""

    def __init__(self, client):
        self.client = client
        self.op = None
        self.payload = None
        self.filters = []

    def select(self, columns):
        self.op = ("select", columns)
        return self

    def update(self, payload):
        self.op = ("update",)
        self.payload = payload
        return self

    def eq(self, column, value):
        self.filters.append((column, value))
        return self

    def limit(self, _n):
        return self

    def execute(self):
        self.client.calls.append(self)
        if self.op[0] == "select":
            return SimpleNamespace(data=self.client.rows)
        self.client.updated = self.payload
        return SimpleNamespace(data=[{"id": MSG}])


class FakeClient:
    def __init__(self, rows):
        self.rows = rows
        self.calls = []
        self.updated = None

    def table(self, name):
        assert name == "messages"
        return FakeQuery(self)


def repo_call(rows, rating="up", reason=None, message_id=MSG):
    client = FakeClient(rows)
    result = MessageFeedbackRepository.set_feedback(
        USER,
        message_id,
        MessageFeedbackData(rating=rating, reason=reason),
        supabase=SimpleNamespace(client=client),
    )
    return result, client


def assistant_row(metadata=None):
    return {
        "id": MSG,
        "role": "assistant",
        "metadata": metadata if metadata is not None else {"tool_used": "general"},
        "sessions": {"user_id": USER.id},
    }


class TestRepository:
    def test_rating_is_merged_into_existing_metadata(self):
        result, client = repo_call([assistant_row()], rating="down", reason="wrong")
        assert result["data"] == {"message_id": MSG, "rating": "down"}
        select, update = client.calls
        # Ownership goes through the session join, scoped to this user.
        assert "sessions!inner(user_id)" in select.op[1]
        assert ("sessions.user_id", USER.id) in select.filters
        assert ("id", MSG) in select.filters
        assert ("id", MSG) in update.filters
        meta = client.updated["metadata"]
        assert meta["tool_used"] == "general"  # untouched
        assert meta[FEEDBACK_KEY]["rating"] == "down"
        assert meta[FEEDBACK_KEY]["reason"] == "wrong"
        assert meta[FEEDBACK_KEY]["updated_at"]

    def test_null_rating_clears_the_entry(self):
        existing = {"tool_used": "general", FEEDBACK_KEY: {"rating": "up"}}
        result, client = repo_call([assistant_row(existing)], rating=None)
        assert result["data"]["rating"] is None
        assert FEEDBACK_KEY not in client.updated["metadata"]
        assert client.updated["metadata"]["tool_used"] == "general"

    def test_placeholder_id_is_rejected_without_a_query(self):
        client = FakeClient([assistant_row()])
        with pytest.raises(CustomError) as exc:
            MessageFeedbackRepository.set_feedback(
                USER,
                "stream-d6485ea4-792e-4d0d-9c14-32a7ed5cd189",
                MessageFeedbackData(rating="up"),
                supabase=SimpleNamespace(client=client),
            )
        assert exc.value.status == 400
        assert client.calls == []

    def test_someone_elses_or_missing_message_is_not_found(self):
        with pytest.raises(CustomError) as exc:
            repo_call([])
        assert exc.value.status == 404

    def test_user_messages_cannot_be_rated(self):
        row = assistant_row()
        row["role"] = "user"
        with pytest.raises(CustomError) as exc:
            repo_call([row])
        assert exc.value.status == 400


class TestSchema:
    def test_accepts_up_down_and_null(self):
        for rating in ("up", "down", None):
            data = MessageFeedbackSchema().load({"rating": rating})
            assert data.rating == rating

    def test_rejects_other_ratings(self):
        from marshmallow import ValidationError

        with pytest.raises(ValidationError):
            MessageFeedbackSchema().load({"rating": "meh"})


@pytest.fixture
def app():
    flask_app = Flask(__name__)
    flask_app.config.update(
        TESTING=True, API_TITLE="t", API_VERSION="1", OPENAPI_VERSION="3.0.2"
    )

    @flask_app.errorhandler(CustomError)
    def handle(error):  # mirrors aeva.app's handler
        return jsonify({"msg": error.message, "code": error.code}), error.status

    Api(flask_app).register_blueprint(feedback_controller.blueprint)
    return flask_app


class TestRoute:
    def test_rule_is_registered_under_chat(self, app):
        rules = {r.rule for r in app.url_map.iter_rules()}
        assert "/chat/messages/<message_id>/feedback" in rules

    def test_registered_in_the_app_factory(self):
        from pathlib import Path

        source = (
            Path(feedback_controller.__file__).resolve().parents[1] / "app.py"
        ).read_text()
        assert "api.register_blueprint(chat_feedback_bp)" in source

    def test_requires_a_bearer_token(self, app):
        res = app.test_client().post(
            f"/chat/messages/{MSG}/feedback", json={"rating": "up"}
        )
        assert res.status_code == 401

    def test_invalid_rating_is_a_422_before_auth_runs(self, app):
        res = app.test_client().post(
            f"/chat/messages/{MSG}/feedback", json={"rating": "meh"}
        )
        assert res.status_code == 422

    def test_authenticated_call_reaches_the_repository(self, app, monkeypatch):
        seen = {}

        def fake_set_feedback(current_user, message_id, data, supabase=None):
            seen.update(user=current_user.id, message_id=message_id, data=data)
            return {"msg": "ok", "data": {"message_id": message_id, "rating": data.rating}}

        monkeypatch.setattr(
            feedback_controller.MessageFeedbackRepository,
            "set_feedback",
            staticmethod(fake_set_feedback),
        )
        monkeypatch.setattr(
            "aeva.common.decorators.SupabaseService.verify_token",
            lambda self, token: {"id": USER.id, "email": USER.email},
        )
        res = app.test_client().post(
            f"/chat/messages/{MSG}/feedback",
            json={"rating": "down"},
            headers={"Authorization": "Bearer token"},
        )
        assert res.status_code == 200
        assert res.get_json()["data"] == {"message_id": MSG, "rating": "down"}
        assert seen["user"] == USER.id
        assert seen["message_id"] == MSG
        assert seen["data"].rating == "down"
