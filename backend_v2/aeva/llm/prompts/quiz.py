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

Question types — STRICT:
- Use ONLY these question types: {types}. Do not use any other type.
- If only one type is listed, EVERY question must be exactly that type.
- If multiple types are listed, mix only among those types.

Requirements:
- For single_select, exactly one correct answer in correct_answers.
- For multi_select, two or more correct answers in correct_answers.
- For true_false, options must be ["True", "False"] with one correct answer.
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

QUIZ_ANALYSIS_PROMPT = """A student finished a quiz. Analyze their performance.

Quiz (with correct answers and explanations):
{quiz}

Student answers:
{answers}

Evaluation (backend scored, includes per-question correctness):
{evaluation}

Write an encouraging, specific performance analysis:
- strengths: concepts the student clearly understands (what they got right).
- weaknesses: concepts they struggled with (cite the questions they missed).
- common_mistakes: recurring error patterns you notice across wrong answers.
- revise_topics: concrete topics/subtopics to revise next, most important first.
- study_plan: an ordered, actionable step-by-step plan to close the gaps.

Be concrete and reference the actual questions. Keep each item short.
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

# Structured output for on-demand AI performance analysis.
QUIZ_ANALYSIS_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "strengths": {"type": "array", "items": {"type": "string"}},
        "weaknesses": {"type": "array", "items": {"type": "string"}},
        "common_mistakes": {"type": "array", "items": {"type": "string"}},
        "revise_topics": {"type": "array", "items": {"type": "string"}},
        "study_plan": {"type": "array", "items": {"type": "string"}},
    },
    "required": [
        "strengths",
        "weaknesses",
        "common_mistakes",
        "revise_topics",
        "study_plan",
    ],
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
