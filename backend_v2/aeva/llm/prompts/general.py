"""General-answer tool contract: answer from Aeva's own knowledge, no search.

This is the default text answerer. It mirrors ``web_search`` but does NOT hit
the web: it answers greetings, casual conversation, questions about Aeva /
StudyAssistant, concept explanations, tutoring, brainstorming, and follow-ups
straight from the model's own knowledge and the conversation so far. The
planner reserves ``web_search`` for questions that genuinely need external or
up-to-date information (see ``orchestrator``).
"""

from aeva.llm.prompts.blocks import (
    ANSWER_META_BLOCK,
    SYSTEM_PROMPT_BLOCK,
    TEACHING_BLOCK,
)
from aeva.llm.prompts.builder import PromptTemplate

GENERAL_ANSWER_TEMPLATE = PromptTemplate(
    name="general_answer",
    system="{SYSTEM_PROMPT}{TEACHING}{USER_PROFILE}",
    user="""{CONVERSATION_CONTEXT}
Answer the student as Aeva, using your own knowledge and the conversation so far.

Answer directly and confidently from what you know. You cannot browse the web in this reply, so never claim to have searched or checked a source. Questions about who you are are answered from your identity: you are Aeva, the AI study companion inside StudyAssistant.

Today's date: {CURRENT_DATE}. If the question hinges on current products, prices, versions, rankings, schedules, or events, say plainly that your information may be out of date and offer to search the web for the latest — never guess specs, prices, or dates.

Student question:
{USER_MESSAGE}
{ANSWER_META}""",
    defaults={
        "SYSTEM_PROMPT": SYSTEM_PROMPT_BLOCK,
        "TEACHING": TEACHING_BLOCK,
        "ANSWER_META": ANSWER_META_BLOCK,
    },
    optional=("USER_PROFILE",),
    markers=("CONVERSATION_CONTEXT",),
    uses_history=True,
)

# MCP tool input schema (what the planner fills in to call this tool).
GENERAL_ANSWER_PARAMS: dict = {
    "type": "object",
    "properties": {
        "query": {
            "type": "string",
            "description": "The question to answer",
        },
    },
    "required": ["query"],
}
