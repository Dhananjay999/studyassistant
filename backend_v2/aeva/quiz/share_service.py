"""Public quiz-sharing business logic.

An owner mints one stable, opaque share token per quiz. Anyone with the token
can view the quiz (without answers) and submit an attempt, which is scored
server-side with the same engine as a normal attempt. Guest attempts are stored
anonymously for the owner's analytics.

Security: the guest path loads the quiz via the OWNER's user_id (carried on the
share row) so it reuses the user-scoped repository access, and never returns
`correct_answers` on the read path — answers are only read server-side to score.
"""

import secrets
from typing import Any

from aeva.common.errors import ERROR_CODES, CustomError
from aeva.common.schema import success_response
from aeva.quiz import exam_patterns
from aeva.quiz.quiz_engine import QuizEngine
from aeva.quiz.quiz_repository import QuizRepository

# How many unique tokens to try before giving up (collisions are astronomically
# unlikely with token_urlsafe(9) → 12 chars of base64url).
_TOKEN_RETRIES = 5


class QuizShareService:
    """Create share links and serve public (guest) quiz access."""

    def __init__(self, repo: QuizRepository | None = None) -> None:
        self._repo = repo

    @property
    def repo(self) -> QuizRepository:
        """Lazy repository."""
        return self._repo or QuizRepository()

    def _share_url(self, base_url: str, token: str) -> str:
        """Build the absolute backend share link for a token."""
        return f"{base_url.rstrip('/')}/shared/quiz/{token}"

    def create_share(
        self, quiz_id: str, user_id: str, base_url: str
    ) -> dict[str, Any]:
        """Create (or reuse) the owner's share link for a quiz."""
        # Ownership check — get_quiz is user-scoped, so a non-owner gets None.
        if not self.repo.get_quiz(quiz_id, user_id):
            raise CustomError(ERROR_CODES["QUIZ_NOT_FOUND"])

        existing = self.repo.get_share_by_quiz(quiz_id, user_id)
        if existing:
            return success_response("Share link ready", {
                "token": existing["share_token"],
                "url": self._share_url(base_url, existing["share_token"]),
            })

        share = None
        for _ in range(_TOKEN_RETRIES):
            token = secrets.token_urlsafe(9)
            if self.repo.get_share(token):
                continue  # extremely unlikely collision — try again
            share = self.repo.create_share(quiz_id, user_id, token)
            break
        if not share:
            raise CustomError(ERROR_CODES["QUIZ_NOT_FOUND"])

        return success_response("Share link created", {
            "token": share["share_token"],
            "url": self._share_url(base_url, share["share_token"]),
        })

    def _load_shared(
        self, share_token: str, *, include_answers: bool
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        """Resolve a token → (share row, quiz). Raises if unknown/inactive."""
        share = self.repo.get_share(share_token)
        if not share:
            raise CustomError(ERROR_CODES["QUIZ_NOT_FOUND"])
        quiz = self.repo.get_quiz(
            share["quiz_id"], share["user_id"], include_answers=include_answers
        )
        if not quiz:
            raise CustomError(ERROR_CODES["QUIZ_NOT_FOUND"])
        return share, quiz

    def get_public_quiz(self, share_token: str) -> dict[str, Any]:
        """Guest quiz view (no answers). Counts a real human open."""
        share, quiz = self._load_shared(share_token, include_answers=False)
        self.repo.increment_share_open(share["id"])
        # Don't leak the internal quiz UUID to guests — the token is the only
        # public handle. (Per-question ids stay: answers are keyed by them.)
        quiz.pop("id", None)
        quiz.pop("quiz_id", None)
        return success_response("Shared quiz loaded", quiz)

    def get_meta(self, share_token: str) -> dict[str, Any]:
        """Return OG-page metadata (no side effects, no answers)."""
        _, quiz = self._load_shared(share_token, include_answers=False)
        questions = quiz.get("questions") or []
        return {
            "title": quiz.get("title") or "Quiz",
            "topic": quiz.get("topic") or "",
            "difficulty": quiz.get("difficulty") or "medium",
            "question_count": len(questions),
            "is_exam": bool((quiz.get("exam_config") or {}).get("pattern")),
        }

    def submit_public(
        self,
        share_token: str,
        answers: dict[str, list[str]],
        time_taken_seconds: int = 0,
    ) -> dict[str, Any]:
        """Score a guest attempt server-side and record it anonymously."""
        share, quiz = self._load_shared(share_token, include_answers=True)

        marking = exam_patterns.marking_from_config(quiz.get("exam_config"))
        evaluation = QuizEngine.evaluate(
            quiz["questions"], answers, marking=marking
        )
        evaluation["time_taken_seconds"] = max(int(time_taken_seconds), 0)

        self.repo.increment_share_attempt(share["id"])
        self.repo.insert_share_attempt(
            share["id"], share["quiz_id"], evaluation
        )

        return success_response("Quiz submitted", {"evaluation": evaluation})
