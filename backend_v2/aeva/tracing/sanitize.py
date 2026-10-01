"""Turn arbitrary runtime values into JSON that is safe to store in a trace.

Trace payloads are snapshots of whatever the AI engine passed around: prompts,
plans, tool params, retrieval diagnostics. They are copied at record time (the
plan dict, for one, is mutated in place after the planner returns), truncated
to a per-string budget, and stripped of anything Postgres ``JSONB`` rejects or
that must never be stored (raw file / image bytes).
"""

import dataclasses
import json
import math
import re
from collections.abc import Mapping, Sequence
from collections.abc import Set as AbstractSet
from enum import Enum
from typing import Any

# Nesting / fan-out guards so a pathological object cannot balloon a span.
# Deep enough for a JSON schema nested inside a span payload (the planner's
# response schema reaches depth 9).
_MAX_DEPTH = 24
_MAX_ITEMS = 200
# A longer list made only of floats is a vector, not data worth reading.
_MAX_NUMBERS = 32

# Once a whole field (a span's input or output) serialises past this many
# characters it is replaced by a short preview; see ``cap_field``.
_PREVIEW_CHARS = 20_000


# A signed storage URL carries a bearer token in its query string; the URL
# is worth keeping in a trace, the credential is not.
_TOKEN_RE = re.compile(r"([?&]token=)[^&\s\"'<>)\]]+")


# Credentials that can ride in an exception message or a URL.
_SECRET_RES = (
    re.compile(r"\b(sk-[A-Za-z0-9_-]{4})[A-Za-z0-9_-]{8,}"),
    re.compile(r"(?i)\b(bearer\s+)[A-Za-z0-9._~+/=-]{12,}"),
    re.compile(
        r"(?i)\b((?:api[_-]?key|apikey|access[_-]?token|secret)"
        r"\s*[=:]\s*[\"']?)[A-Za-z0-9._~+/=-]{8,}"
    ),
)
_SECRET_HINTS = ("sk-", "earer", "key", "token", "secret", "KEY", "TOKEN")


def redact_secrets(text: str) -> str:
    """Mask key-shaped substrings (API keys, bearer tokens, signed URLs)."""
    if not any(hint in text for hint in _SECRET_HINTS):
        return text
    text = _TOKEN_RE.sub(r"\1[redacted]", text)
    for pattern in _SECRET_RES:
        text = pattern.sub(r"\1[redacted]", text)
    return text


def clean_text(text: str) -> str:
    """Drop characters Postgres ``JSONB`` rejects (NUL, lone surrogates)."""
    if "\x00" in text:
        text = text.replace("\x00", "")
    try:
        text.encode("utf-8")
    except UnicodeEncodeError:
        text = text.encode("utf-8", "replace").decode("utf-8")
    return text


class Sanitizer:
    """Copy a value into plain JSON types, truncating long strings.

    ``truncated`` flips to ``True`` when anything was cut, so the span can
    say so instead of silently presenting a partial prompt as the whole one.
    """

    def __init__(self, max_chars: int) -> None:
        self.max_chars = max(200, max_chars)
        self.truncated = False

    def text(self, value: str) -> str:
        """Clean one string and cut it to the per-string budget."""
        value = redact_secrets(clean_text(value))
        if len(value) <= self.max_chars:
            return value
        self.truncated = True
        cut = len(value) - self.max_chars
        return f"{value[: self.max_chars]}… [truncated {cut} chars]"

    def value(self, value: Any, depth: int = 0) -> Any:  # noqa: PLR0911
        """Recursively copy ``value`` into JSON-safe types."""
        if value is None or isinstance(value, bool | int):
            return value
        if isinstance(value, float):
            return value if math.isfinite(value) else str(value)
        if isinstance(value, str):
            return self.text(value)
        if isinstance(value, bytes | bytearray | memoryview):
            # Never store file or image bytes: size only.
            return {"_bytes": len(value)}
        if isinstance(value, Enum):
            return self.value(value.value, depth)
        if depth >= _MAX_DEPTH:
            return self._flatten(value)
        if isinstance(value, Mapping):
            return self._mapping(value, depth)
        if isinstance(value, Sequence | AbstractSet):
            return self._sequence(list(value), depth)
        if dataclasses.is_dataclass(value) and not isinstance(value, type):
            fields = {
                f.name: getattr(value, f.name, None)
                for f in dataclasses.fields(value)
            }
            return self._mapping(fields, depth)
        return self._scalar(value)

    def _scalar(self, value: Any) -> str:
        """Text form of anything else (UUID, datetime, an SDK object)."""
        try:
            return self.text(str(value))
        except Exception:  # noqa: BLE001 — an object whose str() raises.
            return f"<{type(value).__name__}>"

    def _flatten(self, value: Any) -> dict[str, Any]:
        """Past the depth guard: say what was there, never its contents.

        (Its repr could carry bytes the guard above has not reached.)
        """
        self.truncated = True
        return {"_too_deep": type(value).__name__}

    def _mapping(self, value: Mapping[Any, Any], depth: int) -> dict[str, Any]:
        """Copy a mapping, capping the number of keys."""
        out: dict[str, Any] = {}
        for index, (key, item) in enumerate(value.items()):
            if index >= _MAX_ITEMS:
                self.truncated = True
                out["_truncated_keys"] = len(value) - _MAX_ITEMS
                break
            out[clean_text(str(key))] = self.value(item, depth + 1)
        return out

    def _sequence(self, value: list[Any], depth: int) -> list[Any]:
        """Copy a sequence, capping the number of items."""
        if len(value) > _MAX_NUMBERS and all(
            isinstance(item, float) for item in value[:_MAX_NUMBERS]
        ):
            # An embedding vector (or a list of them): never stored.
            self.truncated = True
            return [{"_numbers": len(value)}]
        out = [self.value(item, depth + 1) for item in value[:_MAX_ITEMS]]
        if len(value) > _MAX_ITEMS:
            self.truncated = True
            out.append({"_truncated_items": len(value) - _MAX_ITEMS})
        return out


def cap_field(value: Any, max_total_chars: int) -> tuple[Any, bool]:
    """Replace an oversized field with a preview; returns (value, capped).

    Per-string truncation bounds each string, not the sum: a call with twenty
    long history turns can still serialise to megabytes. Applied once, when
    the trace is finalised (after the answer was delivered), so the size check
    costs the user nothing.
    """
    if value is None:
        return value, False
    try:
        dumped = json.dumps(value, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        return {"_unserializable": True}, True
    if len(dumped) <= max_total_chars:
        return value, False
    return {
        "_truncated": True,
        "_chars": len(dumped),
        "preview": dumped[:_PREVIEW_CHARS],
    }, True
