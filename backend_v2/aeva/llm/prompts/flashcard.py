"""Flashcard contracts: generation prompt, output schema, and tool params.

The generation output (``FLASHCARD_GENERATION_SCHEMA``) is provider-independent:
any provider must return JSON matching this shape so the response structure
stays stable across models/vendors.
"""

FLASHCARD_GENERATION_PROMPT = """Create study flashcards for a student.

Topic: {topic}
Number of cards: {count}
Student context: {context}

Source of truth (in priority order):
- If study material (PDF/image) is attached, base the cards on that material.
- Otherwise use the topic above. If the topic is vague or generic (e.g. just
  "make flashcards"), infer the actual subject from the recent conversation.

Requirements:
- Each card has a concise FRONT (a question, term, or concept) and a clear
  BACK (the answer or explanation).
- Add a short, concrete EXAMPLE on the back when it aids understanding;
  otherwise leave example empty.
- Keep cards atomic — one idea per card.
- Write student-friendly, exam-ready language.
"""

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
