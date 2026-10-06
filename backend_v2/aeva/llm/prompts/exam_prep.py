# ruff: noqa: E501 — prompt text reads as one line per rule, like the other
# prompt modules; wrapping it would change what the model receives.
"""Exam Prep contracts: roadmap + day-detail prompts and the coach block.

Two structured calls (no conversation, no metadata trailer):

* ``EXAM_PLAN_TEMPLATE`` — the lightweight day-by-day roadmap built once at
  setup (``ExamPrepService.create_plan``).
* ``EXAM_DAY_DETAIL_TEMPLATE`` — one day's detailed plan, generated lazily
  the first time the student opens that day.

``build_exam_prep_block`` is a plain system-prompt fragment (like
``build_space_block``) appended to the personalization text of an exam-coach
chat turn, so every tool receives it through ``{USER_PROFILE}``.
``EXAM_PREP_QUIZ_INSTRUCTIONS`` is the ``additional_instructions`` text
handed to the quiz generator for exam-topic quizzes.
"""

from datetime import UTC, date, datetime
from typing import Any

from aeva.llm.prompts.blocks import SYSTEM_PROMPT_BLOCK
from aeva.llm.prompts.builder import PromptTemplate

EXAM_PLAN_TEMPLATE = PromptTemplate(
    name="exam_plan",
    system="{SYSTEM_PROMPT}{USER_PROFILE}",
    user="""Build a day-by-day exam study roadmap as Aeva.

Today's date: {CURRENT_DATE}
Exam: {EXAM_NAME} on {EXAM_DATE} ({DAYS_REMAINING} days remaining)
Kind of exam: {EXAM_KIND}
Board / university / conducting body: {BOARD}
Plan length: exactly {TOTAL_DAYS} days (day 1 = today)
Class / grade: {CLASS_LEVEL}
Stream: {STREAM}
Subjects: {SUBJECTS}
Daily study time: {DAILY_MINUTES} minutes
Target score: {TARGET_SCORE}
Specifics from the student: {EXAM_DETAILS}
Syllabus provided by the student:
{SYLLABUS}
Study material uploaded by the student: {MATERIAL_NOTES}

Researched syllabus and exam pattern (from official sources; trust it over
general knowledge, but never over the student's own syllabus above):
{RESEARCH_BRIEF}

Rules:
- Produce exactly {TOTAL_DAYS} days, numbered 1..{TOTAL_DAYS} in order, each with a short title and a one-line focus.
- EVERY day mixes 2-3 subjects (never one subject per day) unless only one subject exists.
- The total est_minutes of a day's topics is about {DAILY_MINUTES} minutes (within 15%).
- 2-6 topics per day. Topic titles are specific syllabus units (e.g. "Newton's laws - free body diagrams"), never vague ("Physics revision").
- Cover every listed subject across the plan, weighting by exam importance; when a syllabus is given, follow it and leave nothing out. Use the researched syllabus to pick the exact units, chapter names and high-weightage areas for THIS exam, class and board.
- The last 10-15% of the days are revision and mock-test days: their topics start with "Revise: ..." or "Mock test: ...".
- Descriptions are concrete (what to study and how), at most 160 characters.
- If the plan covers fewer days than remain before the exam, say so in the summary and plan the first {TOTAL_DAYS} days.
- summary: 2-3 sentences on the strategy; strategy_tips: up to 5 short, practical tips for this exam.
- Respond in the student's response language if one is set in their profile; otherwise English.
""",
    defaults={"SYSTEM_PROMPT": SYSTEM_PROMPT_BLOCK},
    optional=("USER_PROFILE",),
)

# Structured output of the roadmap call.
EXAM_PLAN_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "summary": {
            "type": "string",
            "description": "2-3 sentence strategy summary for the student.",
        },
        "strategy_tips": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Up to 5 short, practical tips.",
        },
        "days": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "day_number": {"type": "integer"},
                    "title": {"type": "string"},
                    "focus": {"type": "string"},
                    "subjects": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "subject": {"type": "string"},
                                "topics": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "title": {"type": "string"},
                                            "description": {"type": "string"},
                                            "est_minutes": {"type": "integer"},
                                        },
                                        "required": [
                                            "title",
                                            "description",
                                            "est_minutes",
                                        ],
                                    },
                                },
                            },
                            "required": ["subject", "topics"],
                        },
                    },
                },
                "required": ["day_number", "title", "focus", "subjects"],
            },
        },
    },
    "required": ["summary", "strategy_tips", "days"],
}

# Web-grounded research run before the roadmap: what the official syllabus
# and paper pattern of THIS exam / class / board actually contain. The plain
# text brief becomes ``{RESEARCH_BRIEF}`` of ``EXAM_PLAN_TEMPLATE`` — a
# source of exact unit names and weightage, never a plan by itself.
EXAM_SYLLABUS_RESEARCH_TEMPLATE = PromptTemplate(
    name="exam_syllabus_research",
    system=(
        "You research official exam syllabi and paper patterns for Aeva, a "
        "study assistant for students in India. Search the web for the "
        "official or most authoritative sources (board / conducting-body "
        "websites, official syllabus PDFs, well-known coaching references) "
        "and report only what they support. Be concise and factual; say "
        "when something is uncertain or varies by year."
    ),
    user="""Research the exact syllabus and exam pattern for this student.

Today's date: {CURRENT_DATE}
Exam: {EXAM_NAME} on {EXAM_DATE} ({DAYS_REMAINING} days remaining)
Kind of exam: {EXAM_KIND}
Board / university / conducting body: {BOARD}
Class / grade: {CLASS_LEVEL}
Stream: {STREAM}
Subjects the student wants to cover: {SUBJECTS}
Specifics from the student: {EXAM_DETAILS}

Write a research brief (at most ~450 words, plain text, no preamble) a study planner can follow:
- For EACH listed subject: the official units / chapters for this exact class, board and year, in syllabus order, marking the high-weightage ones (marks or question share when published) and anything deleted or newly added recently.
- Paper pattern: sections, number of questions, question types, marks, duration, negative marking, and the typical difficulty.
- Typical mistakes or neglected areas students report for this exam.
- If the exam, class or board is ambiguous, state the assumption you made in one line.
Never include a question bank or copy questions; list units and patterns only.
""",
)

EXAM_DAY_DETAIL_TEMPLATE = PromptTemplate(
    name="exam_day_detail",
    system="{SYSTEM_PROMPT}{USER_PROFILE}",
    user="""Write the detailed study plan for ONE day of the student's exam roadmap, as Aeva.

Exam: {EXAM_NAME} ({DAYS_REMAINING} days remaining)
Day {DAY_NUMBER} ({DAY_DATE}): {DAY_TITLE}
Focus: {DAY_FOCUS}
Daily study time: {DAILY_MINUTES} minutes

Today's topics (use these topic_id values exactly; never invent new ids):
{TOPICS}

Rules:
- overview: 2-3 sentences on how to approach the day.
- time_blocks: split the {DAILY_MINUTES} minutes into 2-4 ordered blocks (e.g. "Morning: Physics - Kinematics"), each with its minutes and the topic_ids it covers; total minutes about {DAILY_MINUTES}.
- topics: one entry per topic above with 2-4 objectives, 3-6 key_points (formulas, definitions, steps), 2-4 practice items (exam-style tasks) and 2-3 common_mistakes. Be specific to the exam's level and syllabus.
- wrap_up: one short revision / self-check suggestion for the end of the day.
- Keep every string concise; use LaTeX ($...$) for formulas.
- Respond in the student's response language if one is set in their profile; otherwise English.
""",
    defaults={"SYSTEM_PROMPT": SYSTEM_PROMPT_BLOCK},
    optional=("USER_PROFILE",),
)

# Structured output of the day-detail call (``exam_plan_days.detail``).
EXAM_DAY_DETAIL_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "overview": {"type": "string"},
        "time_blocks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "label": {"type": "string"},
                    "minutes": {"type": "integer"},
                    "topic_ids": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                },
                "required": ["label", "minutes", "topic_ids"],
            },
        },
        "topics": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "topic_id": {"type": "string"},
                    "objectives": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "key_points": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "practice": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "common_mistakes": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                },
                "required": [
                    "topic_id",
                    "objectives",
                    "key_points",
                    "practice",
                    "common_mistakes",
                ],
            },
        },
        "wrap_up": {"type": "string"},
    },
    "required": ["overview", "time_blocks", "topics", "wrap_up"],
}

# The lesson Aeva teaches when the student opens a topic: a complete, exam-
# oriented explanation streamed as markdown and cached on the topic row.
# Plain text generation (no schema, no metadata trailer).
EXAM_TOPIC_LESSON_TEMPLATE = PromptTemplate(
    name="exam_topic_lesson",
    system="{SYSTEM_PROMPT}{USER_PROFILE}",
    user="""Teach ONE topic of the student's exam plan as Aeva, their teacher. Write the complete lesson they should read before practising.

Today's date: {CURRENT_DATE}
Exam: {EXAM_NAME} ({DAYS_REMAINING} days remaining) — {EXAM_KIND}
Board / conducting body: {BOARD}
Class / grade: {CLASS_LEVEL}; Stream: {STREAM}
Subject: {SUBJECT}
Topic: {TOPIC_TITLE}
What the plan says about it: {TOPIC_DESCRIPTION}
Time the student has for it today: {EST_MINUTES} minutes
Day context: {DAY_CONTEXT}
Student's own syllabus notes: {SYLLABUS}
Researched syllabus / pattern for this exam (trust over general knowledge):
{RESEARCH_BRIEF}

Write in Markdown with exactly these sections, in this order:
## Why this matters for {EXAM_NAME}
2-3 sentences: where the topic sits in the paper, its weightage and how it is usually asked.
## Core ideas
Explain every concept the topic needs, from first principles, in the order a good teacher would. Use short paragraphs, one idea each; define terms before using them; add an intuition or everyday analogy for anything abstract; use LaTeX ($...$ inline, $$...$$ display) for formulas and derive the important ones in 3-5 lines.
## Worked examples
3 exam-style problems (or passages / cases for non-numerical subjects) at the level of {EXAM_NAME}, each solved step by step with the reasoning for every step and the final answer clearly stated.
## Remember
A compact list of the formulas, definitions, dates or rules to memorise, each with a 1-line "when to use it".
## Common mistakes
3-5 traps students fall into in this exam and how to avoid each.
## Quick self-check
3 short questions for the student to attempt now (no answers here), then a final line "### Answers" followed by the three brief answers.

Rules: pitch everything at {CLASS_LEVEL} / {EXAM_NAME} level; stay strictly on this topic (mention prerequisites in one line, do not teach them); be concrete and exam-oriented; total length about 900-1400 words; no preamble, start with the first heading; respond in the student's response language if one is set in their profile, otherwise English.
""",
    defaults={"SYSTEM_PROMPT": SYSTEM_PROMPT_BLOCK},
    optional=("USER_PROFILE",),
)

# ``additional_instructions`` for quizzes generated from an exam-plan topic.
# Filled with ``str.format`` (lower-case names: not template placeholders).
EXAM_PREP_QUIZ_INSTRUCTIONS = (
    "This quiz is part of the student's {exam} study plan"
    "{class_level}. Pitch every question at that exam's level and style, "
    "stay strictly within this topic ({description}), and prefer "
    "exam-style numericals / application questions over recall."
)


def format_quiz_instructions(
    exam_name: str, class_level: str, description: str
) -> str:
    """Render ``EXAM_PREP_QUIZ_INSTRUCTIONS`` for one topic."""
    grade = class_level.strip()
    level = f" (class/grade: {grade})" if grade else ""
    return EXAM_PREP_QUIZ_INSTRUCTIONS.format(
        exam=exam_name.strip() or "exam",
        class_level=level,
        description=description.strip() or "the topic as titled",
    )


# How much of the research brief / taught lesson the coach block carries.
_COACH_BRIEF_CHARS = 900
_COACH_LESSON_CHARS = 2500


def _days_left(exam_date: Any) -> int | None:
    """Days from today (UTC) to ``exam_date`` (ISO string or date), >= 0."""
    if isinstance(exam_date, date):
        target = exam_date
    else:
        try:
            target = date.fromisoformat(str(exam_date)[:10])
        except ValueError:
            return None
    return max(0, (target - datetime.now(tz=UTC).date()).days)


def _topic_label(topic: dict[str, Any]) -> str:
    """``Subject: title`` for one topic row."""
    subject = str(topic.get("subject") or "").strip()
    title = str(topic.get("title") or "").strip()
    return f"{subject}: {title}" if subject else title


def _plan_lines(plan: dict[str, Any]) -> list[str]:
    """Exam / level / subjects / time lines of the coach block."""
    exam_name = str(plan.get("exam_name") or "").strip() or "the exam"
    exam_date = str(plan.get("exam_date") or "")[:10]
    left = _days_left(plan.get("exam_date"))
    when = f" on {exam_date}" if exam_date else ""
    left_text = f" ({left} days left)" if left is not None else ""
    lines = [f"- Exam: {exam_name}{when}{left_text}"]

    level = " ".join(
        part
        for part in (
            str(plan.get("class_level") or "").strip(),
            str(plan.get("stream") or "").strip(),
        )
        if part
    )
    if level:
        lines.append(f"- Class/stream: {level}")
    subjects = [
        str(s).strip() for s in (plan.get("subjects") or []) if str(s).strip()
    ]
    if subjects:
        lines.append(f"- Subjects: {', '.join(subjects)}")
    study = f"- Daily study time: {int(plan.get('daily_minutes') or 0)} min"
    target = str(plan.get("target_score") or "").strip()
    if target:
        study += f"; Target: {target}"
    lines.append(study)
    return lines


def _context_lines(
    day: dict[str, Any] | None,
    topic: dict[str, Any] | None,
    today: dict[str, Any] | None,
) -> list[str]:
    """Today / current day / current topic lines of the coach block."""
    lines: list[str] = []
    if today:
        topics = ", ".join(
            _topic_label(t) for t in (today.get("topics") or []) if t
        )
        title = str(today.get("title") or "").strip()
        line = f"- Today (Day {today.get('day_number')}): {title}"
        if topics:
            line += f" — {topics}"
        lines.append(line)
    if day:
        lines.append(
            f"- Current day: Day {day.get('day_number')} — "
            f"{str(day.get('title') or '').strip()}"
        )
    if topic:
        line = f"- Current topic: {_topic_label(topic)}"
        description = str(topic.get("description") or "").strip()
        if description:
            line += f" — {description}"
        lines.append(line)
        lesson = str(topic.get("lesson_md") or "").strip()
        if lesson:
            if len(lesson) > _COACH_LESSON_CHARS:
                lesson = lesson[:_COACH_LESSON_CHARS].rstrip() + " […]"
            lines.append(
                "- The lesson you already taught for this topic (the student "
                "has read it; answer doubts in its terms and refer back to "
                "its examples):\n" + lesson
            )
    return lines


def build_exam_prep_block(
    plan: dict[str, Any] | None,
    day: dict[str, Any] | None = None,
    topic: dict[str, Any] | None = None,
    today: dict[str, Any] | None = None,
) -> str:
    """System-prompt fragment for an exam-coach turn, or ``""``.

    ``plan`` is the ``exam_plans`` row; ``day`` / ``topic`` the rows the
    student is looking at (optional); ``today`` is today's day row with its
    topics under ``"topics"`` (optional). Empty fields are omitted so the
    block never shows blank labels.
    """
    if not plan:
        return ""
    lines = _plan_lines(plan) + _context_lines(day, topic, today)
    material = plan.get("material_media_ids") or []
    if material:
        lines.append(f"- Study material uploaded: {len(material)} file(s)")
    meta = plan.get("plan_meta") or {}
    board = str(meta.get("board") or "").strip()
    if board:
        lines.append(f"- Board / conducting body: {board}")
    details = str(meta.get("exam_details") or "").strip()
    if details:
        lines.append(f"- Student's specifics: {details}")
    brief = str(meta.get("research_brief") or "").strip()
    if brief:
        if len(brief) > _COACH_BRIEF_CHARS:
            brief = brief[:_COACH_BRIEF_CHARS].rstrip() + " […]"
        lines.append(f"- Researched syllabus / pattern notes: {brief}")

    return (
        "Exam Prep mode (the student is following their Aeva exam study "
        "plan):\n" + "\n".join(lines) + "\n"
        "Act as an exam coach: anchor every answer to this exam's level and "
        "syllabus, prefer worked examples and exam-style practice, keep the "
        "student on today's plan, and when asked for a quiz or flashcards "
        "keep them on the current topic. Be encouraging and concrete.\n\n"
    )
