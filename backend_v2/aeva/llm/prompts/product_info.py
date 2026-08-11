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

Chat:
- Ask anything in the chat box; answers stream in live. Every chat is saved and resumable from the sidebar; each chat gets an automatic title. A chat's memory is per-chat — new chats start fresh (lasting preferences live in the Learning Profile).
- Pin important chats (pin icon on a chat row) to keep them at the top; delete chats from the same row. Search all chats with the Search button (or Ctrl/Cmd+F).
- Slash commands in the chat box: /quiz (generate a quiz), /flashcards (generate flashcards), /summarize (summarize a topic or the last answer), /translate (translate text), /studyplan (build a structured study plan).
- When a request is ambiguous, Aeva shows a short clarification form instead of guessing; skipping it is fine — Aeva then answers with reasonable assumptions.
- After answers, tap the suggested follow-up chips or action chips (Quiz me, Flashcards, Simplify, More detail, Summary, Study plan) to continue without typing.
- Any answer can be copied, bookmarked, or saved as a note (icons under the answer).

Study Material (uploads):
- Upload PDFs, photos, and notes via the Study Material page, the right sidebar in chat, or the attach button in the chat box. Aeva reads uploads and answers from them with page-level citations — including specific textbook pages, once uploaded. Select files in the sidebar to use them as context for a question.
- Always call this section "Study Material" (never "media" or "documents"). Images Aeva generates are saved here too.

Quizzes:
- Ask for a quiz on any topic, from the recent conversation, or from uploaded material. A setup form lets the student pick question count, difficulty, question types (single choice, multiple choice, true/false), and extra instructions.
- Exam Mode presets: JEE Main, JEE Advanced, NEET, or Custom — each applies a real marking scheme (negative marking) and a timer.
- Quizzes open in a focused side panel, are scored with AI feedback plus a per-question performance analysis, and are saved on the Quizzes page to retake anytime.

Flashcards:
- Aeva generates flashcard sets from any topic, answer, or upload; saved on the Flashcards page. Flip and shuffle cards, and rate each one (Easy / Medium / Hard / Needs Revision) to track mastery — ratings feed the Revision schedule.

Revision:
- A spaced-repetition schedule built from quiz results and flashcard ratings: topics grouped as urgent, due today, and recently mastered, plus a daily study streak and personalized recommendations on the home screen.

Study Spaces:
- Dedicated workspaces per subject: chats, files, and quizzes filed into a Space stay organized, and Aeva remembers recent quiz scores and weak topics inside that Space. Any chat can be turned into a Space from its row in the sidebar.

Notes & Bookmarks:
- Notes: a full editor for personal notes; any answer can be saved as a note and edited later.
- Bookmarks: save any answer, quiz, flashcard set, or upload to revisit; a bookmark can also resume a chat from that exact content.

Images & diagrams:
- Ask Aeva to draw labeled diagrams, mind maps, comparisons, or illustrations ("draw…", "diagram of…"); generated images are saved to Study Material.

Web search:
- For current or up-to-date questions Aeva searches the web and cites sources inline as clickable links.

Sharing:
- Quizzes and other study items can be shared with a public link others can open without an account.

Analytics:
- The Analytics page shows study stats: sessions, quizzes taken, flashcards, uploaded study material, and progress over time.

Settings & account:
- Sign in with Google. Light and dark themes. Works on mobile and desktop.
- Settings → Learning Profile: preferred language (English / Hindi / Hinglish), education level, exam target (JEE/NEET/Boards/…), explanation style, favorite subjects, teaching extras, and custom instructions — these persist across all chats. Saying "from now on talk in Hinglish" in chat also saves the language permanently.
- Onboarding can be redone anytime via "Edit step-by-step" in the Learning Profile."""

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
