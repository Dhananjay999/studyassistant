"""Global feature flags: registry in code, overrides in the DB.

The FEATURE_FLAGS tuple below is the single source of truth for which flags
exist (key, label, description, default). The ``feature_flags`` table stores
only overrides, upserted lazily when an admin first toggles a flag — a
missing row means "use the default" (enabled), so adding a new flag is a
one-line change here with no SQL.

Reads go through a small module-level TTL cache so the hot paths (/config on
every app boot, the orchestrator on every chat turn) don't pay a Supabase
round-trip each time. The cache is per-process: on serverless, an admin
toggle busts the cache only in the instance that handled the PUT; other
instances converge within the TTL (≤60s), plus the frontend's /config
staleTime. Flags are a visibility control, not a security boundary.
"""

import logging
import time
from dataclasses import dataclass
from typing import Any

from aeva.supabase.supabase_service import SupabaseService

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class FeatureFlagDef:
    """One entry in the flag registry."""

    key: str
    label: str
    description: str
    default_enabled: bool = True


FEATURE_FLAGS: tuple[FeatureFlagDef, ...] = (
    FeatureFlagDef(
        "image_generation",
        "Image generation",
        "AI-generated diagrams and images in chat answers.",
    ),
    FeatureFlagDef(
        "web_search",
        "Web search",
        "Fresh-information web search tool in chat.",
    ),
    FeatureFlagDef(
        "revision_mode",
        "Revision mode",
        "Spaced-repetition dashboard, welcome screen and confidence prompts.",
    ),
    FeatureFlagDef(
        "study_spaces",
        "Study spaces",
        "Study Spaces pages, sidebar list and continue-learning rail.",
    ),
    FeatureFlagDef(
        "notes",
        "Notes",
        "Notes pages and the note editor.",
    ),
    FeatureFlagDef(
        "analytics",
        "Analytics",
        "The analytics dashboard tab.",
    ),
    FeatureFlagDef(
        "sharing",
        "Sharing",
        "Share buttons for quizzes, results and notes. Existing share "
        "links keep working when disabled.",
    ),
    FeatureFlagDef(
        "voice_input",
        "Voice input",
        "Microphone dictation button in the chat composer.",
    ),
)

DEFAULTS: dict[str, bool] = {f.key: f.default_enabled for f in FEATURE_FLAGS}
FLAG_KEYS: frozenset[str] = frozenset(DEFAULTS)

# Orchestrator tool name -> flag key. Tools not listed here are never gated.
TOOL_FLAG_MAP: dict[str, str] = {
    "image_generator": "image_generation",
    "web_search": "web_search",
}

_CACHE_TTL_SECONDS = 60
_cache: tuple[float, dict[str, bool]] | None = None


def get_flags() -> dict[str, bool]:
    """Effective flag states: registry defaults overlaid with DB rows.

    Fails open — on any storage error the registry defaults are returned
    and NOT cached, so the next request retries.
    """
    global _cache  # noqa: PLW0603 - module-level TTL cache
    if _cache and time.monotonic() - _cache[0] < _CACHE_TTL_SECONDS:
        return _cache[1]
    flags = dict(DEFAULTS)
    try:
        rows = (
            SupabaseService()
            .client.table("feature_flags")
            .select("key, enabled")
            .execute()
        ).data or []
    except Exception:  # noqa: BLE001
        logger.warning("Feature flag fetch failed; using defaults")
        return flags
    for row in rows:
        if row.get("key") in FLAG_KEYS:
            flags[row["key"]] = bool(row.get("enabled"))
    _cache = (time.monotonic(), flags)
    return flags


def is_enabled(key: str) -> bool:
    """Whether one feature is currently enabled (unknown keys are on)."""
    return get_flags().get(key, True)


def invalidate_cache() -> None:
    """Bust the TTL cache (called after an admin toggle)."""
    global _cache  # noqa: PLW0603 - module-level TTL cache
    _cache = None


def list_flags_with_meta() -> list[dict[str, Any]]:
    """Registry merged with DB overrides, in registry order (admin view).

    Reads the table directly (no cache) so the panel always shows truth;
    ``updated_at`` is None for flags still on their code default.
    """
    rows = (
        SupabaseService()
        .client.table("feature_flags")
        .select("key, enabled, updated_at")
        .execute()
    ).data or []
    by_key = {r["key"]: r for r in rows}
    return [
        {
            "key": f.key,
            "label": f.label,
            "description": f.description,
            "enabled": bool(
                by_key[f.key]["enabled"]
                if f.key in by_key
                else f.default_enabled
            ),
            "updated_at": by_key.get(f.key, {}).get("updated_at"),
        }
        for f in FEATURE_FLAGS
    ]
