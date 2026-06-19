"""Quiz business logic."""

import json
from typing import Any

from aeva.common.errors import ERROR_CODES, CustomError
from aeva.common.schema import success_response
from aeva.llm.llm_client import LLMClient
from aeva.llm import prompts
from aeva.llm.schemas.feedback import QUIZ_FEEDBACK_SCHEMA
from aeva.quiz.quiz_engine import QuizEngine
from aeva.quiz.quiz_repository import QuizRepository


class QuizService:
    """Quiz fetch, submit, and AI feedback."""

    def __init__(
        self,
        repo: QuizRepository | None = None,
        llm: LLMClient | None = None,
    ) -> None:
        self._repo = repo
        self._llm = llm

    @property
    def repo(self) -> QuizRepository:
        """Lazy repository."""
        return self._repo or QuizRepository()

    @property
    def llm(self) -> LLMClient:
        """Lazy LLM client."""
        return self._llm or LLMClient(config_key="LLM_QUIZ_MODEL")

    def get_quiz(self, quiz_id: str, user_id: str) -> dict[str, Any]:
        """Return quiz without correct answers."""
        quiz = self.repo.get_quiz(quiz_id, user_id)
        if not quiz:
            raise CustomError(ERROR_CODES["QUIZ_NOT_FOUND"])
        return success_response("Quiz loaded", quiz)

    def submit(
        self,
        quiz_id: str,
        user_id: str,
        answers: dict[str, list[str]],
    ) -> dict[str, Any]:
        """Score quiz and generate AI feedback."""
        quiz = self.repo.get_quiz(quiz_id, user_id, include_answers=True)
        if not quiz:
            raise CustomError(ERROR_CODES["QUIZ_NOT_FOUND"])

        evaluation = QuizEngine.evaluate(quiz["questions"], answers)
        feedback = self._generate_feedback(quiz, answers, evaluation)
        attempt = self.repo.save_attempt(
            quiz_id, user_id, answers, evaluation, feedback
        )
        return success_response("Quiz submitted", {
            "attempt_id": attempt["id"],
            "evaluation": evaluation,
            "feedback": feedback,
        })

    def _generate_feedback(
        self,
        quiz: dict[str, Any],
        answers: dict[str, list[str]],
        evaluation: dict[str, Any],
    ) -> dict[str, Any]:
        """Generate structured AI feedback after scoring."""
        prompt = prompts.QUIZ_FEEDBACK_PROMPT.format(
            quiz=json.dumps(quiz, indent=2),
            answers=json.dumps(answers, indent=2),
            evaluation=json.dumps(evaluation, indent=2),
        )
        return self.llm.generate_structured(
            prompt,
            QUIZ_FEEDBACK_SCHEMA,
            system_prompt=prompts.SYSTEM_PROMPT,
        )
