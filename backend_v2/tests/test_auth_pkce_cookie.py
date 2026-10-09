"""PKCE verifier cookie across repeated sign-in starts.

``/auth/login/google`` used to mint a new verifier on every hit, so a double
tap (two ``/authorize`` flows, one cookie) left the first callback with a
verifier that did not match its code. The verifier of a flow in progress is
now reused; a plain single start still gets a fresh one.
"""

import base64
import hashlib
from http.cookies import SimpleCookie
from urllib.parse import parse_qs, urlparse

import pytest
from flask import Flask, jsonify
from flask_smorest import Api

from aeva.auth import auth_controller
from aeva.auth.auth_controller import PKCE_COOKIE, _pkce_for_request
from aeva.common.errors import CustomError
from aeva.supabase.supabase_service import SupabaseService

FRONTEND = "https://app.example.test"


def s256(verifier):
    digest = hashlib.sha256(verifier.encode()).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


@pytest.fixture(scope="module")
def app():
    flask_app = Flask(__name__)
    flask_app.config.update(
        TESTING=True,
        API_TITLE="test",
        API_VERSION="1",
        OPENAPI_VERSION="3.0.2",
        SUPABASE_URL="https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY="service-role",
        FRONTEND_URL=FRONTEND,
        COOKIE_SECURE=False,
        PKCE_COOKIE_MAX_AGE_SECONDS=600,
    )

    @flask_app.errorhandler(CustomError)
    def handle(error):  # mirrors aeva.app's handler
        return jsonify({"msg": error.message, "code": error.code}), error.status

    Api(flask_app).register_blueprint(auth_controller.blueprint)
    return flask_app


@pytest.fixture
def client(app):
    return app.test_client()


def start(client, cookie=None):
    """GET /auth/login/google; return (verifier cookie, code_challenge)."""
    if cookie is not None:
        client.set_cookie(PKCE_COOKIE, cookie, domain="localhost")
    response = client.get("/auth/login/google")
    assert response.status_code == 302
    challenge = parse_qs(urlparse(response.headers["Location"]).query)[
        "code_challenge"
    ][0]
    jar = SimpleCookie()
    for header in response.headers.getlist("Set-Cookie"):
        jar.load(header)
    morsel = jar[PKCE_COOKIE]
    return morsel.value, challenge, morsel


class TestLoginStart:
    def test_single_start_gets_a_fresh_verifier_and_matching_challenge(
        self, client
    ):
        verifier, challenge, morsel = start(client)
        assert len(verifier) == 43
        assert challenge == s256(verifier)
        assert morsel["httponly"]
        assert morsel["samesite"] == "Lax"
        assert morsel["max-age"] == "600"

    def test_two_starts_without_a_cookie_differ(self, app):
        first = start(app.test_client())[0]
        second = start(app.test_client())[0]
        assert first != second

    def test_second_start_during_a_flow_keeps_the_first_verifier(self, client):
        first, first_challenge, _ = start(client)
        # The browser sends the cookie back on the second tap.
        second, second_challenge, _ = start(client, cookie=first)
        assert second == first
        assert second_challenge == first_challenge == s256(first)

    def test_a_cookie_that_is_not_ours_is_replaced(self, client):
        verifier, challenge, _ = start(client, cookie="tampered value!!")
        assert verifier != "tampered value!!"
        assert len(verifier) == 43
        assert challenge == s256(verifier)

    @pytest.mark.parametrize("existing", [None, "", "short", "x" * 44])
    def test_pkce_for_request_ignores_unusable_cookies(self, existing):
        verifier, challenge = _pkce_for_request(existing)
        assert verifier != existing
        assert challenge == s256(verifier)


class TestCallback:
    def test_exchange_uses_the_cookie_verifier_and_clears_it(
        self, client, monkeypatch
    ):
        seen = {}

        def fake_exchange(self, code, code_verifier):
            seen["code"] = code
            seen["verifier"] = code_verifier
            return {
                "access_token": "at",
                "refresh_token": "rt",
                "expires_in": 3600,
            }

        monkeypatch.setattr(SupabaseService, "exchange_code", fake_exchange)
        verifier, _, _ = start(client)
        # The second start of a double tap must not change what the first
        # flow's callback exchanges with.
        start(client, cookie=verifier)

        response = client.get("/auth/callback?code=abc")
        assert response.status_code == 302
        assert seen == {"code": "abc", "verifier": verifier}
        assert response.headers["Location"].startswith(
            f"{FRONTEND}/auth/callback#access_token=at&refresh_token=rt"
        )
        cleared = [
            h
            for h in response.headers.getlist("Set-Cookie")
            if h.startswith(f"{PKCE_COOKIE}=")
        ]
        assert cleared
        assert "Max-Age=0" in cleared[0]

    def test_missing_cookie_is_reported_to_the_frontend(self, app):
        response = app.test_client().get("/auth/callback?code=abc")
        assert response.status_code == 302
        assert response.headers["Location"] == (
            f"{FRONTEND}/auth/callback?auth_error=missing_code"
        )
