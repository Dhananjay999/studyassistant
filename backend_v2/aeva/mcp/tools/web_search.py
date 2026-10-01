"""Web search tool using Gemini Google Search grounding."""

from collections.abc import Generator
from typing import Any

from aeva.llm import prompts
from aeva.llm.llm_client import LLMClient
from aeva.mcp.base import (
    RESPONSE_WEB_SEARCH,
    BaseTool,
    ToolContext,
    ToolDefinition,
)
from aeva.tracing.services import tool_trace


class WebSearchTool(BaseTool):
    """Search the web and answer study questions."""

    def __init__(self, llm: LLMClient | None = None) -> None:
        self._llm = llm

    @property
    def llm(self) -> LLMClient:
        """Lazy LLM client."""
        return self._llm or LLMClient(config_key="LLM_WEB_SEARCH_MODEL")

    @property
    def definition(self) -> ToolDefinition:
        """Tool metadata."""
        return ToolDefinition(
            name="web_search",
            description=(
                "Search the web for external or up-to-date information: "
                "news and events, live prices/scores, releases, current "
                "dates/schedules, and questions ABOUT a real-world product, "
                "service, college or exam — recommendations ('best X'), "
                "comparisons ('X vs Y'), specs, reviews, prices, rankings. "
                "Timeless subject matter and pasted exam questions to "
                "answer belong to `general`."
            ),
            parameters_schema=prompts.WEB_SEARCH_PARAMS,
        )

    @property
    def response_type(self) -> str:
        """Grounded web answers are their own response category."""
        return RESPONSE_WEB_SEARCH

    @staticmethod
    @tool_trace.search_intent
    def _render(
        ctx: ToolContext, params: dict[str, Any]
    ) -> tuple[prompts.RenderedPrompt, str, str]:
        """Resolve the query + intent and render the prompt once.

        The student's message is always sent in full; the planner's
        ``query`` only rides along as the search restatement.
        """
        query = params.get("query") or ctx.enriched_message
        intent = params.get("search_intent")
        if intent not in prompts.SEARCH_INTENTS:
            intent = prompts.guess_search_intent(query)
        rendered = prompts.PromptBuilder.build(
            prompts.WEB_SEARCH_TEMPLATE,
            USER_MESSAGE=ctx.enriched_message,
            PLANNER_NOTE=prompts.planner_note_segment(
                ctx.enriched_message, params.get("query")
            ),
            USER_PROFILE=prompts.user_profile_segment(ctx.personalization),
            SEARCH_MODE=prompts.search_mode_block(intent),
            CURRENT_DATE=prompts.current_date(),
        )
        return rendered, query, str(intent)

    def execute(self, ctx: ToolContext, params: dict[str, Any]) -> dict[str, Any]:
        """Run web search grounded generation."""
        rendered, _query, intent = self._render(ctx, params)
        llm = self.resolve_llm(ctx, "LLM_WEB_SEARCH_MODEL")
        answer = llm.generate(
            rendered.user_message,
            system_prompt=rendered.system_prompt,
            use_search=True,
            history=ctx.history,
        )
        return {
            "answer": answer,
            "sources": llm.last_sources,
            "search_intent": intent,
        }

    def can_stream(self) -> bool:
        """Web search answers stream token-by-token."""
        return True

    def execute_stream(
        self,
        ctx: ToolContext,
        params: dict[str, Any],
    ) -> Generator[str, None, dict[str, Any]]:
        """Stream the grounded answer, returning answer + sources at the end."""
        llm = self.resolve_llm(ctx, "LLM_WEB_SEARCH_MODEL")
        rendered, _query, intent = self._render(ctx, params)
        answer = ""
        for chunk in llm.generate_stream(
            rendered.user_message,
            system_prompt=rendered.system_prompt,
            use_search=True,
            history=ctx.history,
        ):
            answer += chunk
            yield chunk
        return {
            "answer": answer,
            "sources": llm.last_sources,
            "search_intent": intent,
        }
