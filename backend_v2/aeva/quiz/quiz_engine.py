"""Deterministic quiz scoring."""

from typing import Any


class QuizEngine:
    """Score quiz attempts without LLM involvement."""

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
        exam_incorrect = totals["attempted_count"] - totals["correct_count"]
        positive_marks = totals["correct_count"] * correct
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
    ) -> dict[str, Any]:
        """Evaluate answers and return score + per-question breakdown.

        When ``marking`` (an exam scheme ``{correct, negative, skip}``) is
        provided, the result also carries a marks-based breakdown; otherwise the
        output is the accuracy-only shape unchanged.
        """
        per_question: list[dict[str, Any]] = []
        correct_count = 0
        partial_count = 0
        attempted_count = 0

        for q in questions:
            qid = q["id"]
            user = user_answers.get(qid, [])
            correct = q["correct_answers"]
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
            per_question.append({
                "question_id": qid,
                "is_correct": is_correct,
                "partial": partial,
                "attempted": attempted,
                "user_answer": user,
                "correct_answer": correct,
                "explanation": q.get("explanation"),
            })

        total = len(questions)
        score = (correct_count / total * 100) if total else 0.0
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
        if marking is not None:
            result.update(cls._exam_marks(
                {
                    "total": total,
                    "correct_count": correct_count,
                    "attempted_count": attempted_count,
                    "unanswered_count": total - attempted_count,
                },
                marking,
            ))
        return result
