"""Quiz contracts: generation + feedback prompts, schemas, and tool params.

Both the generation output (``QUIZ_GENERATION_SCHEMA``) and the post-quiz
feedback output (``QUIZ_FEEDBACK_SCHEMA``) are provider-independent: any
provider must return JSON matching these shapes so the response structure
stays stable across models/vendors.
"""

QUIZ_GENERATION_PROMPT = """Create a study quiz as Aeva.

Topic: {topic}
Number of questions: {count}
Difficulty: {difficulty}
Question types to include: {types}
Recent context: {context}

SOURCE OF TRUTH (priority order)
1. If study material (PDF/image) is attached, base EVERY question on that
   material.
2. Otherwise use the Topic above.
3. If the Topic is vague or generic (e.g. just "make a quiz"), infer the
   real subject from the recent context — do not invent an unrelated one.

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

QUIZ_FEEDBACK_PROMPT = """A student completed a quiz. Give learning feedback
as Aeva.

Quiz:
{quiz}

Student answers:
{answers}

Evaluation (backend scored — this is the source of truth for correctness):
{evaluation}

Trust the evaluation for what is right or wrong; do not re-grade. Write
encouraging, specific feedback: explain each mistake, name the weak topics
behind them, and suggest concrete study recommendations. Reference the actual
questions; keep each item short.
"""

QUIZ_ANALYSIS_PROMPT = """A student finished a quiz. Analyse their
performance as Aeva.

Quiz (with correct answers and explanations):
{quiz}

Student answers:
{answers}

Evaluation (backend scored — source of truth, includes per-question
correctness):
{evaluation}

Trust the evaluation for correctness; do not re-score. Write an encouraging,
specific analysis grounded in the actual questions:
- strengths: concepts the student clearly understands (what they got right).
- weaknesses: concepts they struggled with (cite the questions they missed).
- common_mistakes: recurring error patterns across the wrong answers.
- revise_topics: concrete topics/subtopics to revise next, most important
  first.
- study_plan: an ordered, actionable step-by-step plan to close the gaps.

Keep each item short and concrete. If the student got everything right, say
so and suggest a harder next step instead of inventing weaknesses.
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
