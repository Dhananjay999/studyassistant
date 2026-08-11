"""Product-info tool contract: app knowledge as an intent-routed prompt.

The single home for StudyAssistant product copy. The planner routes questions
about the app itself ("what can you do?", "how do I upload a PDF?") to the
``product_info`` tool, whose template carries ``PRODUCT_KNOWLEDGE`` below —
so no other LLM call ever pays tokens for it. Academic questions never land
here (see the planner's TOOL SELECTION rules).

Follow-up idea (not built): render this block flag-aware from
``feature_flag_service.get_flags()`` so a disabled feature (web search, image
generation) is omitted instead of described.
"""

from aeva.llm.prompts.blocks import ANSWER_META_BLOCK, SYSTEM_PROMPT_BLOCK
from aeva.llm.prompts.builder import PromptTemplate

PRODUCT_KNOWLEDGE = """StudyAssistant features (the app Aeva lives in):
- Media Library: students upload PDFs, photos, and notes (right sidebar or the attach button in the chat box). Aeva reads uploads and answers from them — including specific textbook pages, once uploaded.
- Quizzes: ask Aeva for a quiz on any topic (or from uploaded material). A setup form lets the student pick question count, difficulty, question types, and Exam Mode (marking scheme + timer). Quizzes open in a side panel, get scored with AI feedback, and are saved on the Quizzes page.
- Flashcards: Aeva generates revision-card sets from any topic, answer, or upload; saved on the Flashcards page.
- Images & diagrams: Aeva can draw labeled educational diagrams, mind maps, and illustrations; generated images are saved to the Media Library.
- Web search: for current/up-to-date questions, Aeva searches the web and cites sources inline.
- Study Spaces: dedicated workspaces per subject; chats, files, and quizzes filed into a Space stay organized, and Aeva remembers recent quiz results and weak topics inside that Space.
- Chats & history: every chat is saved and resumable from the sidebar; a chat's memory is per-chat (new chats start fresh).
- Notes & bookmarks: any answer can be saved as a note or bookmarked to revisit or resume later.
- Revision: tracks streaks and topics due for revision, with personalized recommendations on the home screen.
- Settings → Learning Profile: preferred language (English/Hindi/Hinglish), education level, explanation style, and other lasting preferences — this is where preferences persist across chats."""

PRODUCT_INFO_TEMPLATE = PromptTemplate(
    name="product_info",
    system="{SYSTEM_PROMPT}{USER_PROFILE}",
    user="""{CONVERSATION_CONTEXT}
{PRODUCT_KNOWLEDGE}

Answer the student's question about the StudyAssistant app or Aeva's capabilities using ONLY the product knowledge above.
- Answer just what was asked, with concrete steps (where to click, what happens).
- Never describe other software (e.g. Word, Google Docs) and never invent features not listed.
- If asked what you can do, summarize the features warmly and briefly.
- If the question turns academic, answer it normally as a tutor.

Student question:
{USER_MESSAGE}
{ANSWER_META}""",
    defaults={
        "SYSTEM_PROMPT": SYSTEM_PROMPT_BLOCK,
        "PRODUCT_KNOWLEDGE": PRODUCT_KNOWLEDGE,
        "ANSWER_META": ANSWER_META_BLOCK,
    },
    optional=("USER_PROFILE",),
    markers=("CONVERSATION_CONTEXT",),
    uses_history=True,
)

# MCP tool input schema (what the planner fills in to call this tool).
PRODUCT_INFO_PARAMS: dict = {
    "type": "object",
    "properties": {
        "query": {
            "type": "string",
            "description": "The question about the app or Aeva's features",
        },
    },
    "required": ["query"],
}
