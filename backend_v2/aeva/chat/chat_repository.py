"""Chat repository — delegates to assistant orchestrator."""

import json
import logging
from collections.abc import Generator
from typing import Any

from aeva.assistant.assistant_repository import AssistantRepository
from aeva.assistant.schema.assistant_schema import AssistantRequestData
from aeva.chat.schema.chat_schema import ChatRequestData
from aeva.common.schema import UserData, success_response
from aeva.llm.llm_client import LLMClient

logger = logging.getLogger(__name__)


class ChatRepository:
    """Chat business logic (shim over assistant)."""

    @staticmethod
    def _to_assistant(req: ChatRequestData) -> AssistantRequestData:
        """Map legacy chat request to assistant request."""
        return AssistantRequestData(
            session_id=req.session_id,
            message=req.message,
            media_ids=req.media_ids,
        )

    @staticmethod
    def _format_answer(result: dict[str, Any]) -> str:
        """Extract display text from assistant result."""
        data = result.get("data", {})
        if data.get("status") == "clarification_required":
            clar = data.get("clarification", {})
            lines = [clar.get("reason", "I need a bit more information:")]
            for q in clar.get("questions", []):
                lines.append(f"- {q.get('text', '')}")
            return "\n\n".join(lines)

        content = data.get("content") or {}
        if data.get("tool_used") == "quiz_generator":
            title = content.get("title", "Quiz")
            count = len(content.get("questions", []))
            return (
                f"I've created **{title}** with {count} questions. "
                f"Quiz ID: `{content.get('quiz_id')}`"
            )
        return content.get("answer", str(content))

    @staticmethod
    def process_chat(
        current_user: UserData,
        request_data: ChatRequestData,
    ) -> dict[str, Any]:
        """Process a chat request via assistant orchestrator."""
        result = AssistantRepository.process(
            current_user, ChatRepository._to_assistant(request_data)
        )
        data = result.get("data", {})
        content = data.get("content") or {}
        mode = "web_search"
        if data.get("tool_used") == "media_llm":
            mode = "media"
        elif data.get("tool_used") == "quiz_generator":
            mode = "media"

        return success_response("Chat response", {
            "answer": ChatRepository._format_answer(result),
            "mode": mode,
            "sources": content.get("sources", []),
            "message_id": data.get("message_id"),
            "status": data.get("status"),
            "run_id": data.get("run_id"),
            "clarification": data.get("clarification"),
            "tool_used": data.get("tool_used"),
            "content": content,
        })

    @staticmethod
    def process_chat_stream(
        current_user: UserData,
        request_data: ChatRequestData,
    ) -> Generator[str, None, None]:
        """Process streaming chat via assistant orchestrator."""
        result = AssistantRepository.process(
            current_user, ChatRepository._to_assistant(request_data)
        )
        data = result.get("data", {})
        text = ChatRepository._format_answer(result)

        if data.get("status") == "clarification_required":
            payload = {
                "type": "clarification",
                "data": data,
                "done": True,
            }
            yield f"data: {json.dumps(payload)}\n\n"
            return

        yield LLMClient.format_sse_chunk(text)
        yield LLMClient.format_sse_chunk(
            "",
            done=True,
            extra={
                "tool_used": data.get("tool_used"),
                "content": data.get("content"),
            },
        )
