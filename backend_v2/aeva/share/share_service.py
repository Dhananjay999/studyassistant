"""Generic sharing business logic.

An owner mints one stable, opaque share id per resource; anyone with the link
can view the resolved content (subject to visibility/expiry) at
``/share/{share_id}``. Content is always re-resolved live from its source of
truth via the content type's resolver — the share row only carries a preview
metadata snapshot and analytics counters.
"""

import secrets
from datetime import UTC, datetime
from typing import Any

from aeva.common.errors import ERROR_CODES, CustomError
from aeva.common.schema import success_response
from aeva.share.resolvers import get_resolver
from aeva.share.share_repository import ShareRepository

# How many unique ids to try before giving up (collisions are astronomically
# unlikely with token_urlsafe(9) → 12 chars of base64url).
_ID_RETRIES = 5

VISIBILITIES = ("public", "unlisted", "private")


def _expired(share: dict[str, Any]) -> bool:
    """Return True when the share carries an expiry that has passed."""
    raw = share.get("expires_at")
    if not raw:
        return False
    try:
        expires = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return False
    return expires <= datetime.now(UTC)


class ShareService:
    """Create, manage, and publicly resolve shares of any content type."""

    def __init__(self, repo: ShareRepository | None = None) -> None:
        self._repo = repo

    @property
    def repo(self) -> ShareRepository:
        """Lazy repository."""
        return self._repo or ShareRepository()

    def _share_url(self, base_url: str, share_id: str) -> str:
        """Absolute backend share link (renders OG tags, redirects humans)."""
        return f"{base_url.rstrip('/')}/share/{share_id}"

    # ------------------------------- owner -------------------------------- #

    def _ensure_share(
        self,
        owner_user_id: str,
        content_type: str,
        content_id: str,
        visibility: str = "unlisted",
    ) -> dict[str, Any]:
        """Return the resource's live share row, minting one if needed."""
        resolver = get_resolver(content_type)
        existing = self.repo.get_by_content(
            owner_user_id, content_type, content_id
        )
        if existing:
            return existing

        # snapshot() doubles as the ownership check — it raises when the
        # content doesn't exist or isn't the caller's.
        metadata = resolver.snapshot(content_id, owner_user_id)
        row = None
        for _ in range(_ID_RETRIES):
            share_id = secrets.token_urlsafe(9)
            if self.repo.get_by_share_id(share_id):
                continue  # extremely unlikely collision — try again
            row = self.repo.insert(
                share_id=share_id,
                owner_user_id=owner_user_id,
                content_type=content_type,
                content_id=content_id,
                metadata=metadata,
                visibility=visibility,
            )
            break
        if not row:
            raise CustomError(ERROR_CODES["INTERNAL_ERROR"])

        # Post-create hook: resolvers may attach companion shares (e.g. a
        # result share mints the quiz share powering its attempt CTA).
        extra = resolver.on_create(
            content_id,
            owner_user_id,
            lambda ctype, cid: self._ensure_share(owner_user_id, ctype, cid),
        )
        if extra:
            row["metadata"] = {**(row.get("metadata") or {}), **extra}
            self.repo.update(
                row["id"], owner_user_id, {"metadata": row["metadata"]}
            )
        return row

    def create(
        self,
        owner_user_id: str,
        content_type: str,
        content_id: str,
        base_url: str,
        visibility: str = "unlisted",
    ) -> dict[str, Any]:
        """Create (or reuse) the owner's share link for any resource."""
        row = self._ensure_share(
            owner_user_id, content_type, content_id, visibility
        )
        return success_response("Share link ready", {
            "share_id": row["share_id"],
            "content_type": row["content_type"],
            "url": self._share_url(base_url, row["share_id"]),
        })

    def _owned(self, share_id: str, owner_user_id: str) -> dict[str, Any]:
        """Load a live share and assert the caller owns it."""
        share = self.repo.get_by_share_id(share_id)
        if not share or share["owner_user_id"] != owner_user_id:
            raise CustomError(ERROR_CODES["NOT_FOUND"])
        return share

    def get(
        self, share_id: str, owner_user_id: str, base_url: str
    ) -> dict[str, Any]:
        """Owner view of a share: settings + central analytics."""
        share = self._owned(share_id, owner_user_id)
        return success_response("Share loaded", {
            "share_id": share["share_id"],
            "content_type": share["content_type"],
            "content_id": share["content_id"],
            "url": self._share_url(base_url, share["share_id"]),
            "visibility": share["visibility"],
            "expires_at": share.get("expires_at"),
            "metadata": share.get("metadata") or {},
            "analytics": {
                "total_views": share.get("total_views") or 0,
                "total_opens": share.get("total_opens") or 0,
                "total_attempts": share.get("total_attempts") or 0,
                "last_viewed_at": share.get("last_viewed_at"),
                "created_at": share.get("created_at"),
            },
        })

    def update(
        self,
        share_id: str,
        owner_user_id: str,
        *,
        visibility: str | None = None,
        expires_at: str | None = None,
    ) -> dict[str, Any]:
        """Update share settings (visibility / expiry)."""
        share = self._owned(share_id, owner_user_id)
        fields: dict[str, Any] = {}
        if visibility is not None:
            fields["visibility"] = visibility
        if expires_at is not None:
            fields["expires_at"] = expires_at
        if fields:
            self.repo.update(share["id"], owner_user_id, fields)
        return success_response("Share updated", {
            "share_id": share["share_id"],
            "visibility": visibility or share["visibility"],
        })

    def delete(self, share_id: str, owner_user_id: str) -> dict[str, Any]:
        """Soft-delete a share; the public link stops resolving."""
        share = self._owned(share_id, owner_user_id)
        self.repo.update(
            share["id"], owner_user_id, {"deleted_at": "now()"}
        )
        return success_response("Share deleted", {"share_id": share_id})

    # ------------------------------- public ------------------------------- #

    def _accessible(self, share_id: str) -> dict[str, Any]:
        """Load a share a guest may access; 404s private/expired/deleted."""
        share = self.repo.get_by_share_id(share_id)
        if (
            not share
            or share["visibility"] == "private"
            or not share.get("allow_anonymous", True)
            or _expired(share)
        ):
            raise CustomError(ERROR_CODES["NOT_FOUND"])
        return share

    def resolve_public(self, share_id: str) -> dict[str, Any]:
        """Resolve a share into its normalized public payload.

        Counts an `open` (content actually loaded).
        """
        share = self._accessible(share_id)
        content = get_resolver(share["content_type"]).resolve(share)
        self.repo.increment(share["id"], "opens")
        return success_response("Share resolved", {
            "share_id": share["share_id"],
            "content_type": share["content_type"],
            "metadata": share.get("metadata") or {},
            "content": content,
            "created_at": share.get("created_at"),
        })

    def og_meta(self, share_id: str) -> dict[str, Any]:
        """Social-preview fields for the OG page. Counts a `view`."""
        share = self._accessible(share_id)
        meta = get_resolver(share["content_type"]).og_meta(share)
        self.repo.increment(share["id"], "views")
        return meta

    def og_image(self, share_id: str) -> bytes | None:
        """Render the content type's PNG preview image, if any."""
        share = self._accessible(share_id)
        return get_resolver(share["content_type"]).og_image(share)

    def submit(
        self, share_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        """Handle a guest interaction (e.g. a shared-quiz attempt)."""
        share = self._accessible(share_id)
        data, attempt_meta = get_resolver(share["content_type"]).submit(
            share, payload
        )
        self.repo.increment(share["id"], "attempts")
        self.repo.insert_attempt(share["id"], attempt_meta)
        return success_response("Submitted", data)
