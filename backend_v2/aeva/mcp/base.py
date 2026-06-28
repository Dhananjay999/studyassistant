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
# Open the dedicated card a generator just produced.
ACTION_OPEN_QUIZ = "OPEN_QUIZ"
ACTION_OPEN_FLASHCARDS = "OPEN_FLASHCARDS"

# The full learning toolkit a substantive study answer can offer. The planner
# narrows this per response — a greeting or clarification exposes none of it.
LEARNING_ACTIONS = [
    ACTION_QUIZ,
    ACTION_FLASHCARDS,
    ACTION_SIMPLIFY,
    ACTION_DETAIL,
    ACTION_SUMMARY,
    ACTION_STUDY_PLAN,
    ACTION_ANALYZE,
]

# Coarse response categories the client can branch rendering on. They are part
# of the response contract: each tool (or the orchestrator) stamps exactly one.
RESPONSE_NORMAL = "NORMAL"
RESPONSE_CLARIFICATION = "CLARIFICATION"
RESPONSE_SUMMARY = "SUMMARY"
RESPONSE_QUIZ_CREATED = "QUIZ_CREATED"
RESPONSE_FLASHCARD_CREATED = "FLASHCARD_CREATED"
RESPONSE_WEB_SEARCH = "WEB_SEARCH"
RESPONSE_FILE_ANALYSIS = "FILE_ANALYSIS"
RESPONSE_ERROR = "ERROR"
RESPONSE_NOT_RELEVANT = "NOT_RELEVANT"


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
    # Optional system-prompt fragment built from the user's learning profile;
    # empty when the user has not completed onboarding.
    personalization: str = ""


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
        """Fixed follow-up actions this tool's output always exposes.

        A non-empty list means the action set is intrinsic to the tool (e.g. a
        generated quiz always offers ``OPEN_QUIZ``) and the orchestrator uses it
        verbatim. The empty default means "defer to the planner", which decides
        per response which learning actions are actually meaningful — so a
        greeting answered by the same tool exposes no actions at all.
        """
        return []

    @property
    def response_type(self) -> str:
        """Coarse response category the client can branch rendering on."""
        return RESPONSE_NORMAL

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
