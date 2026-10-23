"""Plan controller: the user's tier and Pro Early Access activation."""

from typing import Any

from flask.views import MethodView
from flask_smorest import Blueprint

from aeva.common.decorators import user_required
from aeva.common.schema import ResponseEnvelopeSchema, UserData
from aeva.plan.plan_repository import PlanRepository
from aeva.plan.schema.plan_schema import ActivateEarlyAccessSchema

blueprint = Blueprint(
    "plan",
    __name__,
    url_prefix="/plan",
    description="User plan (free / pro) and Pro Early Access",
)


class PlanView(MethodView):
    """Read the current user's plan."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def get(current_user: UserData) -> dict[str, Any]:
        """Get the plan view (free / none for an account never prompted)."""
        return PlanRepository.get_plan(current_user)


class PlanActivateEarlyAccess(MethodView):
    """Activate Pro at ₹0 during Early Access."""

    @staticmethod
    @blueprint.arguments(ActivateEarlyAccessSchema)
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def post(current_user: UserData, data: dict) -> dict[str, Any]:
        """Mark the user as Pro (Early Access). No payment, idempotent."""
        return PlanRepository.activate_early_access(
            current_user,
            data.get("currency"),
        )


class PlanPromptShown(MethodView):
    """Remember that the Pro introduction popup was shown."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def post(current_user: UserData) -> dict[str, Any]:
        """Record the popup as shown so the client never repeats it."""
        return PlanRepository.mark_prompt_shown(current_user)


blueprint.add_url_rule("/", view_func=PlanView, endpoint="plan")
blueprint.add_url_rule(
    "/activate-early-access",
    view_func=PlanActivateEarlyAccess,
    endpoint="plan_activate_early_access",
)
blueprint.add_url_rule(
    "/prompt-shown",
    view_func=PlanPromptShown,
    endpoint="plan_prompt_shown",
)
