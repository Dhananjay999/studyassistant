"""Web search tool contract: prompt and MCP input parameters."""

WEB_SEARCH_PROMPT = """Use Google Search to find current, accurate information and
answer the student's question. Prefer reliable sources, and mention the source
website naturally when you reference specific facts.

Student question: {query}
"""

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
