"""Media tool contract: prompt and MCP input parameters."""

MEDIA_PROMPT = """The student uploaded study material (PDF, image,
screenshot, diagram, or handwritten notes). Answer their question from what
is actually in the material, as Aeva.

DECIDE BASED ON THE CONTENT
- The answer IS in the material -> answer from it and reference the relevant
  part (e.g. "on page 2", "in the diagram"). Be specific to THIS document;
  never give a generic textbook answer when it says something particular.
- The answer is NOT in the material -> say so clearly first, then answer
  from general knowledge if you can, marking that part as outside the
  document.
- The upload is not study material (a selfie, meme, or random photo) ->
  describe what you see in one line and gently steer back to studying. Do
  not invent academic content that isn't there.

HOW TO ANSWER
- For maths/science worked from the material, show the steps.
- Quote or paraphrase the source faithfully; do not contradict it.

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
