"""Quiz data access."""

import uuid
from typing import Any

from aeva.supabase.supabase_service import SupabaseService


class QuizRepository:
    """Persist and load quizzes."""

    def __init__(self, supabase: SupabaseService | None = None) -> None:
        self._supabase = supabase

    @property
    def supabase(self) -> SupabaseService:
        """Lazy Supabase client."""
        return self._supabase or SupabaseService()

    def create(
        self,
        user_id: str,
        session_id: str,
        quiz_data: dict[str, Any],
    ) -> dict[str, Any]:
        """Create quiz and questions from LLM output."""
        quiz_row = (
            self.supabase.client.table("quizzes")
            .insert({
                "user_id": user_id,
                "session_id": session_id,
                "title": quiz_data.get("title", "Quiz"),
                "topic": quiz_data.get("topic", ""),
                # Persisted so the quizzes list can show difficulty without
                # re-opening each quiz. Defaults to "medium" for older rows.
                "difficulty": quiz_data.get("difficulty") or "medium",
            })
            .execute()
        )
        quiz = quiz_row.data[0]
        quiz_id = quiz["id"]

        questions_out: list[dict[str, Any]] = []
        for idx, q in enumerate(quiz_data.get("questions", [])):
            # Always use server UUIDs — LLM ids (e.g. "q1_topic") are not valid.
            qid = str(uuid.uuid4())
            self.supabase.client.table("quiz_questions").insert({
                "id": qid,
                "quiz_id": quiz_id,
                "type": q["type"],
                "prompt": q["prompt"],
                "options": q["options"],
                "correct_answers": q["correct_answers"],
                "explanation": q.get("explanation"),
                "sort_order": idx,
            }).execute()
            questions_out.append({
                "id": qid,
                "type": q["type"],
                "prompt": q["prompt"],
                "options": q["options"],
            })

        return {
            "id": quiz_id,
            "title": quiz["title"],
            "topic": quiz["topic"],
            "questions": questions_out,
        }

    def list_quizzes(self, user_id: str) -> list[dict[str, Any]]:
        """List the user's quizzes with counts and best-attempt summary."""
        quizzes = (
            self.supabase.client.table("quizzes")
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .execute()
        ).data or []
        if not quizzes:
            return []

        ids = [q["id"] for q in quizzes]
        counts: dict[str, int] = {}
        rows = (
            self.supabase.client.table("quiz_questions")
            .select("quiz_id")
            .in_("quiz_id", ids)
            .execute()
        ).data or []
        for r in rows:
            counts[r["quiz_id"]] = counts.get(r["quiz_id"], 0) + 1

        summaries = self._attempt_summaries(user_id, ids)

        return [
            {
                "id": q["id"],
                "quiz_id": q["id"],
                "title": q["title"],
                "topic": q["topic"],
                "session_id": q["session_id"],
                "created_at": q["created_at"],
                "difficulty": q.get("difficulty") or "medium",
                "question_count": counts.get(q["id"], 0),
                **summaries.get(q["id"], self._empty_summary()),
            }
            for q in quizzes
        ]

    @staticmethod
    def _empty_summary() -> dict[str, Any]:
        """Attempt summary for a quiz with no attempts."""
        return {
            "attempt_count": 0,
            "best_score": None,
            "best_correct": None,
            "last_attempt_at": None,
        }

    def _attempt_summaries(
        self, user_id: str, quiz_ids: list[str]
    ) -> dict[str, dict[str, Any]]:
        """Best score + last attempt date per quiz, in one query."""
        rows = (
            self.supabase.client.table("quiz_attempts")
            .select("quiz_id, score, evaluation, created_at")
            .eq("user_id", user_id)
            .in_("quiz_id", quiz_ids)
            .execute()
        ).data or []

        out: dict[str, dict[str, Any]] = {}
        for r in rows:
            qid = r["quiz_id"]
            score = r.get("score") or 0.0
            cur = out.get(qid)
            if cur is None:
                cur = self._empty_summary()
                out[qid] = cur
            cur["attempt_count"] += 1
            if cur["best_score"] is None or score > cur["best_score"]:
                cur["best_score"] = score
                evaluation = r.get("evaluation") or {}
                cur["best_correct"] = evaluation.get("correct_count")
            last = cur["last_attempt_at"]
            if last is None or r["created_at"] > last:
                cur["last_attempt_at"] = r["created_at"]
        return out

    def get_quiz(
        self, quiz_id: str, user_id: str, *, include_answers: bool = False
    ) -> dict[str, Any] | None:
        """Load quiz with questions (answers optional)."""
        quiz_result = (
            self.supabase.client.table("quizzes")
            .select("*")
            .eq("id", quiz_id)
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
        if not quiz_result or not quiz_result.data:
            return None

        quiz = quiz_result.data
        q_result = (
            self.supabase.client.table("quiz_questions")
            .select("*")
            .eq("quiz_id", quiz_id)
            .order("sort_order")
            .execute()
        )
        questions = []
        for q in q_result.data or []:
            item = {
                "id": q["id"],
                "type": q["type"],
                "prompt": q["prompt"],
                "options": q["options"],
            }
            if include_answers:
                item["correct_answers"] = q["correct_answers"]
                item["explanation"] = q.get("explanation")
            questions.append(item)

        return {
            "id": quiz["id"],
            # Frontend QuizContent (and submit) key on `quiz_id`; keep `id`
            # too so existing callers stay unaffected.
            "quiz_id": quiz["id"],
            "title": quiz["title"],
            "topic": quiz["topic"],
            "questions": questions,
        }

    def save_attempt(
        self,
        quiz_id: str,
        user_id: str,
        answers: dict[str, list[str]],
        evaluation: dict[str, Any],
        feedback: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Persist a quiz attempt (feedback is filled later on demand)."""
        result = (
            self.supabase.client.table("quiz_attempts")
            .insert({
                "quiz_id": quiz_id,
                "user_id": user_id,
                "answers": answers,
                "score": evaluation["score"],
                "evaluation": evaluation,
                "feedback": feedback or {},
            })
            .execute()
        )
        return result.data[0]

    def list_attempts(
        self, quiz_id: str, user_id: str
    ) -> list[dict[str, Any]]:
        """List a quiz's attempts (newest first) with per-attempt summary."""
        rows = (
            self.supabase.client.table("quiz_attempts")
            .select("id, score, evaluation, feedback, created_at")
            .eq("quiz_id", quiz_id)
            .eq("user_id", user_id)
            .order("created_at")
            .execute()
        ).data or []
        if not rows:
            return []

        # `Any` mirrors the rest of this module: Supabase types `.data` as a
        # JSON union, so comparisons need a loosely-typed accumulator.
        best_score: Any = 0.0
        for r in rows:
            best_score = max(best_score, r.get("score") or 0.0)
        best_seen = False

        attempts: list[dict[str, Any]] = []
        for idx, r in enumerate(rows):
            evaluation = r.get("evaluation") or {}
            feedback = r.get("feedback") or {}
            score = r.get("score") or 0.0
            # Mark only the earliest attempt that reaches the best score.
            is_best = (not best_seen) and score == best_score
            if is_best:
                best_seen = True
            attempts.append({
                "id": r["id"],
                "attempt_number": idx + 1,
                "score": score,
                "total": evaluation.get("total", 0),
                "correct_count": evaluation.get("correct_count", 0),
                "incorrect_count": evaluation.get("incorrect_count", 0),
                "partial_count": evaluation.get("partial_count", 0),
                "unanswered_count": evaluation.get("unanswered_count", 0),
                "time_taken_seconds": evaluation.get("time_taken_seconds", 0),
                "created_at": r["created_at"],
                "is_best": is_best,
                "has_analysis": bool(feedback.get("study_plan")),
            })

        attempts.reverse()
        return attempts

    def attempt_number(
        self, quiz_id: str, user_id: str, created_at: str
    ) -> int:
        """1-based position of an attempt within the quiz's history."""
        rows = (
            self.supabase.client.table("quiz_attempts")
            .select("id")
            .eq("quiz_id", quiz_id)
            .eq("user_id", user_id)
            .lte("created_at", created_at)
            .execute()
        ).data or []
        return len(rows) or 1

    def get_attempt(
        self, attempt_id: str, user_id: str
    ) -> dict[str, Any] | None:
        """Load a single attempt owned by the user."""
        result = (
            self.supabase.client.table("quiz_attempts")
            .select("*")
            .eq("id", attempt_id)
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
        if not result or not result.data:
            return None
        return result.data

    def update_attempt_feedback(
        self, attempt_id: str, user_id: str, feedback: dict[str, Any]
    ) -> None:
        """Cache AI analysis on the attempt row."""
        (
            self.supabase.client.table("quiz_attempts")
            .update({"feedback": feedback})
            .eq("id", attempt_id)
            .eq("user_id", user_id)
            .execute()
        )
