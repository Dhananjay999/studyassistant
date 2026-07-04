"""Exam-pattern presets for Quiz Exam Mode.

Presets are the single source of truth for competitive-exam marking schemes and
timers. Add or tune a pattern here — the ``GET /quiz/exam-patterns`` endpoint
serves them to the frontend, so no frontend change is needed for a new exam.

An exam config persisted on a quiz is the normalized shape
``{pattern, correct, negative, skip, timer_seconds}``; ``default_type`` only
guides generation and is never stored on the quiz row.
"""

from typing import Any

# Ordered preset registry. ``negative`` is the actual (<= 0) value applied per
# wrong answer. ``timer_seconds`` of 0 means no timer. Values are approximate
# real-world schemes and can be tuned without any frontend change.
EXAM_PATTERNS: dict[str, dict[str, Any]] = {
    "custom": {
        "label": "Custom",
        "correct": 1,
        "negative": 0,
        "skip": 0,
        "timer_seconds": 0,
        "default_type": None,
    },
    "jee_main": {
        "label": "JEE Main",
        "correct": 4,
        "negative": -1,
        "skip": 0,
        "timer_seconds": 10800,
        "default_type": "single_select",
    },
    "jee_advanced": {
        "label": "JEE Advanced",
        "correct": 4,
        "negative": -1,
        "skip": 0,
        "timer_seconds": 10800,
        "default_type": "single_select",
    },
    "neet": {
        "label": "NEET",
        "correct": 4,
        "negative": -1,
        "skip": 0,
        "timer_seconds": 10800,
        "default_type": "single_select",
    },
    "ssc_cgl": {
        "label": "SSC CGL",
        "correct": 2,
        "negative": -0.5,
        "skip": 0,
        "timer_seconds": 3600,
        "default_type": "single_select",
    },
    "ssc_chsl": {
        "label": "SSC CHSL",
        "correct": 2,
        "negative": -0.5,
        "skip": 0,
        "timer_seconds": 3600,
        "default_type": "single_select",
    },
    "upsc_prelims": {
        "label": "UPSC Prelims",
        "correct": 2,
        "negative": -0.66,
        "skip": 0,
        "timer_seconds": 7200,
        "default_type": "single_select",
    },
    "gate": {
        "label": "GATE",
        "correct": 1,
        "negative": -0.33,
        "skip": 0,
        "timer_seconds": 10800,
        "default_type": "single_select",
    },
    "cat": {
        "label": "CAT",
        "correct": 3,
        "negative": -1,
        "skip": 0,
        "timer_seconds": 7200,
        "default_type": "single_select",
    },
    "banking": {
        "label": "Banking (IBPS/SBI)",
        "correct": 1,
        "negative": -0.25,
        "skip": 0,
        "timer_seconds": 3600,
        "default_type": "single_select",
    },
    "cuet": {
        "label": "CUET",
        "correct": 5,
        "negative": -1,
        "skip": 0,
        "timer_seconds": 2880,
        "default_type": "single_select",
    },
    "nda": {
        "label": "NDA",
        "correct": 2.5,
        "negative": -0.83,
        "skip": 0,
        "timer_seconds": 9000,
        "default_type": "single_select",
    },
    "clat": {
        "label": "CLAT",
        "correct": 1,
        "negative": -0.25,
        "skip": 0,
        "timer_seconds": 7200,
        "default_type": "single_select",
    },
}

# The scheme fields persisted on a quiz's ``exam_config`` (``default_type`` is a
# generation hint only, so it never lands on the row).
_SCHEME_KEYS = ("correct", "negative", "skip", "timer_seconds")


def list_patterns() -> list[dict[str, Any]]:
    """Return presets as an ordered list with a ``key`` on each entry."""
    return [{"key": key, **preset} for key, preset in EXAM_PATTERNS.items()]


def _as_float(value: Any, fallback: float) -> float:
    """Coerce a client value to float, falling back on bad input."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def normalize_exam_config(raw: Any) -> dict[str, Any]:
    """Validate a client-supplied exam config into the persisted shape.

    Returns ``{}`` for an absent/empty config or an unknown pattern (treated as
    an ordinary practice quiz). For a known preset the preset supplies defaults;
    the client may override any scheme field (this is how "auto-fill then edit"
    and full Custom configs both work). ``timer_seconds`` and ``skip`` are
    clamped to be non-negative and ``negative`` to be non-positive.
    """
    if not isinstance(raw, dict):
        return {}
    pattern = raw.get("pattern")
    if not isinstance(pattern, str) or pattern not in EXAM_PATTERNS:
        return {}

    preset = EXAM_PATTERNS[pattern]
    config: dict[str, Any] = {"pattern": pattern}
    for field in _SCHEME_KEYS:
        config[field] = _as_float(raw.get(field, preset[field]), preset[field])

    # Correct marks are a reward (>= 0); negative and skip are penalties
    # (<= 0) — a skip is never a bonus, so a stray positive can't inflate a
    # score. Most exams leave skip at 0.
    config["correct"] = max(config["correct"], 0.0)
    config["negative"] = min(config["negative"], 0.0)
    config["skip"] = min(config["skip"], 0.0)
    config["timer_seconds"] = max(int(config["timer_seconds"]), 0)
    return config


def marking_from_config(exam_config: Any) -> dict[str, float] | None:
    """Extract the ``{correct, negative, skip}`` marking scheme, if any.

    Returns ``None`` for an ordinary quiz (no exam config), so callers keep the
    accuracy-only scoring path unchanged.
    """
    if not isinstance(exam_config, dict) or not exam_config.get("pattern"):
        return None
    return {
        "correct": _as_float(exam_config.get("correct"), 1.0),
        "negative": _as_float(exam_config.get("negative"), 0.0),
        "skip": _as_float(exam_config.get("skip"), 0.0),
    }
