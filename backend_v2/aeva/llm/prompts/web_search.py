"""Web search tool contract: prompt and MCP input parameters."""

WEB_SEARCH_PROMPT = """
nswer the student's question as Aeva.

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
{query}
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
