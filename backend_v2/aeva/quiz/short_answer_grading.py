"""Short-answer quiz questions: stored shape, rubric grading, fallback.

A ``short_answer`` question has no options; the student writes one to three
sentences. It is stored on ``quiz_questions`` as::

    type            = "short_answer"
    options         = []
    correct_answers = [model_answer]      # so exports / reports that print
                                          # the "correct answer" keep working
    rubric          = ["key point", ...]  # 2-4 points (migration 038)

Grading (``grade_attempt`` / ``grade_short_answer``) returns, per answer::

    {
        "score": 0.0 .. 1.0,              # share of the rubric covered
        "verdict": "correct" | "partial" | "incorrect",
        "feedback": "...",
        "matched_points": ["key point", ...],
        "missed_points": ["key point", ...],
        "graded_by": "llm" | "exact_match" | "keyword" | "empty",
    }

Scoring rule (the verdict is always derived here from the score, never taken
from the model): ``score >= 0.75`` is **correct** (full mark),
``score >= 0.4`` is **partial** (half a mark), anything lower is
**incorrect** (no mark). ``QuizEngine`` turns the verdict into marks.

Every written answer of one attempt is graded in ONE batched LLM call (more
than ``_BATCH_SIZE`` answers are graded in further calls, one at a time,
inside the same time budget). Answers that are empty or equal to the model
answer never reach the model. When the model call fails, times out or skips
an item, that answer falls back to a deterministic check: a normalised exact
match is correct, otherwise the rubric points are matched by their key terms
and the feedback says so.
"""

import logging
import re
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError
from typing import TYPE_CHECKING, Any

from flask import current_app

from aeva.llm.prompts.builder import PromptBuilder
from aeva.llm.prompts.short_answer_grading import (
    SHORT_ANSWER_GRADING_SCHEMA,
    SHORT_ANSWER_GRADING_TEMPLATE,
)

if TYPE_CHECKING:
    from aeva.llm.llm_client import LLMClient

logger = logging.getLogger(__name__)

SHORT_ANSWER = "short_answer"

# Hard cap on a written answer (characters). Longer text is cut before it is
# stored or graded; the quiz runner enforces the same limit in the textarea
# (``SHORT_ANSWER_MAX_CHARS`` in
# frontend/src/components/quiz/shortAnswer.ts).
MAX_ANSWER_CHARS = 1000
# Caps on what generation may store, so one question stays a small row.
MAX_MODEL_ANSWER_CHARS = 1200
MAX_RUBRIC_POINTS = 4
MAX_RUBRIC_POINT_CHARS = 240
MAX_FEEDBACK_CHARS = 600

# Verdict thresholds on the 0..1 score, and the mark a partial answer earns.
CORRECT_THRESHOLD = 0.75
PARTIAL_THRESHOLD = 0.4
PARTIAL_CREDIT = 0.5

VERDICT_CORRECT = "correct"
VERDICT_PARTIAL = "partial"
VERDICT_INCORRECT = "incorrect"

GRADED_BY_LLM = "llm"
GRADED_BY_EXACT = "exact_match"
GRADED_BY_KEYWORD = "keyword"
GRADED_BY_EMPTY = "empty"

# Answers graded per LLM call. A quiz holds at most 25 questions, so an
# attempt is one call in practice.
_BATCH_SIZE = 25
# Whole-attempt time budget for LLM grading (seconds). The submit request
# has to answer inside the web client's 30 s timeout; past the budget the
# remaining answers use the fallback. Override: SHORT_ANSWER_GRADING_TIMEOUT_S.
_DEFAULT_TIMEOUT_S = 20.0
# A rubric point counts as covered by the keyword fallback when at least
# this share of its key terms appears in the answer.
_KEYWORD_POINT_COVERAGE = 0.6
_MIN_KEYWORD_CHARS = 3
# Terms are compared on this many leading characters, a crude stem so that
# "moves" matches "movement" without a language-specific stemmer.
_KEYWORD_STEM_CHARS = 4

_WORD_RE = re.compile(r"\w+", re.UNICODE)
_EDGE_PUNCT_RE = re.compile(r"^[\W_]+|[\W_]+$", re.UNICODE)
_SPACE_RE = re.compile(r"\s+")
# Common English function words carry no meaning for the keyword fallback.
_STOPWORDS = frozenset({
    "the", "and", "for", "are", "was", "were", "that", "this", "these",
    "those", "with", "from", "into", "onto", "its", "it's", "has", "have",
    "had", "not", "but", "can", "will", "would", "should", "could", "may",
    "also", "than", "then", "when", "where", "which", "who", "whom", "what",
    "why", "how", "their", "there", "them", "they", "you", "your", "our",
    "his", "her", "him", "she", "one", "two", "each", "any", "all", "some",
    "such", "being", "been", "does", "did", "about", "because", "while",
    "between", "during", "through", "both", "more", "most", "very",
})

_EXACT_FEEDBACK = "Your answer matches the model answer."
_EMPTY_FEEDBACK = "No answer was given."
_KEYWORD_FEEDBACK = (
    "This answer was checked by matching the key terms of each point, not "
    "read in full. Compare it with the model answer."
)
_UNCHECKABLE_FEEDBACK = (
    "This answer could not be checked automatically. Compare it with the "
    "model answer."
)


# --------------------------------------------------------------- shape


def is_short_answer(question: dict[str, Any]) -> bool:
    """Check whether a question is answered in free text."""
    return question.get("type") == SHORT_ANSWER


def _clean_text(value: object, limit: int) -> str:
    """Return a trimmed string cut to ``limit`` characters."""
    if not isinstance(value, str):
        return ""
    text = value.strip()
    return text[:limit].rstrip() if len(text) > limit else text


def clean_rubric(raw: object) -> list[str]:
    """Return the key points as distinct, trimmed strings (at most four)."""
    if not isinstance(raw, list):
        return []
    points: list[str] = []
    seen: set[str] = set()
    for item in raw:
        point = _clean_text(item, MAX_RUBRIC_POINT_CHARS)
        key = _normalize(point)
        if not point or key in seen:
            continue
        seen.add(key)
        points.append(point)
        if len(points) == MAX_RUBRIC_POINTS:
            break
    return points


def model_answer(question: dict[str, Any]) -> str:
    """Return the stored model answer of a question ('' if none)."""
    answers = question.get("correct_answers") or []
    first = answers[0] if answers else ""
    return first.strip() if isinstance(first, str) else ""


def prepare_question(question: dict[str, Any]) -> dict[str, Any]:
    """Put a generated question into its stored shape.

    Only ``short_answer`` questions change: options are dropped, the model
    answer moves into ``correct_answers`` and the rubric is cleaned. The
    model answer is read from ``model_answer``, else the first
    ``correct_answers`` value, else the explanation, so a slightly
    off-contract generation still yields a gradeable question. A question
    with no rubric is graded against its model answer as the single point.
    Every other type is returned as the same object, untouched.
    """
    if not is_short_answer(question):
        return question
    answer = (
        _clean_text(question.get("model_answer"), MAX_MODEL_ANSWER_CHARS)
        or _clean_text(model_answer(question), MAX_MODEL_ANSWER_CHARS)
        or _clean_text(question.get("explanation"), MAX_MODEL_ANSWER_CHARS)
    )
    rubric = clean_rubric(question.get("rubric"))
    if not rubric and answer:
        rubric = [answer[:MAX_RUBRIC_POINT_CHARS].rstrip()]
    if not answer:
        logger.warning("Short-answer question generated with no model answer")
    prepared = {
        key: value for key, value in question.items() if key != "model_answer"
    }
    prepared["options"] = []
    prepared["correct_answers"] = [answer] if answer else []
    prepared["rubric"] = rubric
    return prepared


def answer_text(answer: object) -> str:
    """Return the student's written answer from a submitted value, capped.

    Answers travel as ``list[str]`` like every other question type; a
    written answer is the first item.
    """
    if isinstance(answer, list):
        answer = answer[0] if answer else ""
    return _clean_text(answer, MAX_ANSWER_CHARS)


def clip_answers(
    questions: list[dict[str, Any]],
    answers: dict[str, list[str]],
) -> dict[str, list[str]]:
    """Cap written answers before they are graded and stored.

    Returns ``answers`` itself when the quiz has no short-answer question,
    so selection-only quizzes are passed through untouched.
    """
    short_ids = [q["id"] for q in questions if is_short_answer(q)]
    if not short_ids:
        return answers
    clipped = dict(answers)
    for qid in short_ids:
        if qid not in clipped:
            continue
        text = answer_text(clipped[qid])
        clipped[qid] = [text] if text else []
    return clipped


# ------------------------------------------------------------- verdict


def verdict_for(score: float) -> str:
    """Map a 0..1 score onto correct / partial / incorrect."""
    if score >= CORRECT_THRESHOLD:
        return VERDICT_CORRECT
    if score >= PARTIAL_THRESHOLD:
        return VERDICT_PARTIAL
    return VERDICT_INCORRECT


def _grading(
    score: float,
    feedback: str,
    matched: list[str],
    missed: list[str],
    graded_by: str,
) -> dict[str, Any]:
    """Build one grading record with the verdict derived from the score."""
    score = round(min(max(float(score), 0.0), 1.0), 2)
    return {
        "score": score,
        "verdict": verdict_for(score),
        "feedback": feedback,
        "matched_points": matched,
        "missed_points": missed,
        "graded_by": graded_by,
    }


# ------------------------------------------------------------ fallback


def _normalize(text: str) -> str:
    """Fold case, width, edge punctuation and spacing out of a text."""
    folded = unicodedata.normalize("NFKC", text or "").casefold()
    return _SPACE_RE.sub(" ", _EDGE_PUNCT_RE.sub("", folded.strip())).strip()


def _keywords(text: str) -> set[str]:
    """Return the meaningful terms of a text (keyword fallback)."""
    return {
        word[:_KEYWORD_STEM_CHARS]
        for word in _WORD_RE.findall(_normalize(text))
        if len(word) >= _MIN_KEYWORD_CHARS and word not in _STOPWORDS
    }


def _points(question: dict[str, Any]) -> list[str]:
    """Return the points to grade against (rubric, else model answer)."""
    rubric = clean_rubric(question.get("rubric"))
    if rubric:
        return rubric
    answer = model_answer(question)
    return [answer] if answer else []


def _is_exact_match(question: dict[str, Any], text: str) -> bool:
    """Check the answer equals the model answer once both are normalised."""
    expected = _normalize(model_answer(question))
    return bool(expected) and _normalize(text) == expected


def fallback_grade(
    question: dict[str, Any], user_answer: str
) -> dict[str, Any]:
    """Grade one written answer with no LLM (deterministic).

    Empty is incorrect, a normalised exact match is correct, and anything
    else is scored by how many rubric points have most of their key terms
    in the answer. Used when the model is unavailable, and for guests on a
    shared quiz (no model call is made on that unauthenticated path).
    """
    text = answer_text(user_answer)
    points = _points(question)
    if not text:
        return _grading(0.0, _EMPTY_FEEDBACK, [], points, GRADED_BY_EMPTY)
    if _is_exact_match(question, text):
        return _grading(1.0, _EXACT_FEEDBACK, points, [], GRADED_BY_EXACT)
    if not points:
        return _grading(0.0, _UNCHECKABLE_FEEDBACK, [], [], GRADED_BY_KEYWORD)
    answer_terms = _keywords(text)
    matched: list[str] = []
    missed: list[str] = []
    for point in points:
        terms = _keywords(point)
        covered = len(terms & answer_terms) / len(terms) if terms else 0.0
        (matched if covered >= _KEYWORD_POINT_COVERAGE else missed).append(
            point
        )
    return _grading(
        len(matched) / len(points),
        _KEYWORD_FEEDBACK,
        matched,
        missed,
        GRADED_BY_KEYWORD,
    )


# ---------------------------------------------------------- LLM grading


def _quoted(text: str) -> str:
    """Make a student answer safe to sit between the prompt's delimiters."""
    return text.replace("<<<", "<").replace(">>>", ">")


def _render_item(item_id: str, question: dict[str, Any], text: str) -> str:
    """Render one graded item of the ``{ITEMS}`` block."""
    points = _points(question)
    rubric = "\n".join(
        f"{number}. {point}" for number, point in enumerate(points, start=1)
    )
    return (
        f"### Item {item_id}\n"
        f"Question: {str(question.get('prompt') or '').strip()}\n"
        f"Model answer: {model_answer(question) or '(none given)'}\n"
        f"Rubric:\n{rubric or '(none given: grade against the model answer)'}"
        f"\nStudent answer:\n<<<\n{_quoted(text)}\n>>>"
    )


class ShortAnswerGrader:
    """Grade written quiz answers against their rubric with one LLM call."""

    def __init__(self, llm: "LLMClient | None" = None) -> None:
        self._llm = llm

    @property
    def llm(self) -> "LLMClient":
        """Return the LLM client (shares the quiz-analysis model config).

        ``LLMClient`` is imported here, not at module level: the quiz engine
        and repository import this module, and they must stay importable
        without pulling in the provider stack (or risking an import cycle).
        """
        from aeva.llm.llm_client import LLMClient

        return self._llm or LLMClient(config_key="LLM_QUIZ_ANALYSIS_MODEL")

    @staticmethod
    def _timeout_s() -> float:
        """Return the time budget for grading one attempt."""
        return float(
            current_app.config.get(
                "SHORT_ANSWER_GRADING_TIMEOUT_S", _DEFAULT_TIMEOUT_S
            )
        )

    def grade_batch(
        self, items: list[tuple[dict[str, Any], str]]
    ) -> list[dict[str, Any]]:
        """Grade ``(question, answer)`` pairs, in order.

        Never raises: an item the model did not (validly) grade gets the
        deterministic fallback, so a submit is never failed by grading.
        """
        deadline = time.monotonic() + self._timeout_s()
        graded: list[dict[str, Any]] = []
        for start in range(0, len(items), _BATCH_SIZE):
            chunk = items[start : start + _BATCH_SIZE]
            results = self._grade_chunk(chunk, deadline - time.monotonic())
            for index, (question, text) in enumerate(chunk):
                graded.append(
                    self._parse(question, results.get(f"a{index + 1}"))
                    or fallback_grade(question, text)
                )
        return graded

    def _grade_chunk(
        self,
        chunk: list[tuple[dict[str, Any], str]],
        budget_s: float,
    ) -> dict[str, dict[str, Any]]:
        """Grade one chunk in one LLM call: ``item id -> raw result``.

        Returns ``{}`` when the call fails or runs out of time.
        """
        if budget_s <= 0:
            logger.warning(
                "Short-answer grading ran out of time; using fallback"
            )
            return {}
        pool = ThreadPoolExecutor(max_workers=1)
        try:
            rendered = PromptBuilder.build(
                SHORT_ANSWER_GRADING_TEMPLATE,
                ITEMS="\n\n".join(
                    _render_item(f"a{index + 1}", question, text)
                    for index, (question, text) in enumerate(chunk)
                ),
            )
            app = current_app._get_current_object()  # type: ignore[attr-defined]  # noqa: SLF001
            llm = self.llm

            def call() -> dict[str, Any]:
                with app.app_context():
                    return llm.generate_structured(
                        rendered.user_message,
                        SHORT_ANSWER_GRADING_SCHEMA,
                        system_prompt=rendered.system_prompt,
                        log_label="short_answer_grading",
                    )

            data = pool.submit(call).result(timeout=budget_s)
        except FutureTimeoutError:
            logger.warning("Short-answer grading timed out; using fallback")
            return {}
        except Exception:  # noqa: BLE001 - grading must never fail a submit
            logger.warning(
                "Short-answer grading failed; using fallback", exc_info=True
            )
            return {}
        finally:
            pool.shutdown(wait=False)

        results: dict[str, dict[str, Any]] = {}
        raw = data.get("results") if isinstance(data, dict) else None
        for item in raw if isinstance(raw, list) else []:
            if isinstance(item, dict) and isinstance(item.get("id"), str):
                results.setdefault(item["id"].strip(), item)
        return results

    @staticmethod
    def _parse(
        question: dict[str, Any], result: dict[str, Any] | None
    ) -> dict[str, Any] | None:
        """Turn one raw model result into a grading (None if unusable)."""
        if not result:
            return None
        score = result.get("score")
        if isinstance(score, bool) or not isinstance(score, int | float):
            return None
        if not 0 <= score <= 1:
            return None
        points = _points(question)
        raw_matched = result.get("matched_points")
        numbers = {
            int(number)
            for number in (raw_matched if isinstance(raw_matched, list) else [])
            if isinstance(number, int | float) and not isinstance(number, bool)
        }
        matched = [
            point
            for number, point in enumerate(points, start=1)
            if number in numbers
        ]
        missed = [point for point in points if point not in matched]
        feedback = _clean_text(result.get("feedback"), MAX_FEEDBACK_CHARS)
        return _grading(score, feedback, matched, missed, GRADED_BY_LLM)


# ------------------------------------------------------------ public API


def grade_attempt(
    questions: list[dict[str, Any]],
    answers: dict[str, list[str]],
    grader: ShortAnswerGrader | None = None,
) -> dict[str, dict[str, Any]]:
    """Grade every answered short-answer question: ``question id -> grading``.

    Returns ``{}`` (and makes no LLM call) for a quiz with no short-answer
    question. Unanswered questions are left out (the engine counts them as
    unanswered), and an answer equal to the model answer is settled here, so
    only answers that need judgement reach the model, all in one batch.
    """
    gradings: dict[str, dict[str, Any]] = {}
    pending: list[tuple[dict[str, Any], str]] = []
    for question in questions:
        if not is_short_answer(question):
            continue
        text = answer_text(answers.get(question["id"]))
        if not text:
            continue
        if _is_exact_match(question, text):
            gradings[question["id"]] = fallback_grade(question, text)
        else:
            pending.append((question, text))
    if pending:
        graded = (grader or ShortAnswerGrader()).grade_batch(pending)
        for (question, _text), grading in zip(pending, graded, strict=True):
            gradings[question["id"]] = grading
    return gradings


def grade_short_answer(
    question: dict[str, Any],
    user_answer: str,
    grader: ShortAnswerGrader | None = None,
) -> dict[str, Any]:
    """Grade one written answer (LLM rubric grading, fallback on failure).

    Returns ``{score, verdict, feedback, matched_points, missed_points,
    graded_by}``; see the module docstring for the scoring rule.
    """
    text = answer_text(user_answer)
    if not text or _is_exact_match(question, text):
        return fallback_grade(question, text)
    return (grader or ShortAnswerGrader()).grade_batch([(question, text)])[0]
