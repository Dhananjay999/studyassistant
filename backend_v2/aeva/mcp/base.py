"""Base types for MCP tools."""

from abc import ABC, abstractmethod
from collections.abc import Generator
from dataclasses import dataclass, field
from typing import Any


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
