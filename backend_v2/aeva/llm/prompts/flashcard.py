"""Flashcard contract: prompt template, output schema, and tool params.

``FLASHCARD_GENERATION_TEMPLATE`` below IS the prompt the model receives —
system channel, conversation marker, request parameters, and generation rules.
Study material, when the cards are built from uploads, travels as provider
binary attachments (``uses_attachments``), not inline text.

The generation output (``FLASHCARD_GENERATION_SCHEMA``) is provider-independent:
any provider must return JSON matching this shape so the response structure
stays stable across models/vendors.
"""

from aeva.llm.prompts.blocks import SYSTEM_PROMPT_BLOCK
from aeva.llm.prompts.builder import PromptTemplate

FLASHCARD_GENERATION_TEMPLATE = PromptTemplate(
    name="flashcard_generation",
    system="{SYSTEM_PROMPT}{USER_PROFILE}",
    user="""{CONVERSATION_CONTEXT}
Create study flashcards as Aeva.

Topic: {TOPIC}
Card count: {CARD_COUNT}
Recent context: {RECENT_CONTEXT}

Use the attached study material if provided; otherwise generate the cards from the topic. If the topic is vague, infer it from the recent context.

Requirements:
- Generate exactly {CARD_COUNT} flashcards.
- Each card covers one concept only.
- Front: a short question, term, or prompt with one clear answer.
- Back: a concise answer or explanation.
- Include an example only when it improves understanding; otherwise leave it empty.
- Cover the most important concepts without creating duplicate or overlapping cards.
- Use clear, exam-ready language.
- Keep formulas, code, technical terms, and proper nouns unchanged.
""",
    defaults={"SYSTEM_PROMPT": SYSTEM_PROMPT_BLOCK},
    optional=("USER_PROFILE",),
    markers=("CONVERSATION_CONTEXT",),
    uses_history=True,
    uses_attachments=True,
)

# Structured output for flashcard generation.
FLASHCARD_GENERATION_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "topic": {"type": "string"},
        "cards": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "front": {"type": "string"},
                    "back": {"type": "string"},
                    "example": {"type": "string"},
                },
                "required": ["front", "back"],
            },
        },
    },
    "required": ["title", "topic", "cards"],
}

# MCP tool input schema (what the planner fills in to call this tool).
FLASHCARD_GENERATOR_PARAMS: dict = {
    "type": "object",
    "properties": {
        "topic": {
            "type": "string",
            "description": (
                "Flashcard subject. If the user didn't name one, infer it "
                "from the main subject of the recent conversation."
            ),
        },
        "use_media": {
            "type": "boolean",
            "description": (
                "Set true to build the cards from the user's uploaded "
                "material instead of a topic."
            ),
        },
        "count": {
            "type": "integer",
            "description": "Number of cards (default 8)",
        },
    },
    "required": ["topic"],
}
