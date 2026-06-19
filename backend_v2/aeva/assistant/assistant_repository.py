"""Assistant repository."""

from collections.abc import Generator

from aeva.assistant.schema.assistant_schema import AssistantRequestData
from aeva.common.schema import UserData, success_response
from aeva.orchestration.assistant_orchestrator import AssistantOrchestrator
from aeva.orchestration.models import AssistantContext, RunStatus


class AssistantRepository:
    """Delegate to the orchestrator."""

    @staticmethod
    def _context(
        current_user: UserData,
        request_data: AssistantRequestData,
    ) -> AssistantContext:
        """Build the orchestrator context from a request."""
        return AssistantContext(
            user_id=current_user.id,
            session_id=request_data.session_id,
            message=request_data.message,
            media_ids=request_data.media_ids,
            run_id=request_data.run_id,
            clarification=request_data.clarification,
        )

    @staticmethod
    def process_stream(
        current_user: UserData,
        request_data: AssistantRequestData,
    ) -> Generator[str, None, None]:
        """Run one assistant turn, streaming SSE frames."""
        orchestrator = AssistantOrchestrator()
        ctx = AssistantRepository._context(current_user, request_data)
        yield from orchestrator.run_stream(ctx)

    @staticmethod
    def process(
        current_user: UserData,
        request_data: AssistantRequestData,
    ) -> dict:
        """Run one assistant turn."""
        orchestrator = AssistantOrchestrator()
        ctx = AssistantRepository._context(current_user, request_data)
        result = orchestrator.run(ctx)

        if result.status == RunStatus.CLARIFICATION_REQUIRED:
            return success_response("Clarification needed", {
                "status": "clarification_required",
                "run_id": result.run_id,
                "clarification": {
                    "reason": result.clarification.reason,
                    "questions": [
                        {
                            "id": q.id,
                            "text": q.text,
                            "options": q.options,
                        }
                        for q in result.clarification.questions
                    ],
                },
                "message_id": result.message_id,
            })

        return success_response("OK", {
            "status": "completed",
            "tool_used": result.tool_used,
            "content": result.content,
            "message_id": result.message_id,
        })
