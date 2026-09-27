"""Backfill: re-chunk and re-embed uploads onto the current embedding layout.

Migration 023 adds ``media_chunks.context`` and ``embedding_version``; chunks
indexed before it (version 1) lack the ``file | section | page`` header in
their embedded text. Retrieval still works on them, but headers improve
section-level recall, so run this once after the migration::

    poetry run poe reindex-media            # everything still on version 1
    poetry run poe reindex-media -- --limit 20 --dry-run

Runs locally against the configured Supabase project (never on Vercel: a
large library takes minutes). Each document is rebuilt from its stored
``parsed.json`` — no LlamaParse call.
"""

import argparse
import logging
import sys
from typing import Any

from aeva.app import create_app
from aeva.media.chunking import EMBEDDING_VERSION
from aeva.supabase.supabase_service import SupabaseService

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("reindex")


def _stale_documents(
    supabase: SupabaseService, limit: int
) -> list[dict[str, Any]]:
    """Distinct (media_id, user_id) pairs with chunks below the version."""
    result = (
        supabase.client.table("media_chunks")
        .select("media_id,user_id")
        .lt("embedding_version", EMBEDDING_VERSION)
        .limit(limit * 50)
        .execute()
    )
    seen: dict[str, dict[str, Any]] = {}
    for row in result.data or []:
        seen.setdefault(str(row["media_id"]), dict(row))
        if len(seen) >= limit:
            break
    return list(seen.values())


def main() -> int:
    """CLI entry point."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=1000)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    app = create_app()
    with app.app_context():
        supabase = SupabaseService()
        processor = app.extensions["container"].media_processor()
        docs = _stale_documents(supabase, args.limit)
        logger.info("%d document(s) on an older embedding layout", len(docs))
        failed = 0
        for doc in docs:
            media_id, user_id = doc["media_id"], doc["user_id"]
            if args.dry_run:
                logger.info("would re-index %s (user %s)", media_id, user_id)
                continue
            last: dict[str, Any] = {}
            for event in processor.reindex(user_id, media_id):
                last = event
            status = last.get("stage")
            if status != "ready":
                failed += 1
            logger.info("%s -> %s %s", media_id, status, last.get("msg", ""))
        logger.info(
            "done | %d re-indexed, %d failed", len(docs) - failed, failed
        )
        return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
