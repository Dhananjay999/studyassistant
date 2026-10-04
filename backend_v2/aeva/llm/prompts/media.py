"""Media tool contract: the complete RAG prompt template + MCP parameters.

The media tool no longer attaches whole files to the LLM. It retrieves the
most relevant chunks from the uploaded material (pgvector similarity search)
and grounds the answer in those excerpts, which is what lets every claim cite a
specific document and page.

``MEDIA_TEMPLATE`` below IS the prompt the model receives — system channel,
conversation marker, retrieved excerpts, citation rules, user message, and the
metadata trailer. ``{DOCUMENT_CONTEXT}`` carries the numbered excerpt block
(``"(none)"`` on the direct-attachment fallback path, where the files travel
as provider binary parts instead). ``{ATTACHED_FILES}`` is optional: it names
files sent whole (images, not-yet-indexed docs) next to the excerpts.
"""

from aeva.llm.prompts.blocks import (
    ANSWER_META_BLOCK,
    SYSTEM_PROMPT_BLOCK,
    TEACHING_BLOCK,
)
from aeva.llm.prompts.builder import PromptTemplate

MEDIA_TEMPLATE = PromptTemplate(
    name="media_llm",
    system="{SYSTEM_PROMPT}{TEACHING}{USER_PROFILE}",
    user="""{CONVERSATION_CONTEXT}
Answer the student's question as Aeva using the retrieved excerpts.

Retrieved Excerpts:
{DOCUMENT_CONTEXT}
{ATTACHED_FILES}
Student Question:
{USER_MESSAGE}
{PLANNER_NOTE}
Rules:
- The excerpts are fragments of the student's files, not the whole files. If a term or fact appears in ANY excerpt, use it — never say the material "doesn't mention" something an excerpt contains.
- Answer every part of the question the excerpts support, citing each statement immediately after it using:
  [cite:<document name>#<page number>]
- Copy the document name and page exactly as shown in the excerpt label; use [cite:<document name>] when no page is shown. Never use numeric citations like [1], and never cite a document that is not in the excerpts.
- Files listed as attached in full are complete documents: read them directly and cite them by their name.
- If part of the question is NOT covered by the excerpts, say in one line exactly what the materials do not cover, and only then add general knowledge under a short "Beyond your materials" line, without citations.
- Prefer the material's own terminology, numbers, and definitions over general knowledge.
- Be concise, accurate, and specific to the uploaded material.
{ANSWER_META}""",
    defaults={
        "SYSTEM_PROMPT": SYSTEM_PROMPT_BLOCK,
        "TEACHING": TEACHING_BLOCK,
        "ANSWER_META": ANSWER_META_BLOCK,
    },
    optional=("USER_PROFILE", "ATTACHED_FILES", "PLANNER_NOTE"),
    markers=("CONVERSATION_CONTEXT",),
    uses_history=True,
    uses_attachments=True,
)


def attached_files_block(labels: list[str]) -> str:
    """Resolve ``{ATTACHED_FILES}`` for files sent whole alongside excerpts.

    Images (never chunked) and documents that are not indexed yet travel as
    binary parts in the same call. Naming them here tells the model those
    files are the complete material — not excerpts — so it reads them fully.
    Empty when nothing is attached, keeping excerpt-only prompts unchanged.
    """
    if not labels:
        return ""
    listed = "\n".join(f"- {label}" for label in labels)
    return (
        "\nAlso attached in full (read these files directly — they are "
        f"not excerpts):\n{listed}\n"
    )


PROCESSING_MESSAGE = (
    "Your file is still being processed — give it a moment and ask again, "
    "or ask a general question meanwhile."
)

def no_context_message(
    query: str, file_names: list[str], sections: list[str]
) -> str:
    """Friendly "nothing matched" reply that says what the files DO cover.

    Names the files that were searched and lists a few of their section
    titles so the student can re-aim the question (or ask for general
    knowledge instead) rather than hitting a dead end.
    """
    files = ", ".join(f"**{name}**" for name in file_names) or "your files"
    asked = query.strip().rstrip("?")
    text = f"I looked through {files} but couldn't find anything about"
    text += f" \u201c{asked}\u201d." if asked else " that."
    if sections:
        text += " They cover: " + " \u00b7 ".join(sections) + "."
    text += (
        " Try rephrasing with the words your notes use, or ask me to answer "
        "from general knowledge instead."
    )
    return text


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
