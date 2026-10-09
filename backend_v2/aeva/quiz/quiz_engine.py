"""Deterministic quiz scoring."""

from typing import Any

from aeva.quiz import short_answer_grading as short_answer


class QuizEngine:
    """Score quiz attempts without LLM involvement.

    Selection questions (single / multi select, true / false) are scored
    here by comparing option text. A ``short_answer`` question is not judged
    here: its grading is passed in (``gradings``, produced by
    ``aeva.quiz.short_answer_grading``) and this class only turns the
    verdict into marks: correct = full mark, partial = half a mark,
    incorrect = no mark. With no grading supplied it uses that module's
    deterministic fallback, so scoring itself never calls a model.
    """

    @staticmethod
    def _normalize(value: str) -> str:
        """Normalize answer strings for comparison."""
        return value.strip().lower()

    @staticmethod
    def _normalize_bool(value: str) -> str:
        """Normalize true/false answers."""
        v = value.strip().lower()
        if v in {"true", "t", "yes", "1"}:
            return "true"
        if v in {"false", "f", "no", "0"}:
            return "false"
        return v

    @classmethod
    def _is_correct(
        cls,
        question_type: str,
        correct: list[str],
        user: list[str],
    ) -> bool:
        """Check if user answer fully matches the correct answer."""
        if question_type == "multi_select":
            return {cls._normalize(a) for a in user} == {
                cls._normalize(a) for a in correct
            }
        if question_type == "true_false":
            if not user:
                return False
            return cls._normalize_bool(user[0]) == cls._normalize_bool(
                correct[0]
            )
        # single_select
        if not user:
            return False
        return cls._normalize(user[0]) == cls._normalize(correct[0])

    @classmethod
    def _is_partial(
        cls,
        question_type: str,
        correct: list[str],
        user: list[str],
    ) -> bool:
        """Multi-select answer that overlaps the key but isn't exact."""
        if question_type != "multi_select" or not user:
            return False
        chosen = {cls._normalize(a) for a in user}
        key = {cls._normalize(a) for a in correct}
        return chosen != key and bool(chosen & key)

    @staticmethod
    def _judge_short_answer(
        question: dict[str, Any],
        user: list[str],
        gradings: dict[str, dict[str, Any]] | None,
    ) -> tuple[bool, bool, bool, dict[str, Any] | None]:
        """Judge a written answer: (attempted, correct, partial, grading).

        A blank answer is unattempted and has no grading. An answered one
        uses the grading supplied for it, else the deterministic fallback.
        """
        text = short_answer.answer_text(user)
        if not text:
            return False, False, False, None
        grading = (gradings or {}).get(
            question["id"]
        ) or short_answer.fallback_grade(question, text)
        verdict = grading.get("verdict")
        return (
            True,
            verdict == short_answer.VERDICT_CORRECT,
            verdict == short_answer.VERDICT_PARTIAL,
            grading,
        )

    @staticmethod
    def _exam_marks(
        totals: dict[str, int],
        marking: dict[str, float],
    ) -> dict[str, float]:
        """Marks-based breakdown for an exam attempt.

        Partial multi-select answers count as wrong for exam marking (an exam
        awards marks only for a fully correct answer), so every attempted but
        not-fully-correct question draws the negative mark.
        """
        correct = float(marking.get("correct", 1.0))
        negative = float(marking.get("negative", 0.0))
        skip = float(marking.get("skip", 0.0))
        # A partly right written answer earns half the positive mark and no
        # negative mark (0 for a quiz with no short-answer question).
        half_credit = totals.get("half_credit_count", 0)
        exam_incorrect = (
            totals["attempted_count"] - totals["correct_count"] - half_credit
        )
        positive_marks = (
            totals["correct_count"] * correct
            + half_credit * correct * short_answer.PARTIAL_CREDIT
        )
        negative_marks = exam_incorrect * negative
        skip_marks = totals["unanswered_count"] * skip
        return {
            "positive_marks": round(positive_marks, 2),
            "negative_marks": round(negative_marks, 2),
            "skip_marks": round(skip_marks, 2),
            "final_score": round(
                positive_marks + negative_marks + skip_marks, 2
            ),
            "max_marks": round(totals["total"] * correct, 2),
            "exam_incorrect": exam_incorrect,
            "marking": {
                "correct": correct,
                "negative": negative,
                "skip": skip,
            },
        }

    @classmethod
    def evaluate(
        cls,
        questions: list[dict[str, Any]],
        user_answers: dict[str, list[str]],
        marking: dict[str, float] | None = None,
        gradings: dict[str, dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Evaluate answers and return score + per-question breakdown.

        When ``marking`` (an exam scheme ``{correct, negative, skip}``) is
        provided, the result also carries a marks-based breakdown; otherwise the
        output is the accuracy-only shape unchanged.

        ``gradings`` maps a ``short_answer`` question id to its grading (see
        ``short_answer_grading.grade_attempt``). A partly right written
        answer counts as half a correct answer in ``score`` and adds to
        ``partial_count``; a partial multi-select still scores nothing, as
        before. A quiz with no short-answer question produces exactly the
        shape and numbers it always did; one that has them also carries
        ``short_answer_count`` / ``short_answer_partial_count`` and a
        ``grading`` on each written answer's row.
        """
        per_question: list[dict[str, Any]] = []
        correct_count = 0
        partial_count = 0
        attempted_count = 0
        short_answer_count = 0
        half_credit_count = 0

        for q in questions:
            qid = q["id"]
            user = user_answers.get(qid, [])
            correct = q["correct_answers"]
            grading: dict[str, Any] | None = None
            if short_answer.is_short_answer(q):
                short_answer_count += 1
                attempted, is_correct, partial, grading = (
                    cls._judge_short_answer(q, user, gradings)
                )
                half_credit_count += int(partial)
            else:
                attempted = bool(user)
                is_correct = cls._is_correct(q["type"], correct, user)
                partial = (not is_correct) and cls._is_partial(
                    q["type"], correct, user
                )
            if attempted:
                attempted_count += 1
            if is_correct:
                correct_count += 1
            elif partial:
                partial_count += 1
            row: dict[str, Any] = {
                "question_id": qid,
                "is_correct": is_correct,
                "partial": partial,
                "attempted": attempted,
                "user_answer": user,
                "correct_answer": correct,
                "explanation": q.get("explanation"),
            }
            if grading is not None:
                row["grading"] = grading
            per_question.append(row)

        total = len(questions)
        earned = correct_count + half_credit_count * short_answer.PARTIAL_CREDIT
        score = (earned / total * 100) if total else 0.0
        incorrect_count = attempted_count - correct_count - partial_count
        result: dict[str, Any] = {
            "score": round(score, 1),
            "total": total,
            "correct_count": correct_count,
            "partial_count": partial_count,
            "incorrect_count": max(incorrect_count, 0),
            "attempted_count": attempted_count,
            "unanswered_count": total - attempted_count,
            "per_question": per_question,
        }
        if short_answer_count:
            result["short_answer_count"] = short_answer_count
            result["short_answer_partial_count"] = half_credit_count
        if marking is not None:
            result.update(cls._exam_marks(
                {
                    "total": total,
                    "correct_count": correct_count,
                    "attempted_count": attempted_count,
                    "unanswered_count": total - attempted_count,
                    "half_credit_count": half_credit_count,
                },
                marking,
            ))
        return result
