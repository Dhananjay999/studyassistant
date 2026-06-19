"""Auth repository."""

from typing import Any

from aeva.common.schema import UserData, success_response
from aeva.supabase.supabase_service import SupabaseService


class AuthRepository:
    """Auth business logic."""

    @staticmethod
    def get_me(current_user: UserData) -> dict[str, Any]:
        """Get current user profile."""
        supabase = SupabaseService()
        profile = supabase.get_profile(current_user.id)
        if not profile:
            profile = supabase.upsert_profile(
                user_id=current_user.id,
                email=current_user.email,
                full_name=current_user.full_name,
                avatar_url=current_user.avatar_url,
            )
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
