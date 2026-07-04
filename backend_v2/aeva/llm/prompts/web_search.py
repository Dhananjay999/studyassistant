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
Answer the student's question as Aeva, grounded in web search.

This is a web-search answer: search the web for the question and base your answer on what you find. Prefer reliable, authoritative sources.

When writing the answer:
- Cite inline: right after a fact that came from the web, add a Markdown link to the source, e.g. "India's population is ~1.43 billion ([Worldometer](https://www.worldometers.info/...))". Use the real source URL, keep the link text short (site or source name), and only cite claims that actually came from a source.
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
