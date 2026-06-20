"""Quiz data access."""

import uuid
from typing import Any

from aeva.common.errors import ERROR_CODES, CustomError
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
        """List the user's quizzes with question counts, newest first."""
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

        return [
            {
                "id": q["id"],
                "quiz_id": q["id"],
                "title": q["title"],
                "topic": q["topic"],
                "session_id": q["session_id"],
                "created_at": q["created_at"],
                "question_count": counts.get(q["id"], 0),
            }
            for q in quizzes
        ]

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
        feedback: dict[str, Any],
    ) -> dict[str, Any]:
        """Persist a quiz attempt."""
        result = (
            self.supabase.client.table("quiz_attempts")
            .insert({
                "quiz_id": quiz_id,
                "user_id": user_id,
                "answers": answers,
                "score": evaluation["score"],
                "evaluation": evaluation,
                "feedback": feedback,
            })
            .execute()
        )
        return result.data[0]
