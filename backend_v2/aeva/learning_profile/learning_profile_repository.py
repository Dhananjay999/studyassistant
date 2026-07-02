"""Learning profile repository.

The profile is persisted on the user's `profiles` row. Onboarding is optional,
so reads always succeed (returning a 'pending' status for a brand-new user) and
writes patch only the provided fields.
"""

from datetime import UTC, datetime
from typing import Any

from aeva.common.schema import UserData, success_response
from aeva.learning_profile.schema.learning_profile_schema import (
    LearningProfileData,
)
from aeva.supabase.supabase_service import SupabaseService


def _project(profile: dict[str, Any] | None) -> dict[str, Any]:
    """Pull just the learning-profile view out of a full profile row."""
    profile = profile or {}
    return {
        "education_level": profile.get("education_level"),
        "preferred_language": profile.get("preferred_language"),
        "explanation_style": profile.get("explanation_style"),
        "favorite_subjects": profile.get("favorite_subjects") or [],
        "learning_goal": profile.get("learning_goal"),
        "ai_personality": profile.get("ai_personality"),
        "communication_style": profile.get("communication_style"),
        "custom_instructions": profile.get("custom_instructions"),
        "personalization_status": (
            profile.get("personalization_status") or "pending"
        ),
        "personalization_updated_at": profile.get(
            "personalization_updated_at"
        ),
    }


class LearningProfileRepository:
    """Learning profile business logic."""

    @staticmethod
    def get_profile(current_user: UserData) -> dict[str, Any]:
        """Return the user's learning profile (defaults for new users)."""
        supabase = SupabaseService()
        profile = supabase.get_profile(current_user.id)
        return success_response(
            "Learning profile retrieved", _project(profile)
        )

    @staticmethod
    def update_profile(
        current_user: UserData,
        data: LearningProfileData,
    ) -> dict[str, Any]:
        """Save personalization choices and mark onboarding completed."""
        fields: dict[str, Any] = {
            "education_level": data.education_level,
            "preferred_language": data.preferred_language,
            "explanation_style": data.explanation_style,
            "favorite_subjects": data.favorite_subjects,
            "learning_goal": data.learning_goal,
            "ai_personality": data.ai_personality,
            "communication_style": data.communication_style,
            "custom_instructions": data.custom_instructions,
            "personalization_status": "completed",
            "personalization_updated_at": datetime.now(UTC).isoformat(),
        }
        return LearningProfileRepository._write(current_user, fields)

    @staticmethod
    def skip(current_user: UserData) -> dict[str, Any]:
        """Record that the user skipped onboarding (do not nag again)."""
        fields: dict[str, Any] = {
            "personalization_status": "skipped",
            "personalization_updated_at": datetime.now(UTC).isoformat(),
        }
        return LearningProfileRepository._write(current_user, fields)

    @staticmethod
    def _write(
        current_user: UserData, fields: dict[str, Any]
    ) -> dict[str, Any]:
        """Ensure a profile row exists, patch it, and return the view."""
        supabase = SupabaseService()
        # A profile row may not exist yet for a fresh OAuth user.
        if not supabase.get_profile(current_user.id):
            supabase.upsert_profile(
                user_id=current_user.id,
                email=current_user.email,
                full_name=current_user.full_name,
                avatar_url=current_user.avatar_url,
            )
        profile = supabase.update_learning_profile(current_user.id, fields)
        return success_response(
            "Learning profile updated", _project(profile)
        )
