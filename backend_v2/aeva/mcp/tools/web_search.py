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
                "Search the web for current or general knowledge answers. "
                "Use when no uploaded media is needed."
            ),
            parameters_schema=prompts.WEB_SEARCH_PARAMS,
        )

    @property
    def response_type(self) -> str:
        """Grounded web answers are their own response category."""
        return RESPONSE_WEB_SEARCH

    def execute(self, ctx: ToolContext, params: dict[str, Any]) -> dict[str, Any]:
        """Run web search grounded generation."""
        query = params.get("query") or ctx.enriched_message
        prompt = (
            prompts.WEB_SEARCH_PROMPT.format(query=query)
            + prompts.ANSWER_META_INSTRUCTION
        )
        answer = self.llm.generate(
            prompt,
            system_prompt=prompts.personalize(
                prompts.SYSTEM_PROMPT, ctx.personalization
            ),
            use_search=True,
            history=ctx.history,
        )
        return {
            "answer": answer,
            "sources": self.llm.last_sources,
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
        llm = self.llm
        query = params.get("query") or ctx.enriched_message
        prompt = (
            prompts.WEB_SEARCH_PROMPT.format(query=query)
            + prompts.ANSWER_META_INSTRUCTION
        )
        answer = ""
        for chunk in llm.generate_stream(
            prompt,
            system_prompt=prompts.personalize(
                prompts.SYSTEM_PROMPT, ctx.personalization
            ),
            use_search=True,
            history=ctx.history,
        ):
            answer += chunk
            yield chunk
        return {"answer": answer, "sources": llm.last_sources}
