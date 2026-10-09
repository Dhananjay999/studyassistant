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
from aeva.quiz.exam_patterns import TARGET_EXAMS

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
{EXAM_PATTERN}{SOURCE_CONTEXT}
Use the attached study material if provided; otherwise generate the quiz from the topic. If the topic is vague, infer it from the recent context.

When SOURCE CONTEXT is present (content Aeva produced earlier in this turn, or excerpts from the student's files), every question MUST be answerable from it: never test facts absent from it, prefer its terminology and numbers, and spread the questions across all of it rather than clustering on one part.

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
* `short_answer` — a question the student answers in their own words, in one to three sentences (a definition, a reason, a short explanation, or a short worked result). `options` and `correct_answers` MUST both be `[]`. Put a complete model answer (one to three sentences) in `model_answer`, and put 2 to 4 key points in `rubric`: each one a short, separately checkable fact or step that a full-mark answer must contain, not a restatement of the question. Only use this type when it is requested.

Generate exactly the requested number of questions using only the requested question type(s). Cover the topic broadly, use plausible distractors, and include a brief explanation for each question.

**Keep answers unguessable:**

* `true_false` — make about half of the statements false.
* `multi_select` — vary how many options are correct (from two up to all but two where the material allows); never make every option except one correct, and make each wrong option plausible.
* The options are shuffled before the student sees them: never refer to an option by its letter, number or position ("Option B", "the first option"), and avoid "All of the above" / "None of the above".
* Write each question so it stands on its own: do not refer to "the material", "the notes" or "the flashcards".

Before returning, VERIFY each question: every `correct_answers` value exactly matches one of its `options`, and the count of correct answers obeys the type rule above (single_select and true_false have exactly one). A `short_answer` question has no options: check instead that it has a `model_answer` and 2 to 4 `rubric` points. Fix any violations before responding.
""",
    defaults={"SYSTEM_PROMPT": SYSTEM_PROMPT_BLOCK},
    optional=("USER_PROFILE", "EXAM_PATTERN", "SOURCE_CONTEXT"),
    markers=("CONVERSATION_CONTEXT",),
    uses_history=True,
    uses_attachments=True,
)


def exam_pattern_segment(exam: str, brief: str = "") -> str:
    """Build the ``{EXAM_PATTERN}`` block for a quiz at an exam's level.

    ``brief`` is the web research on how the exam's previous-year questions
    are asked; empty when research was unavailable, in which case the model
    falls back on what it knows of the pattern.
    """
    guide = (
        f"How {exam} previous-year questions are asked (web research — a "
        f"style guide, not a question bank):\n{brief.strip()}\n"
        if brief.strip()
        else f"Follow the {exam} previous-year pattern as you know it.\n"
    )
    return (
        f"\nTarget exam: {exam} — set EVERY question at the real {exam} "
        f"level and in its style.\n{guide}"
        f"Mirror the formats, phrasing, sub-topic weighting and difficulty "
        f"of {exam} previous-year questions. Write ORIGINAL questions: never "
        f"reproduce a real question verbatim and never claim a question "
        f"appeared in a specific past paper.\n"
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
                            "short_answer",
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
                    # short_answer only (see aeva.quiz.short_answer_grading):
                    # the reference answer and the 2-4 key points it is
                    # graded against. Optional, so other types omit them.
                    "model_answer": {"type": "string"},
                    "rubric": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
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
                    "short_answer",
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
        "target_exam": {
            "type": "string",
            "enum": list(TARGET_EXAMS),
            "description": (
                "Set ONLY when the student wants practice at a specific "
                "exam's level (e.g. 'SSC CGL level quiz on percentages'). "
                "Questions then match how that exam's previous-year "
                "questions are asked, and difficulty is ignored."
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
