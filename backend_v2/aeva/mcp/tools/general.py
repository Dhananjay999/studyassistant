"""General-answer tool: answer study questions from the model's own knowledge.

The default text answerer. Unlike ``web_search`` it never grounds in a live
web search — it replies straight from Aeva's knowledge and the conversation, so
greetings, questions about Aeva/StudyAssistant, concept explanations, tutoring,
and follow-ups don't trigger a needless search. The planner picks this tool
whenever Aeva can answer confidently without external, up-to-date information.
"""

from collections.abc import Generator
from typing import Any

from aeva.llm import prompts
from aeva.llm.llm_client import LLMClient
from aeva.mcp.base import (
    RESPONSE_NORMAL,
    BaseTool,
    ToolContext,
    ToolDefinition,
)


class GeneralAnswerTool(BaseTool):
    """Answer study questions directly, without a web search."""

    def __init__(self, llm: LLMClient | None = None) -> None:
        self._llm = llm

    @property
    def llm(self) -> LLMClient:
        """Lazy LLM client (same model family as web search, minus grounding)."""
        return self._llm or LLMClient(config_key="LLM_WEB_SEARCH_MODEL")

    @property
    def definition(self) -> ToolDefinition:
        """Tool metadata."""
        return ToolDefinition(
            name="general",
            description=(
                "Answer directly from your own knowledge and the conversation "
                "— no web search. Use for greetings, casual chat, questions "
                "about Aeva/StudyAssistant, concept explanations, tutoring, "
                "brainstorming, and follow-ups. This is the default answerer."
            ),
            parameters_schema=prompts.GENERAL_ANSWER_PARAMS,
        )

    @property
    def response_type(self) -> str:
        """A plain conversational answer."""
        return RESPONSE_NORMAL

    def execute(self, ctx: ToolContext, params: dict[str, Any]) -> dict[str, Any]:
        """Answer without web grounding."""
        query = params.get("query") or ctx.enriched_message
        rendered = prompts.PromptBuilder.build(
            prompts.GENERAL_ANSWER_TEMPLATE,
            USER_MESSAGE=query,
            USER_PROFILE=prompts.user_profile_segment(ctx.personalization),
        )
        answer = self.llm.generate(
            rendered.user_message,
            system_prompt=rendered.system_prompt,
            history=ctx.history,
        )
        return {"answer": answer, "sources": []}

    def can_stream(self) -> bool:
        """General answers stream token-by-token."""
        return True

    def execute_stream(
        self,
        ctx: ToolContext,
        params: dict[str, Any],
    ) -> Generator[str, None, dict[str, Any]]:
        """Stream the answer, returning answer + (empty) sources at the end."""
        llm = self.llm
        query = params.get("query") or ctx.enriched_message
        rendered = prompts.PromptBuilder.build(
            prompts.GENERAL_ANSWER_TEMPLATE,
            USER_MESSAGE=query,
            USER_PROFILE=prompts.user_profile_segment(ctx.personalization),
        )
        answer = ""
        for chunk in llm.generate_stream(
            rendered.user_message,
            system_prompt=rendered.system_prompt,
            history=ctx.history,
        ):
            answer += chunk
            yield chunk
        return {"answer": answer, "sources": []}
