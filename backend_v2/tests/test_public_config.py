"""``GET /config`` and the feature-flag registry additions behind it.

Covers the single upload limit (R10: one value served to the frontend, 30 MB
by default), the new-user flag gating (R25) and the ``reason`` code that
media processing failures now carry (R10 analytics).
"""

import os
from unittest.mock import patch

import pytest
from flask import Flask

from aeva.app import load_env_vars
from aeva.feature_flag import feature_flag_service
from aeva.media.media_processor import MediaProcessingError, MediaProcessor

REQUIRED_ENV = {
    "SUPABASE_URL": "https://x.supabase.co",
    "SUPABASE_SERVICE_ROLE_KEY": "k",
    "GEMINI_API_KEY": "g",
}


def _load(env: dict[str, str], drop: tuple[str, ...] = ()) -> Flask:
    """Run load_env_vars with ``env`` set and ``drop`` unset (a local .env
    may define them)."""
    app = Flask(__name__)
    with (
        patch.dict(os.environ, {**REQUIRED_ENV, **env}, clear=False),
        patch("aeva.app.load_dotenv", lambda *a, **k: None),
    ):
        for key in drop:
            os.environ.pop(key, None)
        load_env_vars(app)
    return app


def test_max_upload_defaults_to_30mb():
    app = _load({}, drop=("MAX_UPLOAD_MB", "FEATURE_NEW_USER_SINCE"))
    assert app.config["MAX_UPLOAD_MB"] == 30
    assert app.config["FEATURE_NEW_USER_SINCE"] == "2026-10-09"


def test_max_upload_env_override():
    app = _load(
        {"MAX_UPLOAD_MB": "12", "FEATURE_NEW_USER_SINCE": "2026-11-01"}
    )
    assert app.config["MAX_UPLOAD_MB"] == 12
    assert app.config["FEATURE_NEW_USER_SINCE"] == "2026-11-01"


def test_hidden_for_new_users_lists_only_enabled_flags():
    with patch.object(
        feature_flag_service,
        "get_flags",
        return_value={**feature_flag_service.DEFAULTS, "sharing": False},
    ):
        hidden = feature_flag_service.hidden_for_new_users()
    # sharing is already off globally, so only study_spaces is listed.
    assert hidden == ["study_spaces"]


def test_hidden_for_new_users_default_registry():
    with patch.object(
        feature_flag_service,
        "get_flags",
        return_value=dict(feature_flag_service.DEFAULTS),
    ):
        assert feature_flag_service.hidden_for_new_users() == [
            "study_spaces",
            "sharing",
        ]


@pytest.mark.parametrize(
    ("kwargs", "expected"),
    [
        ({}, "parse_failed"),
        ({"recoverable": True}, "parse_timeout"),
        ({"reason": "not_found"}, "not_found"),
    ],
)
def test_processing_error_reason_defaults(kwargs, expected):
    assert MediaProcessingError("m", **kwargs).reason == expected


def test_error_event_carries_reason():
    event = MediaProcessor._error_event(
        "Parsing did not complete.", recoverable=False, reason="parse_failed"
    )
    assert event["stage"] == "error"
    assert event["reason"] == "parse_failed"
    assert event["kept"] is True
    # Older callers that pass no reason still get a valid code.
    fallback = MediaProcessor._error_event("x", recoverable=False)
    assert fallback["reason"] == "unexpected"
