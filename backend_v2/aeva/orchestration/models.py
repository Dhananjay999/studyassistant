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
    # "Exam level" — an exam key (see quiz.exam_patterns.TARGET_EXAMS) the
    # quiz is pitched at instead of a difficulty band.
    target_exam: str | None = None
    question_types: list[str] | None = None
    use_media: bool | None = None
    # Free-text extra guidance the user typed in the form; passed to the tool.
    additional_instructions: str | None = None
    # Exam Mode marking scheme + timer chosen in the form (empty/None = an
    # ordinary practice quiz). Persisted with the quiz and reused every attempt.
    exam_config: dict[str, Any] | None = None


@dataclass
class FlashcardOptions:
    """Forces deterministic flashcard generation from a specific card."""

    count: int | None = None


# Input widgets the client can render for a clarifying question. The planner
# picks the best fit per question; unknown values fall back to chips.
CLARIFICATION_INPUT_TYPES = (
    "short_text",
    "long_text",
    "number",
    "single_select",
    "multi_select",
    "chips",
    "dropdown",
    "radio",
    "toggle",
    "true_false",
)


@dataclass
class ClarificationQuestion:
    """A single clarifying question."""

    id: str
    text: str
    options: list[str] | None = None
    # How the client should render the answer input (see
    # CLARIFICATION_INPUT_TYPES). The client always adds its own
    # "Other" escape hatch for option-based types.
    input_type: str = "chips"


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
    # Forces deterministic flashcard generation (Create Flashcards action).
    flashcard_options: FlashcardOptions | None = None
    # Exact content the action targets (a specific response/quiz card). When
    # present, the turn is grounded ONLY on this — conversation history is
    # dropped so an action always operates on its own card.
    source_content: str | None = None


# Tools that produce the streamed text answer (at most one per turn) versus
# tools that produce an artifact (quiz, flashcard set, image) and can run in
# parallel as generator agents.
ANSWER_TOOLS = frozenset({"general", "product_info", "web_search", "media_llm"})
GENERATOR_TOOLS = frozenset({
    "quiz_generator",
    "flashcard_generator",
    "image_generator",
})
STEP_KIND_ANSWER = "answer"
STEP_KIND_GENERATOR = "generator"
STEP_INPUT_MESSAGE = "message"
STEP_INPUT_ANSWER = "answer"


@dataclass
class Step:
    """One planned agent of a turn (a normalized planner step)."""

    id: str
    tool: str
    kind: str
    params: dict[str, Any] = field(default_factory=dict)
    model: str | None = None
    # Which ``LLM_*_MODEL`` config pair to resolve through (fast path).
    config_key: str | None = None
    purpose: str = ""
    # "message": independent of the answer (starts immediately, in parallel);
    # "answer": built from the answer agent's output (starts after it).
    input: str = STEP_INPUT_MESSAGE

    def to_public(self) -> dict[str, Any]:
        """Client-facing description (no params — they may hold content)."""
        return {
            "id": self.id,
            "tool": self.tool,
            "kind": self.kind,
            "input": self.input,
            "purpose": self.purpose,
        }


@dataclass
class AssistantResult:
    """Output from the orchestrator."""

    status: RunStatus
    run_id: str | None = None
    clarification: ClarificationRequest | None = None
    tool_used: str | None = None
    content: dict[str, Any] | None = None
    message_id: str | None = None
    # Persisted id of the user's message this turn (None on a clarification
    # reply, which persists no user bubble).
    user_message_id: str | None = None
    display_text: str = ""
    # Every tool that ran this turn (``tool_used`` is the primary one).
    tools_used: list[str] = field(default_factory=list)
