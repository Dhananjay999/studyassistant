"""Learning profile controller."""

from typing import Any

from flask.views import MethodView
from flask_smorest import Blueprint

from aeva.common.decorators import user_required
from aeva.common.schema import ResponseEnvelopeSchema, UserData
from aeva.learning_profile.learning_profile_repository import (
    LearningProfileRepository,
)
from aeva.learning_profile.schema.learning_profile_schema import (
    LearningProfileData,
    UpdateLearningProfileSchema,
)

blueprint = Blueprint(
    "learning_profile",
    __name__,
    url_prefix="/learning-profile",
    description="Optional personalization profile",
)


class LearningProfileView(MethodView):
    """Read and update the current user's learning profile."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def get(current_user: UserData) -> dict[str, Any]:
        """Get the learning profile (defaults to 'pending' for new users)."""
        return LearningProfileRepository.get_profile(current_user)

    @staticmethod
    @blueprint.arguments(UpdateLearningProfileSchema)
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def put(
        current_user: UserData,
        request_data: LearningProfileData,
    ) -> dict[str, Any]:
        """Save personalization choices and mark onboarding completed."""
        return LearningProfileRepository.update_profile(
            current_user, request_data
        )


class LearningProfileSkip(MethodView):
    """Skip onboarding without configuring a profile."""

    @staticmethod
    @blueprint.response(200, ResponseEnvelopeSchema)
    @user_required
    def post(current_user: UserData) -> dict[str, Any]:
        """Mark onboarding as skipped so the user is not prompted again."""
        return LearningProfileRepository.skip(current_user)


blueprint.add_url_rule(
    "/", view_func=LearningProfileView, endpoint="learning_profile"
)
blueprint.add_url_rule(
    "/skip",
    view_func=LearningProfileSkip,
    endpoint="learning_profile_skip",
)
