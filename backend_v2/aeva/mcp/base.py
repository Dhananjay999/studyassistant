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
    # Model the planner chose for THIS turn's tool, from the tool's candidate
    # list (see ``orchestration.model_candidates``). ``None`` means "use the
    # tool's configured default model".
    model: str | None = None
    # Config key overriding which ``LLM_*_MODEL`` / ``LLM_*_PROVIDER`` pair this
    # turn resolves through (e.g. ``"LLM_FAST_MODEL"`` for the fast-turn path).
    # ``None`` means "use the tool's own config key".
    config_key: str | None = None


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

    def resolve_llm(self, ctx: ToolContext, config_key: str) -> Any:
        """Pick the LLM client for this call, honoring the planner's model.

        The ``LLM_*_MODEL`` / ``LLM_*_PROVIDER`` pair is chosen by the config
        key — the tool's own, unless this turn overrides it via
        ``ctx.config_key`` (e.g. the fast-turn path routing through
        ``LLM_FAST_MODEL``). When the planner chose a model (``ctx.model``),
        bind the client to it — reusing
        the tool's injected default only when it already runs that model AND no
        config override is in play, else constructing one from the resolved key.
        With no model choice, fall back to the injected default (or a client
        built from the resolved key).

        ``LLMClient`` is imported lazily: ``aeva.mcp.base`` is pulled in by the
        prompt package, so a module-level import would risk an import cycle.
        """
        from aeva.llm.llm_client import LLMClient

        key = ctx.config_key or config_key
        injected = getattr(self, "_llm", None)
        if ctx.model:
            if (
                injected is not None
                and injected.model == ctx.model
                and ctx.config_key is None
            ):
                return injected
            return LLMClient(model=ctx.model, config_key=key)
        return injected or LLMClient(config_key=key)

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
