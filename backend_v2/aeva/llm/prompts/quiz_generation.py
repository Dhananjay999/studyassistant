"""Quiz generation contract: prompt, structured-output schema, tool params.

``QUIZ_GENERATION_SCHEMA`` is provider-independent: any provider must return
JSON matching it so the quiz structure stays stable across models/vendors.
"""

QUIZ_GENERATION_PROMPT = """
Create a study quiz as Aeva.

Topic: {topic}
Question count: {count}
Difficulty: {difficulty}
Question types: {types}
Recent context: {context}
Additional instructions: {instructions}

Use the attached study material if provided; otherwise generate the quiz from the topic. If the topic is vague, infer it from the recent context.

Requirements:
- Generate exactly {count} questions.
- Use only these question types: {types}.
- single_select: exactly one correct answer.
- multi_select: two or more correct answers.
- true_false: options must be exactly ["True", "False"].
- Every value in correct_answers must exactly match an option.
- Match the requested difficulty:
  - easy: recall
  - medium: application
  - hard: reasoning
- Test understanding, not memorization.
- Make distractors plausible.
- Avoid giveaway wording.
- Include a brief explanation for every question.
- Follow any additional instructions when provided.
"""

# Structured output for quiz generation.
QUIZ_GENERATION_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "topic": {"type": "string"},
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "type": {
                        "type": "string",
                        "enum": [
                            "single_select",
                            "multi_select",
                            "true_false",
                        ],
                    },
                    "prompt": {"type": "string"},
                    "options": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "correct_answers": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "explanation": {"type": "string"},
                },
                "required": [
                    "id",
                    "type",
                    "prompt",
                    "options",
                    "correct_answers",
                ],
            },
        },
    },
    "required": ["title", "topic", "questions"],
}

# MCP tool input schema (what the planner fills in to call this tool).
QUIZ_GENERATOR_PARAMS: dict = {
    "type": "object",
    "properties": {
        "topic": {
            "type": "string",
            "description": (
                "Quiz subject. If the user didn't name one, infer it from the "
                "main subject of the recent conversation."
            ),
        },
        "use_media": {
            "type": "boolean",
            "description": (
                "Set true to build the quiz from the user's uploaded "
                "material instead of a topic."
            ),
        },
        "question_count": {
            "type": "integer",
            "description": "Number of questions (default 5)",
        },
        "difficulty": {
            "type": "string",
            "enum": ["easy", "medium", "hard"],
        },
        "question_types": {
            "type": "array",
            "items": {
                "type": "string",
                "enum": [
                    "single_select",
                    "multi_select",
                    "true_false",
                ],
            },
        },
        "additional_instructions": {
            "type": "string",
            "description": (
                "Extra free-text guidance for the quiz (focus areas, style). "
                "Only set when the student explicitly provides it."
            ),
        },
    },
    "required": ["topic"],
}
