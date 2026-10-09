"""Why a bearer token was refused, reported to Sentry as a warning.

``SupabaseService.verify_token`` answers ``None`` for any token it cannot
verify, and the caller turns that into a 401. Until now the reason lived
only in a log line, so a freshly issued token being rejected seconds after
sign-in (the first ``/auth/me`` call of a new account) left no trace in
Sentry. This module describes the failure with the exception class, the
token header's ``alg`` and ``kid`` and the clock skew between the token's
``iat`` and this server. It never includes the token or any claim that
identifies the user.
"""

import contextlib
import logging
import time
from typing import Any

import jwt

from aeva.common.sentry import capture_warning

logger = logging.getLogger(__name__)

# Only the header and the timing claims are read, and without verification:
# the point is to explain a failure, not to trust the token.
_UNVERIFIED = {
    "verify_signature": False,
    "verify_exp": False,
    "verify_iat": False,
    "verify_nbf": False,
    "verify_aud": False,
}


def _as_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        return int(value)
    return None


def describe_token_failure(token: str, exc: BaseException) -> dict[str, Any]:
    """Build the non-identifying facts about a rejected token."""
    header: dict[str, Any] = {}
    claims: dict[str, Any] = {}
    # A malformed header or payload is reported as "unknown", not raised.
    with contextlib.suppress(Exception):
        header = jwt.get_unverified_header(token)
    with contextlib.suppress(Exception):
        claims = jwt.decode(token, options=_UNVERIFIED)

    now = int(time.time())
    iat = _as_int(claims.get("iat"))
    exp = _as_int(claims.get("exp"))
    aud = claims.get("aud")
    return {
        "error_class": type(exc).__name__,
        "alg": str(header.get("alg") or "unknown"),
        "kid": str(header.get("kid") or "none"),
        # Positive: the token was issued in the past; negative: its ``iat``
        # is ahead of this server's clock (the ``ImmatureSignatureError``
        # case when it exceeds the decode leeway).
        "iat_skew_s": None if iat is None else now - iat,
        "exp_in_s": None if exp is None else exp - now,
        "aud": None if aud is None else str(aud),
    }


def report_token_verification_failure(token: str, exc: BaseException) -> None:
    """Log and send a Sentry warning for a token ``verify_token`` refused."""
    facts = describe_token_failure(token, exc)
    logger.warning(
        "JWT verification failed | class=%s alg=%s kid=%s "
        "iat_skew_s=%s exp_in_s=%s aud=%s",
        facts["error_class"],
        facts["alg"],
        facts["kid"],
        facts["iat_skew_s"],
        facts["exp_in_s"],
        facts["aud"],
    )
    try:
        capture_warning(
            f"JWT verification failed: {facts['error_class']}",
            tags={
                "auth.error_class": facts["error_class"],
                "auth.alg": facts["alg"],
                "auth.kid": facts["kid"],
            },
            extras=facts,
        )
    except Exception:  # noqa: BLE001 - reporting must never break auth
        logger.debug("Sentry report for JWT failure skipped", exc_info=True)
