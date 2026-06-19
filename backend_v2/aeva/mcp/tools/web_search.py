"""Web search tool using Gemini Google Search grounding."""

from typing import Any

from aeva.llm.llm_client import LLMClient
from aeva.llm import prompts
from aeva.mcp.base import BaseTool, ToolContext, ToolDefinition


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
            parameters_schema={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The question to search and answer",
                    },
                },
                "required": ["query"],
            },
        )

    def execute(self, ctx: ToolContext, params: dict[str, Any]) -> dict[str, Any]:
        """Run web search grounded generation."""
        query = params.get("query") or ctx.enriched_message
        prompt = prompts.WEB_SEARCH_PROMPT.format(query=query)
        answer = self.llm.generate(prompt, use_search=True, history=ctx.history)
        return {
            "answer": answer,
            "sources": self.llm.last_sources,
        }
