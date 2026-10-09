"""Bearer-token verification (``SupabaseService.verify_token``).

A new account's first ``/auth/me`` call verifies a token Supabase minted a
second or two earlier. PyJWT 2.10+ rejects an ``iat`` even slightly ahead
of this server's clock unless a leeway is given, and the refusal used to be
a log line only. These tests pin the leeway and the Sentry warning, against
real PyJWT (HS256) plus a spy on ``jwt.decode``.
"""

import time
from types import SimpleNamespace

import jwt
import pytest
from flask import Flask

from aeva.auth import token_diagnostics
from aeva.supabase import supabase_service
from aeva.supabase.supabase_service import JWT_LEEWAY_SECONDS, SupabaseService

SECRET = "unit-test-secret-that-is-long-enough-for-hs256"  # noqa: S105
USER_ID = "33333333-3333-4333-8333-333333333333"


@pytest.fixture
def app():
    flask_app = Flask(__name__)
    flask_app.config.update(
        TESTING=True,
        SUPABASE_URL="https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY="service-role",
        SUPABASE_JWT_SECRET=SECRET,
    )
    with flask_app.app_context():
        yield flask_app


@pytest.fixture
def reports(monkeypatch):
    """Capture what the diagnostics module would send to Sentry."""
    sent = []

    def fake_capture_warning(message, *, tags=None, extras=None):
        sent.append({"message": message, "tags": tags, "extras": extras})

    monkeypatch.setattr(
        token_diagnostics, "capture_warning", fake_capture_warning
    )
    return sent


def make_token(iat_offset_s=0, **claims):
    now = int(time.time())
    payload = {
        "sub": USER_ID,
        "email": "x@example.com",
        "aud": "authenticated",
        "iat": now + iat_offset_s,
        "exp": now + iat_offset_s + 3600,
    }
    payload.update(claims)
    return jwt.encode(payload, SECRET, algorithm="HS256", headers={"kid": "k1"})


class TestLeeway:
    def test_decode_passes_leeway_to_pyjwt(self, app, monkeypatch):
        seen = {}
        real_decode = jwt.decode

        def spy(token, key, **kwargs):
            seen.update(kwargs)
            return real_decode(token, key, **kwargs)

        monkeypatch.setattr(supabase_service.jwt, "decode", spy)
        SupabaseService()._decode_token(make_token())
        assert seen["leeway"] == JWT_LEEWAY_SECONDS == 60
        assert seen["audience"] == "authenticated"
        assert seen["algorithms"] == ["HS256"]

    def test_token_issued_slightly_in_the_future_is_accepted(self, app):
        # Supabase's clock 30 s ahead of this server: within the leeway.
        payload = SupabaseService()._decode_token(make_token(iat_offset_s=30))
        assert payload["sub"] == USER_ID

    def test_token_issued_well_in_the_future_is_still_refused(self, app):
        with pytest.raises(jwt.ImmatureSignatureError):
            SupabaseService()._decode_token(make_token(iat_offset_s=600))

    def test_without_leeway_the_same_token_would_fail(self, app):
        # Documents why the leeway exists: PyJWT's default is zero.
        token = make_token(iat_offset_s=30)
        with pytest.raises(jwt.ImmatureSignatureError):
            jwt.decode(
                token, SECRET, algorithms=["HS256"], audience="authenticated"
            )


class TestFailureReporting:
    def test_refused_token_is_reported_without_the_token(self, app, reports):
        token = make_token(iat_offset_s=600)
        assert SupabaseService().verify_token(token) is None

        assert len(reports) == 1
        report = reports[0]
        assert report["message"] == (
            "JWT verification failed: ImmatureSignatureError"
        )
        assert report["tags"] == {
            "auth.error_class": "ImmatureSignatureError",
            "auth.alg": "HS256",
            "auth.kid": "k1",
        }
        extras = report["extras"]
        assert extras["aud"] == "authenticated"
        # iat is ahead of this clock: negative skew of about ten minutes.
        assert -620 <= extras["iat_skew_s"] <= -590
        assert extras["exp_in_s"] > 0
        # Never the token, never the subject or email.
        flat = repr(report)
        assert token not in flat
        assert USER_ID not in flat
        assert "x@example.com" not in flat

    def test_garbage_token_is_reported_as_unknown(self, app, reports):
        assert SupabaseService().verify_token("not-a-jwt") is None
        assert reports[0]["tags"]["auth.error_class"] == "DecodeError"
        assert reports[0]["tags"]["auth.alg"] == "unknown"
        assert reports[0]["tags"]["auth.kid"] == "none"
        assert reports[0]["extras"]["iat_skew_s"] is None

    def test_reporting_failure_never_breaks_verification(
        self, app, monkeypatch
    ):
        def boom(*_a, **_k):
            raise RuntimeError("sentry down")

        monkeypatch.setattr(token_diagnostics, "capture_warning", boom)
        assert SupabaseService().verify_token("not-a-jwt") is None

    def test_valid_token_is_not_reported(self, app, reports, monkeypatch):
        class FakeQuery:
            def select(self, *_a):
                return self

            def eq(self, *_a):
                return self

            def maybe_single(self):
                return self

            def execute(self):
                return SimpleNamespace(data={"id": USER_ID, "email": "x"})

        fake_client = SimpleNamespace(table=lambda _name: FakeQuery())
        monkeypatch.setattr(
            SupabaseService, "client", property(lambda _self: fake_client)
        )
        user = SupabaseService().verify_token(make_token(iat_offset_s=5))
        assert user == {"id": USER_ID, "email": "x"}
        assert reports == []
