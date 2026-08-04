"""Content resolvers for the generic sharing platform.

A resolver adapts one content type to the shared flow: it validates ownership
and snapshots preview metadata at share time, re-resolves the live public-safe
content at view time, and describes the social (OG) preview. Adding a new
shareable resource = subclass ``ShareResolver`` + ``register()`` it here. No
new tables, endpoints, or business logic elsewhere.

The share row never duplicates content — resolvers always load the original
via ``content_id`` (scoped to the share's owner), so there is a single source
of truth.
"""

from abc import ABC, abstractmethod
from collections.abc import Callable
from typing import Any, ClassVar

from aeva.common.errors import ERROR_CODES, CustomError
from aeva.quiz import exam_patterns
from aeva.quiz.quiz_engine import QuizEngine
from aeva.quiz.quiz_repository import QuizRepository
from aeva.quiz.share_og import render_quiz_og_png, render_result_og_png

# Mints/reuses a companion share; passed into ``on_create`` so resolvers can
# link related shares (e.g. a result share needs its quiz attemptable).
EnsureShare = Callable[[str, str], dict[str, Any]]


class ShareResolver(ABC):
    """One content type's adapter into the generic share flow."""

    #: App-level content-type enum value (also stored on the share row).
    content_type: ClassVar[str]

    @abstractmethod
    def snapshot(self, content_id: str, owner_user_id: str) -> dict[str, Any]:
        """Validate ownership and return the preview metadata snapshot.

        Raises NOT_FOUND when the content doesn't exist or isn't theirs.
        """

    def on_create(
        self,
        content_id: str,
        owner_user_id: str,
        ensure_share: EnsureShare,
    ) -> dict[str, Any]:
        """Return extra metadata once the share exists (companion links)."""
        del content_id, owner_user_id, ensure_share
        return {}

    @abstractmethod
    def resolve(self, share: dict[str, Any]) -> dict[str, Any]:
        """Load the live, public-safe content for a share.

        Never includes answers or internal ids a guest shouldn't see.
        """

    @abstractmethod
    def og_meta(self, share: dict[str, Any]) -> dict[str, Any]:
        """Social preview fields: ``title``, ``description``, ``has_image``."""

    def og_image(self, share: dict[str, Any]) -> bytes | None:
        """Render an optional PNG social preview image."""
        del share
        return None

    def submit(
        self, share: dict[str, Any], payload: dict[str, Any]
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        """Handle a guest interaction (e.g. attempt a quiz).

        Returns ``(response_data, attempt_metadata)``; the service records
        the attempt + analytics. Default: the type isn't submittable.
        """
        del share, payload
        raise CustomError(ERROR_CODES["NOT_FOUND"])


# ------------------------------------------------------------------------- #
#                                   Quiz                                     #
# ------------------------------------------------------------------------- #


class QuizShareResolver(ShareResolver):
    """Share a quiz: guests can view (no answers) and attempt it."""

    content_type = "quiz"

    def __init__(self, repo: QuizRepository | None = None) -> None:
        self._repo = repo

    @property
    def repo(self) -> QuizRepository:
        """Lazy repository."""
        return self._repo or QuizRepository()

    def _load_quiz(
        self, share: dict[str, Any], *, include_answers: bool
    ) -> dict[str, Any]:
        quiz = self.repo.get_quiz(
            share["content_id"],
            share["owner_user_id"],
            include_answers=include_answers,
        )
        if not quiz:
            raise CustomError(ERROR_CODES["NOT_FOUND"])
        return quiz

    def snapshot(self, content_id: str, owner_user_id: str) -> dict[str, Any]:
        """Ownership check + preview metadata for a quiz."""
        quiz = self.repo.get_quiz(content_id, owner_user_id)
        if not quiz:
            raise CustomError(ERROR_CODES["QUIZ_NOT_FOUND"])
        return {
            "title": quiz.get("title") or "Quiz",
            "topic": quiz.get("topic") or "",
            "difficulty": quiz.get("difficulty") or "medium",
            "question_count": len(quiz.get("questions") or []),
            "is_exam": bool((quiz.get("exam_config") or {}).get("pattern")),
        }

    def resolve(self, share: dict[str, Any]) -> dict[str, Any]:
        """Guest quiz payload — questions without answers or internal ids."""
        quiz = self._load_quiz(share, include_answers=False)
        # Don't leak the internal quiz UUID to guests — the share id is the
        # only public handle. (Per-question ids stay: answers key on them.)
        quiz.pop("id", None)
        quiz.pop("quiz_id", None)
        return quiz

    def og_meta(self, share: dict[str, Any]) -> dict[str, Any]:
        """Social preview copy for a shared quiz."""
        meta = share.get("metadata") or {}
        count = meta.get("question_count") or 0
        topic = meta.get("topic") or "this topic"
        return {
            "title": (
                f"{meta.get('title') or 'Quiz'} - {count} Questions"
                f" | StudyAssistant"
            ),
            "description": (
                f"Test your knowledge with this {count}-question {topic} "
                f"quiz generated with AI. Attempt it instantly for free on "
                f"StudyAssistant."
            ),
            "has_image": True,
        }

    def og_image(self, share: dict[str, Any]) -> bytes | None:
        """Render the dynamic quiz preview card."""
        meta = share.get("metadata") or {}
        return render_quiz_og_png(
            meta.get("title") or "Quiz",
            meta.get("topic") or "",
            meta.get("question_count") or 0,
            meta.get("difficulty") or "medium",
            is_exam=bool(meta.get("is_exam")),
        )

    def submit(
        self, share: dict[str, Any], payload: dict[str, Any]
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        """Score a guest attempt server-side (same engine as owners)."""
        quiz = self._load_quiz(share, include_answers=True)
        answers = payload.get("answers") or {}
        marking = exam_patterns.marking_from_config(quiz.get("exam_config"))
        evaluation = QuizEngine.evaluate(
            quiz["questions"], answers, marking=marking
        )
        evaluation["time_taken_seconds"] = max(
            int(payload.get("time_taken_seconds") or 0), 0
        )
        attempt_meta = {
            "score": evaluation.get("score"),
            "total": evaluation.get("total"),
            "correct_count": evaluation.get("correct_count"),
            "completed": True,
        }
        return {"evaluation": evaluation}, attempt_meta


# ------------------------------------------------------------------------- #
#                                Quiz result                                 #
# ------------------------------------------------------------------------- #


class QuizResultShareResolver(ShareResolver):
    """Share one attempt's result.

    Guests see the score summary (never the answers) plus an "Attempt This
    Quiz" link into the quiz's own share.
    """

    content_type = "quiz_result"

    def __init__(self, repo: QuizRepository | None = None) -> None:
        self._repo = repo

    @property
    def repo(self) -> QuizRepository:
        """Lazy repository."""
        return self._repo or QuizRepository()

    def _load(
        self, attempt_id: str, owner_user_id: str
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        """(attempt, quiz) scoped to the owner; raises when either is gone."""
        attempt = self.repo.get_attempt(attempt_id, owner_user_id)
        if not attempt:
            raise CustomError(ERROR_CODES["QUIZ_ATTEMPT_NOT_FOUND"])
        quiz = self.repo.get_quiz(attempt["quiz_id"], owner_user_id)
        if not quiz:
            raise CustomError(ERROR_CODES["QUIZ_NOT_FOUND"])
        return attempt, quiz

    @staticmethod
    def _summary(attempt: dict[str, Any]) -> dict[str, Any]:
        """Public-safe attempt summary (counts only, never answers)."""
        ev = attempt.get("evaluation") or {}
        return {
            "score": ev.get("score", attempt.get("score") or 0),
            "total": ev.get("total", 0),
            "correct_count": ev.get("correct_count", 0),
            "incorrect_count": ev.get("incorrect_count", 0),
            "partial_count": ev.get("partial_count", 0),
            "attempted_count": ev.get("attempted_count", 0),
            "unanswered_count": ev.get("unanswered_count", 0),
            "time_taken_seconds": ev.get("time_taken_seconds", 0),
            "final_score": ev.get("final_score"),
            "max_marks": ev.get("max_marks"),
            "attempted_at": attempt.get("created_at"),
        }

    def snapshot(self, content_id: str, owner_user_id: str) -> dict[str, Any]:
        """Ownership check + preview metadata for an attempt result."""
        attempt, quiz = self._load(content_id, owner_user_id)
        summary = self._summary(attempt)
        return {
            "title": quiz.get("title") or "Quiz",
            "topic": quiz.get("topic") or "",
            "difficulty": quiz.get("difficulty") or "medium",
            "question_count": len(quiz.get("questions") or []),
            "is_exam": bool((quiz.get("exam_config") or {}).get("pattern")),
            "score": summary["score"],
            "correct_count": summary["correct_count"],
            "total": summary["total"],
            "completed_at": summary["attempted_at"],
            "quiz_id": attempt["quiz_id"],
        }

    def on_create(
        self,
        content_id: str,
        owner_user_id: str,
        ensure_share: EnsureShare,
    ) -> dict[str, Any]:
        """Mint the companion quiz share so "Attempt This Quiz" always works."""
        attempt = self.repo.get_attempt(content_id, owner_user_id)
        if not attempt:
            raise CustomError(ERROR_CODES["QUIZ_ATTEMPT_NOT_FOUND"])
        quiz_share = ensure_share("quiz", attempt["quiz_id"])
        return {"quiz_share_id": quiz_share["share_id"]}

    def resolve(self, share: dict[str, Any]) -> dict[str, Any]:
        """Guest result view: quiz header + score summary + attempt CTA."""
        attempt, quiz = self._load(
            share["content_id"], share["owner_user_id"]
        )
        return {
            "quiz": {
                "title": quiz.get("title") or "Quiz",
                "topic": quiz.get("topic") or "",
                "difficulty": quiz.get("difficulty") or "medium",
                "question_count": len(quiz.get("questions") or []),
                "is_exam": bool(
                    (quiz.get("exam_config") or {}).get("pattern")
                ),
            },
            "result": self._summary(attempt),
            # Stored at create time; tolerated missing for older shares.
            "quiz_share_id": (share.get("metadata") or {}).get(
                "quiz_share_id"
            ),
        }

    def og_meta(self, share: dict[str, Any]) -> dict[str, Any]:
        """Social preview copy for a shared result."""
        meta = share.get("metadata") or {}
        score = round(meta.get("score") or 0)
        title = meta.get("title") or "Quiz"
        return {
            "title": f"{score}% on {title} | StudyAssistant",
            "description": (
                f"Scored {meta.get('correct_count') or 0}/"
                f"{meta.get('total') or 0} on the “{title}” quiz. See the "
                f"full result and attempt the quiz yourself on "
                f"StudyAssistant."
            ),
            "has_image": True,
        }

    def og_image(self, share: dict[str, Any]) -> bytes | None:
        """Render the dynamic score-card preview for a shared result."""
        meta = share.get("metadata") or {}
        return render_result_og_png(
            meta.get("title") or "Quiz",
            float(meta.get("score") or 0),
            int(meta.get("correct_count") or 0),
            int(meta.get("total") or 0),
            int(meta.get("question_count") or 0),
        )


# ------------------------------------------------------------------------- #
#                                  Registry                                  #
# ------------------------------------------------------------------------- #

_REGISTRY: dict[str, ShareResolver] = {}


# ------------------------------------------------------------------------- #
#                                   Note                                     #
# ------------------------------------------------------------------------- #


class NoteShareResolver(ShareResolver):
    """Share a note: guests get a read-only rendered view."""

    content_type = "note"

    def _load(self, content_id: str, owner_user_id: str) -> dict[str, Any]:
        from aeva.note.note_repository import NoteRepository

        return NoteRepository()._fetch(owner_user_id, content_id)  # noqa: SLF001

    def snapshot(self, content_id: str, owner_user_id: str) -> dict[str, Any]:
        """Ownership check + preview metadata for a note."""
        note = self._load(content_id, owner_user_id)
        body = note.get("content_md") or ""
        return {
            "title": note.get("title") or "Note",
            "preview": body[:200],
            "word_count": len(body.split()),
        }

    def resolve(self, share: dict[str, Any]) -> dict[str, Any]:
        """Guest note payload — title + markdown, no internal ids."""
        note = self._load(share["content_id"], share["owner_user_id"])
        return {
            "title": note.get("title") or "Note",
            "content_md": note.get("content_md") or "",
            "updated_at": note.get("updated_at"),
        }

    def og_meta(self, share: dict[str, Any]) -> dict[str, Any]:
        """Social preview copy for a shared note (text-only, no image)."""
        meta = share.get("metadata") or {}
        preview = (meta.get("preview") or "").replace("\n", " ").strip()
        return {
            "title": f"{meta.get('title') or 'Note'} | StudyAssistant",
            "description": (
                preview[:150]
                or "Study notes created with Aeva on StudyAssistant."
            ),
            "has_image": False,
        }


def register(resolver: ShareResolver) -> None:
    """Register a resolver for its content type."""
    _REGISTRY[resolver.content_type] = resolver


def get_resolver(content_type: str) -> ShareResolver:
    """Return the resolver for a content type (raises when unknown)."""
    resolver = _REGISTRY.get(content_type)
    if not resolver:
        raise CustomError(ERROR_CODES["VALIDATION_ERROR"])
    return resolver


def supported_content_types() -> list[str]:
    """All registered content types (drives request validation)."""
    return sorted(_REGISTRY)


register(QuizShareResolver())
register(QuizResultShareResolver())
register(NoteShareResolver())
