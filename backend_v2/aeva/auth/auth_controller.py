"""Auth controller."""

import base64
import hashlib
import logging
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
from aeva.auth.schema.profile_schema import (
    ProfileResponseSchema,
    UpsertProfileSchema,
)
from aeva.common.decorators import user_required
from aeva.common.errors import ERROR_CODES, CustomError
from aeva.common.schema import UserData
from aeva.supabase.supabase_service import SupabaseService

logger = logging.getLogger(__name__)

blueprint = Blueprint(
    "auth",
    __name__,
    url_prefix="/auth",
    description="Authentication",
)

PKCE_COOKIE = "pkce_verifier"


def _generate_pkce() -> tuple[str, str]:
    """Generate a PKCE code verifier and S256 challenge."""
    verifier = (
        base64.urlsafe_b64encode(secrets.token_bytes(32))
        .rstrip(b"=")
        .decode()
    )
    digest = hashlib.sha256(verifier.encode()).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    return verifier, challenge


class AuthMe(MethodView):
    """Current user profile routes."""

    @staticmethod
    @user_required
    def get(current_user: UserData) -> dict[str, Any]:
        """Get current user profile."""
        return AuthRepository.get_me(current_user)

    @staticmethod
    @blueprint.arguments(UpsertProfileSchema)
    @user_required
    def put(current_user: UserData, data: dict) -> dict[str, Any]:
        """Upsert user profile."""
        return AuthRepository.upsert_profile(current_user, data)


@blueprint.route("/login/google")
def login_google() -> Response:
    """Start Google OAuth via Supabase (PKCE)."""
    supabase = SupabaseService()
    verifier, challenge = _generate_pkce()
    callback = f"{request.url_root.rstrip('/')}/auth/callback"
    url = supabase.build_oauth_url("google", callback, challenge)

    response = make_response(redirect(url))
    response.set_cookie(
        PKCE_COOKIE,
        verifier,
        max_age=600,
        httponly=True,
        secure=current_app.config["COOKIE_SECURE"],
        samesite="Lax",
    )
    return response


@blueprint.route("/callback")
def auth_callback() -> Response:
    """Handle OAuth callback: exchange code, redirect to frontend."""
    frontend = current_app.config["FRONTEND_URL"]
    code = request.args.get("code")
    verifier = request.cookies.get(PKCE_COOKIE)

    if not code or not verifier:
        return redirect(f"{frontend}/?auth_error=missing_code")

    supabase = SupabaseService()
    try:
        session = supabase.exchange_code(code, verifier)
    except Exception:
        logger.exception("OAuth code exchange failed")
        return redirect(f"{frontend}/?auth_error=exchange_failed")

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


blueprint.add_url_rule("/me", view_func=AuthMe.as_view("auth_me"))
