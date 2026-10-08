"""Exam Prep request schemas (marshmallow → frozen dataclasses)."""

import re
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta

from marshmallow import (
    Schema,
    ValidationError,
    fields,
    post_load,
    validate,
    validates,
)

from aeva.assistant.schema.assistant_schema import (
    DIFFICULTY_LEVELS,
    FlashcardOptionsSchema,
    QuizOptionsSchema,
)
from aeva.orchestration.models import FlashcardOptions, QuizOptions

TOPIC_STATUSES = ("not_started", "in_progress", "completed")
# What kind of exam the plan is for; drives the setup questionnaire and the
# syllabus research prompt. "other" keeps older clients working.
EXAM_KINDS = ("school", "board", "college", "unit", "competitive", "other")
MAX_SUBJECTS = 12
# Uploaded files a plan may be grounded in (one ``in_`` batch in the
# repository; the setup form lists the student's own library).
MAX_MATERIALS = 50
# Canonical UUID text. Ids go straight into uuid column filters, where a
# malformed value is a PostgREST 22P02 error (a 500), not a 404 — so reject
# them here, at the boundary.
UUID_PATTERN = (
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}"
    r"-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
_UUID_RE = re.compile(UUID_PATTERN)
# Hard caps on the request; the generator tools also clamp to the deployment's
# QUIZ_MAX_QUESTIONS / FLASHCARD_MAX_CARDS config.
MAX_QUESTIONS = 50
MAX_CARDS = 50
# A student west of UTC picking "today" late in their evening is already
# "yesterday" in UTC; allow one day of grace instead of rejecting them.
_DATE_GRACE = timedelta(days=1)


def is_uuid(value: object) -> bool:
    """Check for canonical UUID text (path and body ids)."""
    return isinstance(value, str) and _UUID_RE.match(value) is not None


def _uuid_field(**kwargs: object) -> fields.Str:
    """Build a string field that must be a canonical UUID."""
    return fields.Str(
        validate=validate.Regexp(_UUID_RE, error="Not a valid id."),
        **kwargs,  # type: ignore[arg-type]
    )


@dataclass(frozen=True)
class CreateExamPlanData:
    """Validated create-plan payload."""

    exam_name: str
    exam_date: date
    subjects: list[str]
    class_level: str = ""
    stream: str = ""
    daily_minutes: int = 120
    target_score: str | None = None
    syllabus_text: str | None = None
    material_media_ids: list[str] = field(default_factory=list)
    exam_kind: str = "other"
    # Board / university / conducting body ("CBSE", "Maharashtra State
    # Board", "Mumbai University"); free text, prompt-only.
    board: str = ""
    # Anything specific the student told us ("English medium, Physics and
    # Chemistry only, first attempt"); free text, prompt-only.
    exam_details: str = ""
    # Research the official syllabus / pattern online before planning.
    research: bool = True


class CreateExamPlanSchema(Schema):
    """Create an exam plan (setup form)."""

    exam_name = fields.Str(
        required=True, validate=validate.Length(min=1, max=80)
    )
    exam_date = fields.Date(required=True)
    class_level = fields.Str(load_default="", validate=validate.Length(max=60))
    stream = fields.Str(load_default="", validate=validate.Length(max=60))
    subjects = fields.List(
        fields.Str(validate=validate.Length(min=1, max=40)),
        required=True,
        validate=validate.Length(min=1, max=MAX_SUBJECTS),
    )
    daily_minutes = fields.Int(
        load_default=120, validate=validate.Range(min=15, max=720)
    )
    target_score = fields.Str(
        load_default=None, allow_none=True, validate=validate.Length(max=60)
    )
    syllabus_text = fields.Str(
        load_default=None,
        allow_none=True,
        validate=validate.Length(max=8000),
    )
    material_media_ids = fields.List(
        _uuid_field(),
        load_default=list,
        validate=validate.Length(max=MAX_MATERIALS),
    )
    exam_kind = fields.Str(
        load_default="other", validate=validate.OneOf(list(EXAM_KINDS))
    )
    board = fields.Str(load_default="", validate=validate.Length(max=80))
    exam_details = fields.Str(
        load_default="", validate=validate.Length(max=300)
    )
    research = fields.Bool(load_default=True)

    @validates("exam_date")
    def _not_in_the_past(self, value: date, **_kwargs: object) -> None:
        """Reject an exam date in the past (UTC, one day of grace)."""
        if value < datetime.now(tz=UTC).date() - _DATE_GRACE:
            raise ValidationError("Exam date must be today or later.")

    @post_load
    def make_data(self, data: dict, **_kwargs: object) -> CreateExamPlanData:
        """Convert to dataclass (subjects trimmed and de-duplicated)."""
        subjects = list(
            dict.fromkeys(
                s.strip() for s in data["subjects"] if s and s.strip()
            )
        )
        if not subjects:
            raise ValidationError(
                "Add at least one subject.", field_name="subjects"
            )
        data["subjects"] = subjects
        # Length was validated on the raw value; a whitespace-only name
        # would otherwise be stored as "".
        exam_name = data["exam_name"].strip()
        if not exam_name:
            raise ValidationError(
                "Enter the exam name.", field_name="exam_name"
            )
        data["exam_name"] = exam_name
        data["material_media_ids"] = list(
            dict.fromkeys(data.get("material_media_ids") or [])
        )
        data["board"] = (data.get("board") or "").strip()
        data["exam_details"] = (data.get("exam_details") or "").strip()
        return CreateExamPlanData(**data)


@dataclass(frozen=True)
class UpdateTopicStatusData:
    """Validated topic status patch."""

    status: str


class UpdateTopicStatusSchema(Schema):
    """Set a topic's progress status."""

    status = fields.Str(
        required=True, validate=validate.OneOf(list(TOPIC_STATUSES))
    )

    @post_load
    def make_data(self, data: dict, **_kwargs: object) -> UpdateTopicStatusData:
        """Convert to dataclass."""
        return UpdateTopicStatusData(**data)


@dataclass(frozen=True)
class TopicQuizData:
    """Validated on-demand topic quiz options (all optional)."""

    question_count: int | None = None
    difficulty: str | None = None
    question_types: list[str] | None = None


class TopicQuizSchema(Schema):
    """Generate a quiz for one plan topic."""

    question_count = fields.Int(
        load_default=None,
        allow_none=True,
        validate=validate.Range(min=1, max=MAX_QUESTIONS),
    )
    difficulty = fields.Str(
        load_default=None,
        allow_none=True,
        validate=validate.OneOf(DIFFICULTY_LEVELS),
    )
    question_types = fields.List(
        fields.Str(), load_default=None, allow_none=True
    )

    @post_load
    def make_data(self, data: dict, **_kwargs: object) -> TopicQuizData:
        """Convert to dataclass."""
        return TopicQuizData(**data)


@dataclass(frozen=True)
class TopicFlashcardsData:
    """Validated on-demand topic flashcard options (all optional)."""

    count: int | None = None


class TopicFlashcardsSchema(Schema):
    """Generate flashcards for one plan topic."""

    count = fields.Int(
        load_default=None,
        allow_none=True,
        validate=validate.Range(min=1, max=MAX_CARDS),
    )

    @post_load
    def make_data(self, data: dict, **_kwargs: object) -> TopicFlashcardsData:
        """Convert to dataclass."""
        return TopicFlashcardsData(**data)


class ExamMessagesQuerySchema(Schema):
    """``?limit=&topic_id=`` for the exam conversation history (newest N).

    With ``topic_id`` only that topic's turns are returned (the user
    messages sent from its page and the replies that followed them).
    """

    limit = fields.Int(load_default=60, validate=validate.Range(min=1, max=200))
    topic_id = _uuid_field(load_default=None, allow_none=True)


@dataclass(frozen=True)
class LessonStreamData:
    """Validated lesson stream request."""

    regenerate: bool = False


class LessonStreamSchema(Schema):
    """Stream (and cache) the lesson for a topic; ``regenerate`` redoes it."""

    regenerate = fields.Bool(load_default=False)

    @post_load
    def make_data(self, data: dict, **_kwargs: object) -> LessonStreamData:
        """Convert to dataclass."""
        return LessonStreamData(**data)


@dataclass(frozen=True)
class ExamChatRequestData:
    """Validated exam-coach chat turn."""

    message: str
    topic_id: str | None = None
    day_id: str | None = None
    quiz_options: QuizOptions | None = None
    flashcard_options: FlashcardOptions | None = None
    # Study material the student has selected as context on the topic page
    # (the plan's materials by default). None/empty = no explicit selection.
    media_ids: list[str] | None = None


class ExamChatRequestSchema(Schema):
    """One exam-coach message (same options as the chat composer)."""

    message = fields.Str(required=True, validate=validate.Length(min=1))
    topic_id = _uuid_field(load_default=None, allow_none=True)
    day_id = _uuid_field(load_default=None, allow_none=True)
    quiz_options = fields.Nested(QuizOptionsSchema, load_default=None)
    flashcard_options = fields.Nested(FlashcardOptionsSchema, load_default=None)
    media_ids = fields.List(
        _uuid_field(),
        load_default=None,
        allow_none=True,
        validate=validate.Length(max=20),
    )

    @post_load
    def make_data(self, data: dict, **_kwargs: object) -> ExamChatRequestData:
        """Convert to dataclass (nested dicts exactly as the chat schema)."""
        opts = data.get("quiz_options")
        if isinstance(opts, dict):
            data["quiz_options"] = QuizOptions(
                topic=opts.get("topic"),
                question_count=opts.get("question_count"),
                difficulty=opts.get("difficulty"),
                target_exam=opts.get("target_exam"),
                question_types=opts.get("question_types"),
                use_media=opts.get("use_media"),
                additional_instructions=opts.get("additional_instructions"),
                exam_config=opts.get("exam_config"),
            )
        fc = data.get("flashcard_options")
        if isinstance(fc, dict):
            data["flashcard_options"] = FlashcardOptions(count=fc.get("count"))
        if data.get("media_ids") is not None:
            data["media_ids"] = list(dict.fromkeys(data["media_ids"])) or None
        return ExamChatRequestData(**data)
