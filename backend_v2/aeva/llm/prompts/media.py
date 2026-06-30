"""Media tool contract: RAG prompt and MCP input parameters.

The media tool no longer attaches whole files to the LLM. It retrieves the
most relevant chunks from the uploaded material (pgvector similarity search)
and grounds the answer in those excerpts, which is what lets every claim cite a
specific document and page.
"""

MEDIA_PROMPT = """You are answering a student's question using ONLY the
excerpts retrieved from their uploaded study material below. Each excerpt is
numbered and labelled with its document, page, and section.

EXCERPTS
{context}

HOW TO ANSWER
- Answer from the excerpts above. Cite the source inline with its bracket
  number and page, e.g. "as covered under scheduling [1] (p.12)".
- Be specific to THIS material; never give a generic textbook answer when the
  excerpts say something particular. For maths/science, show the steps.
- If the excerpts do not contain the answer, say so clearly first, then you may
  add general knowledge, marking that part as outside the document.

Student question: {query}
"""

# Shown when retrieval returns nothing usable for the question.
NO_CONTEXT_MESSAGE = (
    "I couldn't find anything in your uploaded materials that answers this. "
    "Try rephrasing, or ask a general question for web search."
)

# Shown when there is no indexed material to search at all.
NO_MEDIA_MESSAGE = (
    "No study materials were found. Please upload a PDF or image, or ask a "
    "general question for web search."
)

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
