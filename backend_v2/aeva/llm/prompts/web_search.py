"""Web search tool contract: the complete prompt template + MCP parameters.

``WEB_SEARCH_TEMPLATE`` below IS the prompt the model receives — system
channel, conversation marker, tool rules, user message, and the metadata
trailer — with every ``{PLACEHOLDER}`` resolved by :class:`PromptBuilder`.
"""

from aeva.llm.prompts.blocks import ANSWER_META_BLOCK, SYSTEM_PROMPT_BLOCK
from aeva.llm.prompts.builder import PromptTemplate

WEB_SEARCH_TEMPLATE = PromptTemplate(
    name="web_search",
    system="{SYSTEM_PROMPT}{USER_PROFILE}",
    user="""{CONVERSATION_CONTEXT}
Answer the student's question as Aeva.

Google Search is available. Use it only when it improves the answer.

Search for:
- Current, time-sensitive, or changing information (e.g. news, prices, dates, statistics, "latest", "current").
- Facts that require verification.

Answer directly from your knowledge for well-known concepts (e.g. recursion, photosynthesis), using search only to verify details if helpful.

When using search results:
- Prefer reliable, authoritative sources.
- Mention the source naturally when citing information.
- If reliable sources disagree or remain uncertain, say so instead of guessing.

Student question:
{USER_MESSAGE}
{ANSWER_META}""",
    defaults={
        "SYSTEM_PROMPT": SYSTEM_PROMPT_BLOCK,
        "ANSWER_META": ANSWER_META_BLOCK,
    },
    optional=("USER_PROFILE",),
    markers=("CONVERSATION_CONTEXT",),
    uses_history=True,
)

# MCP tool input schema (what the planner fills in to call this tool).
WEB_SEARCH_PARAMS: dict = {
    "type": "object",
    "properties": {
        "query": {
            "type": "string",
            "description": "The question to search and answer",
        },
    },
    "required": ["query"],
}
