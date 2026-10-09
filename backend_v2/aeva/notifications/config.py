"""Notification settings (env) and the tuning constants of the return hook.

Read straight from the environment so the app factory needs no new config
lines. Off by default: with ``NOTIFICATIONS_ENABLED`` unset the pending
endpoint answers "nothing waiting" without running a query.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

_TRUE = ("1", "true", "yes", "on")

# A quiz / flashcard set is "waiting" when it was created at least
# SETTLE_MINUTES ago (so something generated a minute ago is not nagged
# about) and at most LOOKBACK_DAYS ago (so old leftovers age out).
SETTLE_MINUTES = 30
LOOKBACK_DAYS = 14

KIND_PLAN = "plan"
KIND_REVISION = "revision"
KIND_QUIZ = "quiz"
KIND_FLASHCARDS = "flashcards"


@dataclass(frozen=True)
class NotificationSettings:
    """Env-driven switch for the return hook."""

    enabled: bool = False

    @staticmethod
    def from_env() -> NotificationSettings:
        """Build from the process environment (optional)."""
        return NotificationSettings(
            enabled=os.environ.get("NOTIFICATIONS_ENABLED", "").strip().lower()
            in _TRUE,
        )
