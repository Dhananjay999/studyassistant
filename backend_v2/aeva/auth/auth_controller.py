"""Auth controller."""

import base64
import hashlib
import logging
import re
import secrets
from typing import Any

from flask import (
    Response,
    current_app,
    jsonify,
    make_response,
    redirect,
    request,
)
from flask.views import MethodView
from flask_smorest import Blueprint

from aeva.auth.auth_repository import AuthRepository
from aeva.auth.schema.profile_schema import UpsertProfileSchema
from aeva.common.decorators import user_required
from aeva.common.errors import ERROR_CODES, CustomError
from aeva.common.schema import ResponseEnvelopeSchema, UserData
from aeva.supabase.supabase_service import SupabaseService

logger = logging.getLogger(__name__)

blueprint = Blueprint(
    "auth",
    __name__,
    url_prefix="/auth",
    description="Authentication",
)

PKCE_COOKIE = "pkce_verifier"
# Shape of a verifier this module issued: 32 random bytes, base64url, no
# padding. Anything else in the cookie is ignored rather than reused.
_VERIFIER_RE = re.compile(r"^[A-Za-z0-9_-]{43}$")


def _pkce_challenge(verifier: str) -> str:
    """S256 challenge for a verifier."""
    digest = hashlib.sha256(verifier.encode()).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def _generate_pkce() -> tuple[str, str]:
    """Generate a PKCE code verifier and S256 challenge."""
    verifier = (
        base64.urlsafe_b64encode(secrets.token_bytes(32))
        .rstrip(b"=")
        .decode()
    )
    return verifier, _pkce_challenge(verifier)


def _pkce_for_request(existing: str | None) -> tuple[str, str]:
    """Pick the verifier and challenge for a new sign-in start.

    A second start while a flow is in progress (a double tap on a slow
    phone, or a retry from the issue dialog) used to overwrite the single
    verifier cookie, so only the last flow could exchange its code and the
    earlier callback failed with ``exchange_failed``. Reusing the verifier
    already in the cookie keeps every flow started from this browser
    exchangeable: each one's challenge is derived from the same secret.
    The cookie is gone after a successful callback or its max-age, so a
    normal single start still gets a fresh verifier.
    """
    if existing and _VERIFIER_RE.fullmatch(existing):
        return existing, _pkce_challenge(existing)
    return _generate_pkce()


class AuthMe(MethodView):
    """Current user profile routes."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def get(current_user: UserData) -> dict[str, Any]:
        """Get current user profile."""
        return AuthRepository.get_me(current_user)

    @staticmethod
    @blueprint.arguments(UpsertProfileSchema)
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def put(current_user: UserData, data: dict) -> dict[str, Any]:
        """Upsert user profile."""
        return AuthRepository.upsert_profile(current_user, data)


@blueprint.route("/login/google")
@blueprint.doc(security=[])
def login_google() -> Response:
    """Start Google OAuth via Supabase (PKCE)."""
    supabase = SupabaseService()
    verifier, challenge = _pkce_for_request(request.cookies.get(PKCE_COOKIE))
    callback = f"{request.url_root.rstrip('/')}/auth/callback"
    url = supabase.build_oauth_url("google", callback, challenge)

    response = make_response(redirect(url))
    response.set_cookie(
        PKCE_COOKIE,
        verifier,
        max_age=current_app.config["PKCE_COOKIE_MAX_AGE_SECONDS"],
        httponly=True,
        secure=current_app.config["COOKIE_SECURE"],
        samesite="Lax",
    )
    return response


@blueprint.route("/callback")
@blueprint.doc(security=[])
def auth_callback() -> Response:
    """Handle OAuth callback: exchange code, redirect to frontend."""
    frontend = current_app.config["FRONTEND_URL"]
    code = request.args.get("code")
    verifier = request.cookies.get(PKCE_COOKIE)

    # Failures go to the frontend callback page (not the landing page) so a
    # sign-in popup can report the reason to its opener and close itself.
    failure = f"{frontend}/auth/callback?auth_error="
    provider_error = request.args.get("error")

    if provider_error:
        reason = (
            "access_denied"
            if provider_error == "access_denied"
            else "provider_error"
        )
        return make_response(redirect(f"{failure}{reason}"))

    if not code or not verifier:
        return make_response(redirect(f"{failure}missing_code"))

    supabase = SupabaseService()
    try:
        session = supabase.exchange_code(code, verifier)
    except Exception:
        logger.exception("OAuth code exchange failed")
        return make_response(redirect(f"{failure}exchange_failed"))

    access_token = session.get("access_token", "")
    refresh_token = session.get("refresh_token", "")
    expires_in = session.get("expires_in", 3600)

    fragment = (
        f"access_token={access_token}"
        f"&refresh_token={refresh_token}"
        f"&expires_in={expires_in}"
    )
    response = make_response(
        redirect(f"{frontend}/auth/callback#{fragment}")
    )
    response.delete_cookie(PKCE_COOKIE)
    return response


@blueprint.route("/refresh", methods=["POST"])
@blueprint.doc(security=[])
def refresh() -> Response:
    """Refresh an access token using a refresh token."""
    data = request.get_json(silent=True) or {}
    refresh_token = data.get("refresh_token")
    if not refresh_token:
        raise CustomError(
            ERROR_CODES["VALIDATION_ERROR"],
            details="refresh_token is required",
        )

    supabase = SupabaseService()
    try:
        session = supabase.refresh_session(refresh_token)
    except Exception:
        logger.exception("Token refresh failed")
        raise CustomError(ERROR_CODES["INVALID_USER"]) from None

    return jsonify({
        "msg": "Token refreshed",
        "data": {
            "access_token": session.get("access_token", ""),
            "refresh_token": session.get("refresh_token", ""),
            "expires_in": session.get("expires_in", 3600),
        },
    })


blueprint.add_url_rule("/me", view_func=AuthMe, endpoint="auth_me")
