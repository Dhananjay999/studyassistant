"""What a user has waiting (the chat "waiting for you" strip).

``DigestService`` answers one question, "what does this user have waiting",
from state the backend already keeps:

* today's exam-plan day and how many of its topics are still open,
* revision topics that are due (the revision engine's own rule, see
  ``revision_engine.due_window``),
* quizzes that were created and never attempted,
* flashcard sets that were created and never studied.

It serves ``GET /notifications/pending`` with one grouped query.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from aeva.feature_flag import feature_flag_service
from aeva.notifications import config as cfg
from aeva.notifications.config import NotificationSettings
from aeva.notifications.digest_models import Digest, DigestItem
from aeva.notifications.notification_repository import NotificationRepository
from aeva.revision import revision_engine
from aeva.revision.revision_engine import RevisionConfig

logger = logging.getLogger(__name__)


def _int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _id(value: Any) -> str | None:
    return str(value) if value else None


def digest_from_row(
    row: dict[str, Any], *, plan_enabled: bool, revision_enabled: bool
) -> Digest | None:
    """Shape one ``notification_digest_counts`` row; None if nothing is left.

    Order is the order the user sees: today's plan, revision, quiz,
    flashcards. A disabled feature's item is dropped so a link never leads
    to a page the app would redirect away from.
    """
    items: list[DigestItem] = []
    open_topics = _int(row.get("plan_topics_open"))
    if plan_enabled and open_topics > 0 and row.get("plan_day_id"):
        items.append(
            DigestItem(
                kind=cfg.KIND_PLAN,
                count=open_topics,
                target_id=_id(row.get("plan_day_id")),
                plan_id=_id(row.get("plan_id")),
                day_number=_int(row.get("plan_day_number")) or None,
                total_days=_int(row.get("plan_total_days")) or None,
            )
        )
    due = _int(row.get("revision_due"))
    if revision_enabled and due > 0:
        items.append(DigestItem(kind=cfg.KIND_REVISION, count=due))
    quizzes = _int(row.get("quizzes_waiting"))
    if quizzes > 0 and row.get("quiz_id"):
        items.append(
            DigestItem(
                kind=cfg.KIND_QUIZ,
                count=quizzes,
                target_id=_id(row.get("quiz_id")),
            )
        )
    sets = _int(row.get("sets_waiting"))
    if sets > 0 and row.get("set_id"):
        items.append(
            DigestItem(
                kind=cfg.KIND_FLASHCARDS,
                count=sets,
                target_id=_id(row.get("set_id")),
            )
        )
    if not items:
        return None
    return Digest(user_id=str(row["user_id"]), items=tuple(items))


class DigestService:
    """What is waiting for a user."""

    def __init__(
        self,
        repo: NotificationRepository | None = None,
        settings: NotificationSettings | None = None,
        revision_config: RevisionConfig | None = None,
    ) -> None:
        self.repo = repo or NotificationRepository()
        self.settings = settings or NotificationSettings.from_env()
        self._revision_config = revision_config

    # ---------------------------------------------------------- compute

    def digests_for(
        self,
        user_ids: list[str],
        now: datetime | None = None,
        tz_offset_minutes: int = 0,
    ) -> dict[str, Digest]:
        """Digest per user id, for the users that have something waiting.

        One grouped query for the whole list. "Due" is the revision
        engine's rule for the caller's local day; the plan day is the UTC
        calendar day, like the Exam Prep dashboard (``today_utc``).
        """
        if not user_ids:
            return {}
        now = now or datetime.now(UTC)
        revision_cfg = self._revision_config or RevisionConfig.from_app()
        window = revision_engine.due_window(
            revision_cfg, now, tz_offset_minutes
        )
        rows = self.repo.digest_counts(
            user_ids,
            today=now.date(),
            due_before=window.due_before,
            mastered_after=window.mastered_after,
            since=now - timedelta(days=cfg.LOOKBACK_DAYS),
            until=now - timedelta(minutes=cfg.SETTLE_MINUTES),
        )
        flags = feature_flag_service.get_flags()
        digests: dict[str, Digest] = {}
        for row in rows:
            digest = digest_from_row(
                row,
                plan_enabled=bool(flags.get("exam_prep", False)),
                revision_enabled=bool(flags.get("revision_mode", True)),
            )
            if digest is not None:
                digests[digest.user_id] = digest
        return digests

    def pending_for_user(
        self, user_id: str, tz_offset_minutes: int = 0
    ) -> dict[str, Any]:
        """Payload of GET /notifications/pending (ids and counts only).

        Never fails the chat page: when the hook is off, or migration 037
        is not applied yet, the answer is "nothing waiting".
        """
        if not self.settings.enabled:
            return {"enabled": False, "items": []}
        try:
            digest = self.digests_for(
                [user_id], tz_offset_minutes=tz_offset_minutes
            ).get(user_id)
        except Exception:  # noqa: BLE001 - degrade to an empty strip
            logger.warning("Pending notifications unavailable", exc_info=True)
            return {"enabled": True, "items": []}
        items = [item.to_api() for item in digest.items] if digest else []
        return {"enabled": True, "items": items}
