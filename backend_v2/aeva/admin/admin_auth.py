"""Admin authentication: env-credential login and JWT verification.

A successful username/password check against ``ADMIN_USERNAME`` /
``ADMIN_PASSWORD`` (env only, never hardcoded) issues a short-lived JWT signed
with ``ADMIN_JWT_SECRET``. Every admin route is guarded by ``admin_required``,
which verifies that token on the server for EVERY request — the secret URL is
never trusted as access control. If any of the three env values is missing the
panel is disabled and auth fails closed.
"""

import hmac
import logging
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from functools import wraps
from typing import Any, TypeVar

import jwt
from flask import current_app, request

from aeva.common.errors import ERROR_CODES, CustomError

logger = logging.getLogger(__name__)

F = TypeVar("F", bound=Callable[..., Any])

_ALG = "HS256"
_TTL = timedelta(hours=8)


def _config(key: str) -> str:
    """Read an admin config value as a string ('' when unset)."""
    return str(current_app.config.get(key) or "")


def admin_enabled() -> bool:
    """Whether credentials and a signing secret are all configured."""
    return bool(
        _config("ADMIN_USERNAME")
        and _config("ADMIN_PASSWORD")
        and _config("ADMIN_JWT_SECRET")
    )


def verify_credentials(username: str, password: str) -> bool:
    """Constant-time check of submitted credentials against env values."""
    if not admin_enabled():
        raise CustomError(ERROR_CODES["ADMIN_NOT_CONFIGURED"])
    user_ok = hmac.compare_digest(username, _config("ADMIN_USERNAME"))
    pass_ok = hmac.compare_digest(password, _config("ADMIN_PASSWORD"))
    return user_ok and pass_ok


def issue_token(username: str) -> dict[str, Any]:
    """Issue a signed, expiring admin JWT for the given username."""
    now = datetime.now(tz=UTC)
    expires = now + _TTL
    payload = {
        "sub": username,
        "role": "admin",
        "iat": int(now.timestamp()),
        "exp": int(expires.timestamp()),
    }
    token = jwt.encode(payload, _config("ADMIN_JWT_SECRET"), algorithm=_ALG)
    return {"token": token, "expires_at": expires.isoformat()}


def _decode(token: str) -> dict[str, Any] | None:
    """Verify an admin token's signature, expiry, and role claim."""
    if not admin_enabled():
        return None
    try:
        payload: dict[str, Any] = jwt.decode(
            token, _config("ADMIN_JWT_SECRET"), algorithms=[_ALG]
        )
    except jwt.PyJWTError as exc:
        logger.warning("Admin token verification failed: %s", exc)
        return None
    if payload.get("role") != "admin":
        return None
    return payload


def admin_required(func: F) -> F:
    """Verify the admin JWT and inject the admin username as first arg."""

    @wraps(func)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            raise CustomError(ERROR_CODES["ADMIN_UNAUTHORIZED"])
        payload = _decode(header.split(" ", 1)[1])
        if not payload:
            raise CustomError(ERROR_CODES["ADMIN_UNAUTHORIZED"])
        return func(str(payload.get("sub", "admin")), *args, **kwargs)

    return wrapper  # type: ignore[return-value]
