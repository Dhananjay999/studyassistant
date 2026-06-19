"""Quiz contracts: generation + feedback prompts, schemas, and tool params.

Both the generation output (``QUIZ_GENERATION_SCHEMA``) and the post-quiz
feedback output (``QUIZ_FEEDBACK_SCHEMA``) are provider-independent: any
provider must return JSON matching these shapes so the response structure
stays stable across models/vendors.
"""

QUIZ_GENERATION_PROMPT = """Create a study quiz for a student.

Topic: {topic}
Number of questions: {count}
Difficulty: {difficulty}
Question types to include: {types}
Student context: {context}

Source of truth (in priority order):
- If study material (PDF/image) is attached, base the quiz on that material.
- Otherwise use the topic above. If the topic is vague or generic (e.g. just
  "make a quiz"), infer the actual subject from the recent conversation.

Requirements:
- Mix question types: single_select, multi_select, true_false.
- For single_select, exactly one correct answer in correct_answers.
- For multi_select, one or more correct answers in correct_answers.
- For true_false, options must be ["True", "False"].
- Use option values that match correct_answers entries.
- Write clear, student-friendly questions.
- Include a brief explanation per question.
"""

QUIZ_FEEDBACK_PROMPT = """A student completed a quiz. Provide helpful learning feedback.

Quiz:
{quiz}

Student answers:
{answers}

Evaluation (backend scored):
{evaluation}

Provide encouraging feedback, explain mistakes, identify weak topics,
and suggest study recommendations.
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

# Structured output for post-quiz AI feedback.
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
    },
    "required": ["topic"],
}
