"""Product-info tool: answer questions about the StudyAssistant app itself.

Intent-routed app knowledge: the planner sends "what can you do?" and app
how-to questions here, so the product copy (``prompts/product_info.py``) is
paid for only on these turns — never on academic answers or generators. Runs
on the fast model family: app answers are short and fully grounded in the
prompt's own knowledge block.
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


class ProductInfoTool(BaseTool):
    """Answer app/feature questions from the built-in product knowledge."""

    def __init__(self, llm: LLMClient | None = None) -> None:
        self._llm = llm

    @property
    def llm(self) -> LLMClient:
        """Lazy LLM client (fast family — prompt-grounded, no reasoning)."""
        return self._llm or LLMClient(config_key="LLM_FAST_MODEL")

    @property
    def definition(self) -> ToolDefinition:
        """Tool metadata."""
        return ToolDefinition(
            name="product_info",
            description=(
                "Answer questions about the StudyAssistant app and Aeva's "
                "features: what Aeva can do, how to upload material, "
                "quizzes, flashcards, exam mode, Study Spaces, sessions, "
                "notes, revision, and settings. Only for app/feature "
                "questions — never for academic content."
            ),
            parameters_schema=prompts.PRODUCT_INFO_PARAMS,
        )

    @property
    def response_type(self) -> str:
        """A plain conversational answer."""
        return RESPONSE_NORMAL

    def execute(self, ctx: ToolContext, params: dict[str, Any]) -> dict[str, Any]:
        """Answer from the product knowledge block."""
        query = params.get("query") or ctx.enriched_message
        rendered = prompts.PromptBuilder.build(
            prompts.PRODUCT_INFO_TEMPLATE,
            USER_MESSAGE=query,
            USER_PROFILE=prompts.user_profile_segment(ctx.personalization),
        )
        answer = self.resolve_llm(ctx, "LLM_FAST_MODEL").generate(
            rendered.user_message,
            system_prompt=rendered.system_prompt,
            history=ctx.history,
        )
        return {"answer": answer, "sources": []}

    def can_stream(self) -> bool:
        """Product answers stream token-by-token."""
        return True

    def execute_stream(
        self,
        ctx: ToolContext,
        params: dict[str, Any],
    ) -> Generator[str, None, dict[str, Any]]:
        """Stream the answer, returning answer + (empty) sources at the end."""
        llm = self.resolve_llm(ctx, "LLM_FAST_MODEL")
        query = params.get("query") or ctx.enriched_message
        rendered = prompts.PromptBuilder.build(
            prompts.PRODUCT_INFO_TEMPLATE,
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
