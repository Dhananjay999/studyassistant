"""Delay controller."""

from typing import Any

from flask.views import MethodView
from flask_smorest import Blueprint

from aeva.common.schema import ResponseEnvelopeSchema
from aeva.delay.delay_repository import DelayRepository
from aeva.delay.schema.delay_schema import DelayQuerySchema

blueprint = Blueprint(
    "delay",
    __name__,
    url_prefix="/delay",
    description="Dummy delayed response",
)


class DelayEndpoint(MethodView):
    """Return a success response after a requested number of seconds."""

    @staticmethod
    @blueprint.doc(security=[])
    @blueprint.arguments(DelayQuerySchema, location="query")
    @blueprint.response(200, ResponseEnvelopeSchema)
    def get(args: dict) -> dict[str, Any]:
        """Wait ``seconds`` seconds, then respond with the elapsed time."""
        return DelayRepository.wait(args["seconds"])


blueprint.add_url_rule("/", view_func=DelayEndpoint, endpoint="delay")
