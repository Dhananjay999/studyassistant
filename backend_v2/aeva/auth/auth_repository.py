"""Auth repository."""

from typing import Any

from aeva.common.errors import ERROR_CODES, CustomError
from aeva.common.schema import UserData, success_response
from aeva.supabase.supabase_service import SupabaseService


def _is_fk_violation(exc: Exception) -> bool:
    """Postgres 23503: ``profiles.id`` points at an auth user that is gone."""
    text = str(exc).lower()
    return "23503" in text or "foreign key" in text


class AuthRepository:
    """Auth business logic."""

    @staticmethod
    def get_me(current_user: UserData) -> dict[str, Any]:
        """Get current user profile."""
        supabase = SupabaseService()
        profile = supabase.get_profile(current_user.id)
        if not profile:
            try:
                profile = supabase.upsert_profile(
                    user_id=current_user.id,
                    email=current_user.email,
                    full_name=current_user.full_name,
                    avatar_url=current_user.avatar_url,
                )
            except Exception as exc:
                # The token is valid but its auth user was deleted (account
                # removed while a tab stayed open): that is a sign-out, not
                # a server error (Sentry BACKEND-2 was this as a 500).
                if _is_fk_violation(exc):
                    raise CustomError(ERROR_CODES["INVALID_USER"]) from None
                raise
        return success_response("Profile retrieved", profile)

    @staticmethod
    def upsert_profile(
        current_user: UserData,
        data: dict,
    ) -> dict[str, Any]:
        """Upsert user profile after login."""
        supabase = SupabaseService()
        profile = supabase.upsert_profile(
            user_id=current_user.id,
            email=current_user.email,
            full_name=data.get("full_name", current_user.full_name),
            avatar_url=data.get("avatar_url", current_user.avatar_url),
        )
        return success_response("Profile updated", profile)
