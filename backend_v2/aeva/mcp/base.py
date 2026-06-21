"""Base types for MCP tools."""

from abc import ABC, abstractmethod
from collections.abc import Generator
from dataclasses import dataclass, field
from typing import Any

# Canonical follow-up action keys a tool can expose to the client. The frontend
# renders only the actions a response declares — never a hardcoded set.
ACTION_QUIZ = "QUIZ"
ACTION_FLASHCARDS = "FLASHCARDS"
ACTION_SIMPLIFY = "SIMPLIFY"
ACTION_DETAIL = "DETAIL"
ACTION_SUMMARY = "SUMMARY"
ACTION_STUDY_PLAN = "STUDY_PLAN"
ACTION_ANALYZE = "ANALYZE"

# The full learning toolkit, offered on normal study answers.
LEARNING_ACTIONS = [
    ACTION_QUIZ,
    ACTION_FLASHCARDS,
    ACTION_SIMPLIFY,
    ACTION_DETAIL,
    ACTION_SUMMARY,
    ACTION_STUDY_PLAN,
    ACTION_ANALYZE,
]


@dataclass
class ToolDefinition:
    """Tool metadata exposed to the orchestrator and LLM."""

    name: str
    description: str
    parameters_schema: dict[str, Any]


@dataclass
class ToolContext:
    """Runtime context passed to every tool execution."""

    user_id: str
    session_id: str
    message: str
    enriched_message: str
    media_ids: list[str] | None
    history: list[dict[str, str]] = field(default_factory=list)


class BaseTool(ABC):
    """Dedicated capability tool."""

    @property
    @abstractmethod
    def definition(self) -> ToolDefinition:
        """Return tool metadata."""

    @abstractmethod
    def execute(self, ctx: ToolContext, params: dict[str, Any]) -> dict[str, Any]:
        """Run the tool and return a JSON-serializable result."""

    @property
    def available_actions(self) -> list[str]:
        """Follow-up actions the client may offer for this tool's output.

        Tools own their own action set so the UI stays response-aware and new
        MCP tools can expose new actions without any frontend change. Defaults
        to none (e.g. quiz/flashcard tools render their own dedicated card UI).
        """
        return []

    @property
    def response_type(self) -> str:
        """Coarse response category the client can branch rendering on."""
        return "NORMAL"

    def can_stream(self) -> bool:
        """Whether this tool streams text token-by-token via execute_stream."""
        return False

    def execute_stream(
        self,
        ctx: ToolContext,
        params: dict[str, Any],
    ) -> Generator[str, None, dict[str, Any]]:
        """Stream answer text chunks, returning the final result dict.

        The default emits the whole answer at once; streamable tools override
        this to yield chunks as the model produces them.
        """
        result = self.execute(ctx, params)
        answer = result.get("answer", "")
        if answer:
            yield answer
        return result
