"""Mark an AI trace as an Exam Prep coach turn.

The exam orchestrator reuses the chat turn tracing unchanged; this helper
only annotates the trace so an admin can tell exam-coach turns apart and
find the plan / topic / day they ran against. The values land in the
trace's free-form ``meta`` (``annotate`` keeps unknown keys there), and the
whole call is guarded: tracing must never break a turn.
"""

import logging

from aeva import tracing

logger = logging.getLogger(__name__)

FLOW = "exam_prep"


def mark_exam_turn(
    plan_id: str | None,
    topic_id: str | None = None,
    day_id: str | None = None,
) -> None:
    """Annotate the current trace (a no-op when none is recording)."""
    try:
        tracing.annotate(
            flow=FLOW,
            exam_plan_id=plan_id,
            exam_topic_id=topic_id,
            exam_day_id=day_id,
        )
    except Exception:  # noqa: BLE001 — tracing must never break a turn.
        logger.debug("exam trace annotate failed", exc_info=True)
