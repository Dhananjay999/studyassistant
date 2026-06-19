"""Schema for post-quiz AI feedback."""

QUIZ_FEEDBACK_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "weak_topics": {
            "type": "array",
            "items": {"type": "string"},
        },
        "recommendations": {
            "type": "array",
            "items": {"type": "string"},
        },
        "per_question": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "question_id": {"type": "string"},
                    "explanation": {"type": "string"},
                },
                "required": ["question_id", "explanation"],
            },
        },
    },
    "required": ["summary", "weak_topics", "recommendations", "per_question"],
}
