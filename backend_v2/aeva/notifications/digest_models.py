"""Plain data shapes of the return hook."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from aeva.notifications.config import KIND_FLASHCARDS, KIND_PLAN, KIND_QUIZ


@dataclass(frozen=True)
class DigestItem:
    """One thing waiting for a user.

    ``count`` is topics still open today (plan), topics due (revision) or
    unused artifacts (quiz / flashcards). ``target_id`` is what one tap
    opens: the plan day, the newest waiting quiz or the newest waiting set.
    """

    kind: str
    count: int
    target_id: str | None = None
    plan_id: str | None = None
    day_number: int | None = None
    total_days: int | None = None

    def to_api(self) -> dict[str, Any]:
        """Shape returned by GET /notifications/pending (ids and counts)."""
        data: dict[str, Any] = {"kind": self.kind, "count": self.count}
        if self.kind == KIND_PLAN:
            data.update(
                plan_id=self.plan_id,
                day_id=self.target_id,
                day_number=self.day_number,
                total_days=self.total_days,
            )
        elif self.kind == KIND_QUIZ:
            data["quiz_id"] = self.target_id
        elif self.kind == KIND_FLASHCARDS:
            data["set_id"] = self.target_id
        return data


@dataclass(frozen=True)
class Digest:
    """Everything waiting for one user, most important first."""

    user_id: str
    items: tuple[DigestItem, ...]

    @property
    def kinds(self) -> list[str]:
        """Kinds present, in display order."""
        return [item.kind for item in self.items]
