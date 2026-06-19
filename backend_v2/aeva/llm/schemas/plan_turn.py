"""Schema for orchestrator plan_turn structured output."""

PLAN_TURN_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "action": {
            "type": "string",
            "enum": ["clarify", "run_tool"],
        },
        "clarification": {
            "type": "object",
            "properties": {
                "reason": {"type": "string"},
                "questions": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "text": {"type": "string"},
                            "options": {
                                "type": "array",
                                "items": {"type": "string"},
                                "nullable": True,
                            },
                        },
                        "required": ["id", "text"],
                    },
                },
            },
            "required": ["reason", "questions"],
        },
        "tool": {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "enum": [
                        "web_search",
                        "media_llm",
                        "quiz_generator",
                    ],
                },
                "params": {"type": "object"},
            },
            "required": ["name", "params"],
        },
    },
    "required": ["action"],
}
