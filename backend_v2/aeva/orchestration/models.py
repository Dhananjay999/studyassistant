"""Orchestration models."""

from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any


class ClarificationAction(StrEnum):
    """How the user responds to clarification."""

    ANSWER = "answer"
    CUSTOM = "custom"
    SKIP = "skip"


class RunStatus(StrEnum):
    """Orchestration result status."""

    CLARIFICATION_REQUIRED = "clarification_required"
    QUIZ_SETUP = "quiz_setup"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class QuizOptions:
    """User-chosen quiz settings from the setup popover."""

    topic: str | None = None
    question_count: int | None = None
    difficulty: str | None = None
    question_types: list[str] | None = None
    use_media: bool | None = None


@dataclass
class ClarificationQuestion:
    """A single clarifying question."""

    id: str
    text: str
    options: list[str] | None = None


@dataclass
class ClarificationRequest:
    """Clarification payload returned to the client."""

    reason: str
    questions: list[ClarificationQuestion]


@dataclass
class UserClarificationResponse:
    """User reply to a clarification request."""

    action: ClarificationAction
    answers: dict[str, str] = field(default_factory=dict)
    custom_text: str | None = None


@dataclass
class AssistantContext:
    """Input to the orchestrator."""

    user_id: str
    session_id: str
    message: str
    media_ids: list[str] | None = None
    run_id: str | None = None
    clarification: UserClarificationResponse | None = None
    # Set when the user submits the quiz-setup popover; triggers deterministic
    # quiz generation instead of LLM planning.
    quiz_options: QuizOptions | None = None


@dataclass
class AssistantResult:
    """Output from the orchestrator."""

    status: RunStatus
    run_id: str | None = None
    clarification: ClarificationRequest | None = None
    tool_used: str | None = None
    content: dict[str, Any] | None = None
    message_id: str | None = None
    display_text: str = ""
