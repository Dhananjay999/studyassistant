"""Flashcard contracts: generation prompt, output schema, and tool params.

The generation output (``FLASHCARD_GENERATION_SCHEMA``) is provider-independent:
any provider must return JSON matching this shape so the response structure
stays stable across models/vendors.
"""

FLASHCARD_GENERATION_PROMPT = """Create study flashcards as Aeva.

Topic: {topic}
Number of cards: {count}
Recent context: {context}

SOURCE OF TRUTH (priority order)
1. If study material (PDF/image) is attached, base the cards on that
   material.
2. Otherwise use the Topic above.
3. If the Topic is vague (e.g. just "make flashcards"), infer the real
   subject from the recent context.

WRITE GOOD CARDS
- One idea per card. The FRONT is a single question, term, or prompt; the
  BACK is the precise answer or explanation.
- Keep the front short and unambiguous — it should have exactly one clear
  answer, not invite an essay.
- Put a short, concrete EXAMPLE on the back only when it aids recall;
  otherwise leave example empty.
- Cover the key facts, definitions, and relationships of the topic; do not
  pad with near-duplicate cards.
- Use exam-ready, student-friendly language; keep terms, formulas, and code
  in their standard form.

Good card: front "What does ACID stand for in databases?" / back
"Atomicity, Consistency, Isolation, Durability".
Bad card: front "Tell me everything about ACID" — too broad for one card.
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
