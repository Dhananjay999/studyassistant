"""Shuffle a generated quiz's options before it is stored.

Language models rarely put the correct option last, so a quiz kept in the
order the model wrote it can be scored well by position alone. Answers are
stored as option text, never as an index, so reordering changes nothing else.

The order is derived from the question itself, so the same generated quiz
always comes out the same way (with tracing on or off, and on a retry).
"""

import hashlib
import random
import re
from typing import Any

_SHUFFLED_TYPES = frozenset({"single_select", "multi_select"})
_MIN_OPTIONS = 2

# An option that points at other options by position ("All of the above",
# "Both A and B", "Only (i) and (ii)") only makes sense in the written order.
_POSITIONAL_OPTION_RE = re.compile(
    r"\b(above|below|all of (?:these|them|the options)|none of (?:these|them)|"
    r"both [a-d(]|[a-d] (?:and|&|or) [a-d]\b|only [(]?[ivx]+[)]?)",
    re.IGNORECASE,
)
# The question or explanation names an option by its place ("Option B").
_POSITIONAL_TEXT_RE = re.compile(
    r"\boption\s+[(]?(?:[a-d]|[1-4])[)]?(?![a-z0-9])|\b(?:first|second|third|"
    r"fourth|last)\s+option\b",
    re.IGNORECASE,
)


def _depends_on_order(question: dict[str, Any], options: list[str]) -> bool:
    """Whether reordering the options would make the question wrong."""
    if any(_POSITIONAL_OPTION_RE.search(option) for option in options):
        return True
    text = " ".join(
        str(question.get(key) or "") for key in ("prompt", "explanation")
    )
    return bool(_POSITIONAL_TEXT_RE.search(text))


def _rng_for(question: dict[str, Any], options: list[str]) -> random.Random:
    """Build a generator seeded by the question text (not for security)."""
    seed = "\x1f".join([str(question.get("prompt") or ""), *options])
    digest = hashlib.sha256(seed.encode()).digest()
    return random.Random(int.from_bytes(digest[:8], "big"))  # noqa: S311


def shuffle_options(questions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Return the questions with choice options in a shuffled order.

    True/false questions and any question whose wording depends on the
    written order are returned unchanged.
    """
    shuffled: list[dict[str, Any]] = []
    for question in questions:
        options = list(question.get("options") or [])
        if (
            question.get("type", "single_select") not in _SHUFFLED_TYPES
            or len(options) < _MIN_OPTIONS
            or _depends_on_order(question, options)
        ):
            shuffled.append(question)
            continue
        _rng_for(question, options).shuffle(options)
        shuffled.append({**question, "options": options})
    return shuffled
