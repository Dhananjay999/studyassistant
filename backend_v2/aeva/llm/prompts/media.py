"""Media tool contract: RAG prompt and MCP input parameters.

The media tool no longer attaches whole files to the LLM. It retrieves the
most relevant chunks from the uploaded material (pgvector similarity search)
and grounds the answer in those excerpts, which is what lets every claim cite a
specific document and page.
"""

MEDIA_PROMPT = """
Answer the student's question as Aeva using the retrieved excerpts.

Retrieved Excerpts:
{context}

Student Question:
{query}

Rules:
- Base your answer on the retrieved excerpts.
- Cite every statement supported by the excerpts immediately after it using:
  [cite:<document name>#<page number>]
- Copy the document name and page exactly as shown in the excerpt label.
- If no page is available, use:
  [cite:<document name>]
- Never use numeric citations like [1].
- Prefer information from the uploaded material over general knowledge.
- If the excerpts do not answer the question, clearly say so, then provide general knowledge separately without citations.
- Be concise, accurate, and specific to the uploaded material.
"""

NO_CONTEXT_MESSAGE = (
    "I couldn't find information about that in your uploaded study materials. "
    "Try rephrasing your question or ask a general question instead."
)

NO_MEDIA_MESSAGE = (
    "No study materials are available. Upload a PDF or image, or ask a general question."
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
