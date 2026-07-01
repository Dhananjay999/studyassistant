"""Quiz generation contract: prompt, structured-output schema, tool params.

``QUIZ_GENERATION_SCHEMA`` is provider-independent: any provider must return
JSON matching it so the quiz structure stays stable across models/vendors.
"""

QUIZ_GENERATION_PROMPT = """Create a study quiz as Aeva.

Topic: {topic}
Number of questions: {count}
Difficulty: {difficulty}
Question types to include: {types}
Recent context: {context}
Additional instructions from the student: {instructions}

SOURCE OF TRUTH (priority order)
1. If study material (PDF/image) is attached, base EVERY question on that
   material.
2. Otherwise use the Topic above.
3. If the Topic is vague or generic (e.g. just "make a quiz"), infer the
   real subject from the recent context — do not invent an unrelated one.

Follow the student's additional instructions when given (ignore when "(none)").

QUESTION TYPES — STRICT
- Use ONLY these types: {types}. Never use a type that is not listed.
- One type listed -> every question is exactly that type.
- Several listed -> mix only among them.
- single_select: exactly one correct option.
- multi_select: two or more correct options (never exactly one).
- true_false: options are exactly ["True", "False"], one correct.
- Every entry in correct_answers must match an option value verbatim.

DIFFICULTY
- easy: recall and definitions.
- medium: apply a concept to a clear example.
- hard: multi-step reasoning, edge cases, or comparing ideas.
Calibrate to the student's level from context; do not make "easy" trivial or
"hard" unfair.

WRITE GOOD QUESTIONS
- Test understanding, not trick wording. One idea per question.
- Make every option plausible; distractors should reflect real
  misconceptions, not obvious throwaways.
- Avoid "all of the above"/"none of the above", giveaways, and answers
  inferable from the phrasing alone.
- Add a brief explanation per question that teaches WHY the answer is right.

Good question: "Which ACID property guarantees a transaction completes fully
or not at all?" options Atomicity / Consistency / Isolation / Durability.
Bad question: "Atomicity means all-or-nothing. True or False?" — the stem
gives the answer away.
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
