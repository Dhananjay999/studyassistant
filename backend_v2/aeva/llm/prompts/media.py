"""Media tool contract: prompt and MCP input parameters."""

MEDIA_PROMPT = """The student has uploaded study material (PDF or image).
Analyze the content and answer their question based on what you see in the material.
If the answer isn't in the uploaded content, let them know clearly.

Student question: {query}
"""

# MCP tool input schema (what the planner fills in to call this tool).
MEDIA_PARAMS: dict = {
    "type": "object",
    "properties": {
        "query": {
            "type": "string",
            "description": "Question about the uploaded material",
        },
        "media_ids": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Specific media IDs to use",
        },
    },
    "required": ["query"],
}
