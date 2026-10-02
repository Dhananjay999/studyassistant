"""Exam-style research contract: the web-grounded prompt run before a quiz.

When a student pitches a quiz at an exam ("Exam level: SSC CGL") instead of
a difficulty band, ``EXAM_STYLE_RESEARCH_TEMPLATE`` asks a search-grounded
model how that exam's previous-year questions on the topic are asked. The
plain-text brief it returns is handed to ``QUIZ_GENERATION_TEMPLATE`` as the
``{EXAM_PATTERN}`` block — a style guide for the question writer, never a
question bank.
"""

from aeva.llm.prompts.builder import PromptTemplate

EXAM_STYLE_RESEARCH_TEMPLATE = PromptTemplate(
    name="exam_style_research",
    system=(
        "You research competitive-exam question patterns for Aeva, a study "
        "assistant. Search the web for analyses of previous-year papers and "
        "report only what the sources support. Be concise and factual."
    ),
    user="""Research how {EXAM} previous-year questions are asked.

Exam: {EXAM}
Topic: {TOPIC}
Today's date: {CURRENT_DATE}

Write a style brief (at most ~250 words, plain text, no preamble) that a question writer can follow to produce {EXAM}-level questions on this topic:
- Where the topic sits in {EXAM} (section / paper) and which sub-topics are asked most often in recent years.
- Question formats and phrasing conventions (stem length, statement-based, assertion-reason, match-the-following, data or figure based, etc.).
- Options: how many, and the typical distractors and traps.
- The real paper's difficulty and time available per question.
- 2–3 example question SHAPES, paraphrased in your own words — never copy a real question verbatim.

If the topic is not part of {EXAM}, say so in one line and describe the closest section instead.
""",
)
