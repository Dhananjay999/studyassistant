"""Sentry error + performance monitoring setup.

``init_sentry`` is called once from the app factory, before the Flask app is
built, so the Flask integration instruments it. Everything is optional: with
``SENTRY_DSN`` blank the SDK is never initialised and every helper here is a
no-op, so local and keyless deployments are unaffected.

The app's global error handler swallows unhandled exceptions (it answers with
a JSON 500), which means Flask never signals them to the SDK; the handler
reports them through ``capture_exception`` instead. Anything logged at ERROR
(``logger.exception`` in agent worker threads, the media processor, ...) is
captured by the SDK's logging integration.
"""

import logging
import os

import sentry_sdk
from sentry_sdk.integrations.flask import FlaskIntegration

logger = logging.getLogger(__name__)

# How long a serverless invocation waits for queued events to be sent before
# the function is frozen (events go out on a background thread).
_FLUSH_TIMEOUT_S = 2.0


def _environment() -> str:
    """Resolve the environment name reported with every event."""
    return (
        os.environ.get("SENTRY_ENVIRONMENT")
        or os.environ.get("VERCEL_ENV")
        or "development"
    )


def _release() -> str | None:
    """Resolve the release (deployed commit), when known."""
    sha = os.environ.get("SENTRY_RELEASE") or os.environ.get(
        "VERCEL_GIT_COMMIT_SHA", ""
    )
    return sha or None


def init_sentry() -> bool:
    """Initialise Sentry from the environment; return whether it is on."""
    dsn = os.environ.get("SENTRY_DSN", "").strip()
    if not dsn:
        logger.info("Sentry disabled (SENTRY_DSN not set)")
        return False

    sentry_sdk.init(
        dsn=dsn,
        environment=_environment(),
        release=_release(),
        integrations=[FlaskIntegration()],
        traces_sample_rate=float(
            os.environ.get("SENTRY_TRACES_SAMPLE_RATE", "0.1")
        ),
        # Never attach request bodies, cookies or auth headers: prompts and
        # uploads are user content. The user is identified by id only.
        send_default_pii=False,
        max_request_body_size="never",
    )
    logger.info("Sentry enabled | environment=%s", _environment())
    return True


def set_user(user_id: str) -> None:
    """Attribute the current request's events to a user (id only)."""
    sentry_sdk.set_user({"id": user_id})


def capture_exception(error: BaseException) -> None:
    """Report an exception and push it out before the request ends."""
    sentry_sdk.capture_exception(error)
    sentry_sdk.flush(timeout=_FLUSH_TIMEOUT_S)
