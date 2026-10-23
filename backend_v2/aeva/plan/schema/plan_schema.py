"""Plan schemas (documentation of the ``/plan/*`` response shape)."""

from marshmallow import Schema, fields, validate

from aeva.plan.plan_service import CURRENCIES


class PlanResponseSchema(Schema):
    """The user's plan view (``plan_service.project``)."""

    plan = fields.Str(required=True)
    plan_status = fields.Str(required=True)
    pro_activated_at = fields.Str(allow_none=True)
    pro_prompt_shown = fields.Bool(required=True)
    currency = fields.Str(allow_none=True)


class ActivateEarlyAccessSchema(Schema):
    """Optional body for ``POST /plan/activate-early-access``."""

    # The currency the client quoted (from the device's region). Optional so
    # an older client that sends no body still activates.
    currency = fields.Str(
        load_default=None,
        allow_none=True,
        validate=validate.OneOf(sorted(CURRENCIES)),
    )
