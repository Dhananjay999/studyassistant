"""Plan repository: reads and writes the plan columns on ``profiles``."""

from datetime import UTC, datetime
from typing import Any

from aeva.common.schema import UserData, success_response
from aeva.plan import plan_service
from aeva.supabase.supabase_service import SupabaseService


class PlanRepository:
    """Plan business logic."""

    @staticmethod
    def get_plan(current_user: UserData) -> dict[str, Any]:
        """Return the user's plan view (defaults for new users)."""
        supabase = SupabaseService()
        profile = supabase.get_profile(current_user.id)
        return success_response("Plan retrieved", plan_service.project(profile))

    @staticmethod
    def activate_early_access(
        current_user: UserData,
        currency: str | None = None,
    ) -> dict[str, Any]:
        """Put the user on Pro at ₹0 / $0 (Early Access). Idempotent.

        Every account is eligible: there is no payment, no limit and no
        eligibility check during Early Access. A user who is already on
        Pro keeps their original ``pro_activated_at`` and the currency they
        were first quoted in; ``currency`` is recorded only the first time.
        """
        supabase = SupabaseService()
        profile = PlanRepository._ensure_profile(supabase, current_user)
        current = plan_service.project(profile)
        fields: dict[str, Any] = {
            "plan": plan_service.PLAN_PRO,
            "plan_status": plan_service.STATUS_EARLY_ACCESS,
            # Activating from the popup also means the popup was shown.
            "pro_prompt_shown": True,
        }
        if not current["pro_activated_at"]:
            fields["pro_activated_at"] = datetime.now(UTC).isoformat()
        wanted = plan_service.normalize_currency(currency)
        if wanted and not current["currency"]:
            fields["currency"] = wanted
        updated = supabase.update_profile_fields(current_user.id, fields)
        return success_response(
            "Pro Early Access activated",
            plan_service.project(updated or {**(profile or {}), **fields}),
        )

    @staticmethod
    def mark_prompt_shown(current_user: UserData) -> dict[str, Any]:
        """Record that the Pro introduction was shown (do not show again)."""
        supabase = SupabaseService()
        profile = PlanRepository._ensure_profile(supabase, current_user)
        fields = {"pro_prompt_shown": True}
        updated = supabase.update_profile_fields(current_user.id, fields)
        return success_response(
            "Pro prompt recorded",
            plan_service.project(updated or {**(profile or {}), **fields}),
        )

    @staticmethod
    def _ensure_profile(
        supabase: SupabaseService,
        current_user: UserData,
    ) -> dict[str, Any] | None:
        """Return the profile row, creating it for a fresh OAuth user."""
        profile = supabase.get_profile(current_user.id)
        if profile:
            return profile
        return supabase.upsert_profile(
            user_id=current_user.id,
            email=current_user.email,
            full_name=current_user.full_name,
            avatar_url=current_user.avatar_url,
        )
