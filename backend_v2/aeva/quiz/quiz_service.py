"""Quiz business logic."""

import json
from typing import Any

from aeva.common.errors import ERROR_CODES, CustomError
from aeva.common.schema import success_response
from aeva.llm import prompts
from aeva.llm.llm_client import LLMClient
from aeva.quiz.quiz_engine import QuizEngine
from aeva.quiz.quiz_repository import QuizRepository
from aeva.supabase.supabase_service import SupabaseService


class QuizService:
    """Quiz fetch, instant scoring, and on-demand AI analysis."""

    def __init__(
        self,
        repo: QuizRepository | None = None,
        llm: LLMClient | None = None,
        supabase: SupabaseService | None = None,
    ) -> None:
        self._repo = repo
        self._llm = llm
        self._supabase = supabase

    @property
    def repo(self) -> QuizRepository:
        """Lazy repository."""
        return self._repo or QuizRepository()

    @property
    def llm(self) -> LLMClient:
        """Lazy LLM client."""
        return self._llm or LLMClient(config_key="LLM_QUIZ_MODEL")

    @property
    def supabase(self) -> SupabaseService:
        """Lazy Supabase client (for the learning profile)."""
        return self._supabase or SupabaseService()

    def get_quiz(self, quiz_id: str, user_id: str) -> dict[str, Any]:
        """Return quiz without correct answers."""
        quiz = self.repo.get_quiz(quiz_id, user_id)
        if not quiz:
            raise CustomError(ERROR_CODES["QUIZ_NOT_FOUND"])
        return success_response("Quiz loaded", quiz)

    def list_quizzes(self, user_id: str) -> dict[str, Any]:
        """List the user's quizzes."""
        return success_response(
            "Quizzes retrieved", self.repo.list_quizzes(user_id)
        )

    def list_attempts(self, quiz_id: str, user_id: str) -> dict[str, Any]:
        """List a quiz's attempt history (newest first)."""
        if not self.repo.get_quiz(quiz_id, user_id):
            raise CustomError(ERROR_CODES["QUIZ_NOT_FOUND"])
        return success_response(
            "Attempts retrieved", self.repo.list_attempts(quiz_id, user_id)
        )

    def get_attempt_detail(
        self, quiz_id: str, attempt_id: str, user_id: str
    ) -> dict[str, Any]:
        """Return a single attempt's full report (quiz + evaluation + AI)."""
        attempt = self.repo.get_attempt(attempt_id, user_id)
        if not attempt or attempt["quiz_id"] != quiz_id:
            raise CustomError(ERROR_CODES["QUIZ_ATTEMPT_NOT_FOUND"])

        quiz = self.repo.get_quiz(quiz_id, user_id, include_answers=True)
        if not quiz:
            raise CustomError(ERROR_CODES["QUIZ_NOT_FOUND"])

        feedback = attempt.get("feedback") or {}
        ai_analysis = feedback if feedback.get("study_plan") else None
        return success_response("Attempt loaded", {
            "attempt_id": attempt["id"],
            "attempt_number": self.repo.attempt_number(
                quiz_id, user_id, attempt["created_at"]
            ),
            "quiz": quiz,
            "answers": attempt.get("answers") or {},
            "evaluation": attempt.get("evaluation") or {},
            "ai_analysis": ai_analysis,
            "created_at": attempt["created_at"],
        })

    def submit(
        self,
        quiz_id: str,
        user_id: str,
        answers: dict[str, list[str]],
        time_taken_seconds: int = 0,
    ) -> dict[str, Any]:
        """Score the quiz locally and persist the attempt — no LLM call."""
        quiz = self.repo.get_quiz(quiz_id, user_id, include_answers=True)
        if not quiz:
            raise CustomError(ERROR_CODES["QUIZ_NOT_FOUND"])

        evaluation = QuizEngine.evaluate(quiz["questions"], answers)
        evaluation["time_taken_seconds"] = max(int(time_taken_seconds), 0)
        attempt = self.repo.save_attempt(quiz_id, user_id, answers, evaluation)
        return success_response("Quiz submitted", {
            "attempt_id": attempt["id"],
            "evaluation": evaluation,
        })

    def analyze(
        self, quiz_id: str, attempt_id: str, user_id: str
    ) -> dict[str, Any]:
        """Generate (and cache) an AI performance analysis for an attempt."""
        attempt = self.repo.get_attempt(attempt_id, user_id)
        if not attempt or attempt["quiz_id"] != quiz_id:
            raise CustomError(ERROR_CODES["QUIZ_ATTEMPT_NOT_FOUND"])

        cached = attempt.get("feedback") or {}
        if cached.get("study_plan"):
            return success_response("Analysis ready", cached)

        quiz = self.repo.get_quiz(quiz_id, user_id, include_answers=True)
        if not quiz:
            raise CustomError(ERROR_CODES["QUIZ_NOT_FOUND"])

        analysis = self._generate_analysis(
            quiz, attempt["answers"], attempt["evaluation"], user_id
        )
        self.repo.update_attempt_feedback(attempt_id, user_id, analysis)
        return success_response("Analysis ready", analysis)

    def _generate_analysis(
        self,
        quiz: dict[str, Any],
        answers: dict[str, list[str]],
        evaluation: dict[str, Any],
        user_id: str,
    ) -> dict[str, Any]:
        """Call the LLM once for a structured performance analysis."""
        profile = self.supabase.get_profile(user_id)
        system_prompt = prompts.personalize(
            prompts.SYSTEM_PROMPT,
            prompts.build_personalization_block(profile),
        )
        prompt = prompts.QUIZ_ANALYSIS_PROMPT.format(
            quiz=json.dumps(quiz, indent=2),
            answers=json.dumps(answers, indent=2),
            evaluation=json.dumps(evaluation, indent=2),
        )
        return self.llm.generate_structured(
            prompt,
            prompts.QUIZ_ANALYSIS_SCHEMA,
            system_prompt=system_prompt,
        )
