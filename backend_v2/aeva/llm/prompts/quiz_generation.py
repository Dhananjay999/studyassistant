"""Quiz generation contract: prompt template, output schema, tool params.

``QUIZ_GENERATION_TEMPLATE`` below IS the prompt the model receives — system
channel, conversation marker, the request parameters, and the generation
rules. Study material, when the quiz is built from uploads, travels as
provider binary attachments (``uses_attachments``), not inline text.

``QUIZ_GENERATION_SCHEMA`` is provider-independent: any provider must return
JSON matching it so the quiz structure stays stable across models/vendors.
"""

from aeva.llm.prompts.blocks import SYSTEM_PROMPT_BLOCK
from aeva.llm.prompts.builder import PromptTemplate

QUIZ_GENERATION_TEMPLATE = PromptTemplate(
    name="quiz_generation",
    system="{SYSTEM_PROMPT}{USER_PROFILE}",
    user="""{CONVERSATION_CONTEXT}
Create a study quiz as Aeva.

Topic: {TOPIC}
Question count: {QUESTION_COUNT}
Difficulty: {DIFFICULTY}
Question types: {QUESTION_TYPES}
Recent context: {RECENT_CONTEXT}
Additional instructions: {ADDITIONAL_INSTRUCTIONS}

Use the attached study material if provided; otherwise generate the quiz from the topic. If the topic is vague, infer it from the recent context.

Requirements:

**Resolve the topic first:**

1. Use the current request.
2. If it's generic (e.g. "Generate a quiz"), infer the topic from recent conversation.
3. Prefer any mentioned exam, subject, chapter, section, study goal, or attached study material.
4. If study material is attached, use it unless the user requests another topic.

If the topic is an **exam** (SSC CGL, UPSC, NEET, JEE, CAT, GATE, etc.), generate questions that match the exam's syllabus, section, pattern, and requested difficulty—not generic school GK.

Difficulty is relative to the target level (higher = harder, more reasoning, more distractor subtlety):

* beginner = gentle, foundational recall for someone new to the topic
* easy = basic exam-level recall
* medium = application of concepts
* hard = multi-step reasoning
* expert = advanced synthesis, subtle traps, exam-topper level

**Question type rules (MUST hold for every question):**

* `single_select` — `options` has 3–5 choices; `correct_answers` MUST contain EXACTLY ONE value. Never mark two options correct for this type.
* `multi_select` — `options` has 3–6 choices; `correct_answers` contains ONE OR MORE values, and should genuinely have more than one where the material supports it. If only one answer is correct, use `single_select` instead.
* `true_false` — `options` MUST be exactly `["True", "False"]`; `correct_answers` MUST be exactly one of them (`["True"]` or `["False"]`).

Generate exactly the requested number of questions using only the requested question type(s). Cover the topic broadly, use plausible distractors, and include a brief explanation for each question.

Before returning, VERIFY each question: every `correct_answers` value exactly matches one of its `options`, and the count of correct answers obeys the type rule above (single_select and true_false have exactly one). Fix any violations before responding.
""",
    defaults={"SYSTEM_PROMPT": SYSTEM_PROMPT_BLOCK},
    optional=("USER_PROFILE",),
    markers=("CONVERSATION_CONTEXT",),
    uses_history=True,
    uses_attachments=True,
)

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
            "enum": ["beginner", "easy", "medium", "hard", "expert"],
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
        "exam_config": {
            "type": "object",
            "description": (
                "Exam Mode config the student chose in the setup form "
                "(marking scheme + timer). Opaque passthrough — persisted with "
                "the quiz and used only for scoring/display, never for "
                "generating questions."
            ),
        },
    },
    "required": ["topic"],
}
