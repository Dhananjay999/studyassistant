"""Which user detail produced which line of the personalization text.

The orchestrator builds the ``{USER_PROFILE}`` text from three fragments: the
student's name, the learning profile and the active Study Space (see
``aeva.llm.prompts.personalization``). For the execution trace, ``explain``
breaks that text down: per fragment whether it was added and why, which
profile / space field produced each line, and which details exist on the user
but were not used.

The builders are not touched and nothing about them is copied here. The
breakdown is learned by *probing* them: a builder is called with a record
holding a single field, and whatever line comes back is the line that field
produces. The lines found that way are then matched against the real
fragment, so the breakdown cannot disagree with the prompt: text that no
probe explains is listed as such instead of being guessed at.

Pure and cheap (a few dozen calls of string-building functions, no I/O),
and it never raises.
"""

import logging
import sys
from collections.abc import Callable, Iterator, Mapping
from typing import Any

logger = logging.getLogger(__name__)

# A value no real record holds; it marks where a builder puts a field.
_PROBE = "⁣aeva-trace-probe⁣"

_STATUS = "personalization_status"
_COMPLETED = "completed"

# Guards: nested records are followed this deep, and a record with more
# fields than this is not probed field by field.
_MAX_DEPTH = 3
_MAX_FIELDS = 120

Builder = Callable[[Any], str]
Path = tuple[Any, ...]
# (head, tail): the fixed text a builder puts before and after its lines.
Frame = tuple[str, str]
# (source, line): the user detail and the prompt line it produced.
Line = tuple[str, str]


def explain(profile: Any, space: Any) -> list[dict[str, Any]]:
    """Break the personalization text down into the parts it is built from.

    Returns the three fragments in the order the orchestrator concatenates
    them, each as ``{part, label, included, reason, chars, text, lines:
    [{source, line}], ignored: [{source, line?, reason}], rules_chars?}``.
    ``profile`` and ``space`` are the values the real builders were given.
    """
    try:
        from aeva.llm.prompts import personalization as builders
    except Exception:  # noqa: BLE001 — trace detail only.
        logger.debug("personalization builders unavailable", exc_info=True)
        return []
    return [
        _safely(
            "identity",
            "Student identity",
            builders.build_identity_block,
            profile,
            _explain_identity,
        ),
        _safely(
            "learning_profile",
            "Learning profile",
            builders.build_personalization_block,
            profile,
            _explain_profile,
        ),
        _safely(
            "study_space",
            "Study Space",
            builders.build_space_block,
            space,
            _explain_space,
        ),
    ]


# ------------------------------------------------------------------ parts


def _part(
    part: str,
    label: str,
    text: str,
    reason: str,
    lines: list[Line],
    ignored: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    """One entry of :func:`explain`."""
    return {
        "part": part,
        "label": label,
        "included": bool(text),
        "reason": reason,
        "chars": len(text),
        # The fragment exactly as it is concatenated into the prompt.
        "text": text,
        "lines": [{"source": source, "line": line} for source, line in lines],
        "ignored": ignored or [],
    }


def _safely(
    part: str,
    label: str,
    builder: Builder,
    record: Any,
    explainer: Callable[[str, str, Builder, Any, str], dict[str, Any]],
) -> dict[str, Any]:
    """Explain one fragment; a failure costs the detail, never the turn."""
    text = _build(builder, record)
    try:
        return explainer(part, label, builder, record, text)
    except Exception:  # noqa: BLE001 — trace detail only.
        logger.debug("personalization breakdown failed", exc_info=True)
        return _part(
            part,
            label,
            text,
            "This part could not be broken down into user details.",
            [],
        )


def _explain_identity(
    part: str, label: str, builder: Builder, _profile: Any, text: str
) -> dict[str, Any]:
    """Why the student's-name fragment was (not) added."""
    if not text:
        return _part(
            part,
            label,
            text,
            "The account has no name (profile.full_name is empty).",
            [],
        )
    body = _body(text, _frame(builder, {"full_name": _PROBE}))
    return _part(
        part,
        label,
        text,
        "The account has a name, so it is added even if onboarding was "
        "skipped.",
        [("profile.full_name", body or text.strip())],
    )


def _explain_profile(
    part: str, label: str, builder: Builder, profile: Any, text: str
) -> dict[str, Any]:
    """Why the learning-profile fragment was (not) added, line by line."""
    if not profile:
        return _part(part, label, text, "No profile row was found.", [])
    frame = _frame(builder, {_STATUS: _COMPLETED, "preferred_language": _PROBE})
    body = _body(text, frame)
    if not isinstance(profile, Mapping) or frame is None:
        return _part(
            part,
            label,
            text,
            "The profile could not be read field by field.",
            [("profile", body)] if body else [],
        )
    status = profile.get(_STATUS)
    done = {_STATUS: _COMPLETED}
    # What every filled field adds once onboarding is completed.
    would_add = _field_lines(builder, frame, done, profile, "profile")
    filled = _attribute(
        _body(_build(builder, {**profile, **done}), frame),
        would_add,
        "profile",
    )
    if status != _COMPLETED:
        now = _field_lines(
            builder, frame, {_STATUS: status}, profile, "profile"
        )
        lines = _attribute(body, now, "profile")
        used = {source for source, _line in lines}
        explained = _part(
            part,
            label,
            text,
            "Onboarding is not completed (personalization_status="
            f"{status!r}), so only the preferred language applies."
            if text
            else "Onboarding is not completed (personalization_status="
            f"{status!r}) and no preferred language is set.",
            lines,
            [
                {
                    "source": source,
                    "line": line,
                    "reason": "Onboarding is not completed.",
                }
                for source, line in filled
                if source not in used
            ],
        )
    else:
        explained = _part(
            part,
            label,
            text,
            "Onboarding is completed: every filled profile field adds a line."
            if text
            else "Onboarding is completed but no profile field is filled.",
            _attribute(body, would_add, "profile"),
            [
                {"source": source, "reason": "This trait is not switched on."}
                for source, _line in _switched_off(
                    builder, frame, done, profile, would_add
                )
            ],
        )
    if text:
        # The fixed "how to apply the profile" rules ride along with it.
        explained["rules_chars"] = _rules_chars(builder, text, frame)
    return explained


def _explain_space(
    part: str, label: str, builder: Builder, space: Any, text: str
) -> dict[str, Any]:
    """Why the Study Space fragment was (not) added."""
    if not text:
        if not space:
            reason = "The session is not in a Study Space."
        elif isinstance(space, Mapping) and space.get("is_default"):
            reason = (
                "The session is in the default General space (adds nothing)."
            )
        else:
            reason = "The Study Space has no name."
        return _part(part, label, text, reason, [])
    reason = "The session belongs to a Study Space the student created."
    frame = _frame(builder, {"name": _PROBE})
    body = _body(text, frame)
    if not isinstance(space, Mapping) or frame is None:
        lines = [("space", body)] if body else []
        return _part(part, label, text, reason, lines)
    # Every other line only exists next to the name: probe them beside it.
    named = {"name": space.get("name")}
    name_line = _body(_build(builder, named), frame) or ""
    candidates = _field_lines(builder, frame, named, space, "space", name_line)
    if name_line:
        candidates.insert(0, ("space.name", name_line))
    return _part(
        part, label, text, reason, _attribute(body, candidates, "space")
    )


# ---------------------------------------------------------------- probing


def _build(builder: Builder, record: Any) -> str:
    """Call ``builder(record)``; ``''`` when it fails or returns no text."""
    try:
        text = builder(record)
    except Exception:  # noqa: BLE001 — a probe the builder rejects adds nothing.
        return ""
    return text if isinstance(text, str) else ""


def _frame(builder: Builder, probe: dict[str, Any]) -> Frame | None:
    """Learn the fixed text a builder puts around its lines.

    ``probe`` holds the marker value in one field. The head is everything up
    to the start of the line the marker lands on; the tail is everything
    after the marker.
    """
    block = _build(builder, probe)
    at = block.find(_PROBE)
    if at < 0:
        return None
    start = block.rfind("\n", 0, at) + 1
    return block[:start], block[at + len(_PROBE) :]


def _body(text: str, frame: Frame | None) -> str:
    """Return the lines of a fragment: ``text`` without the frame."""
    if frame is None:
        return ""
    head, tail = frame
    if (
        len(text) < len(head) + len(tail)
        or not text.startswith(head)
        or not text.endswith(tail)
    ):
        return ""
    return text[len(head) : len(text) - len(tail)]


def _leaves(
    record: Mapping[Any, Any], prefix: Path = (), depth: int = 0
) -> Iterator[tuple[Path, Any]]:
    """Every field of a record, following nested records to their fields."""
    for key, value in record.items():
        path = (*prefix, key)
        if isinstance(value, Mapping) and value and depth < _MAX_DEPTH:
            yield from _leaves(value, path, depth + 1)
        else:
            yield path, value


def _only(base: Mapping[Any, Any], path: Path, value: Any) -> dict[Any, Any]:
    """Return ``base`` plus the single field at ``path``."""
    record: dict[Any, Any] = dict(base)
    node = record
    for key in path[:-1]:
        child: dict[Any, Any] = {}
        node[key] = child
        node = child
    node[path[-1]] = value
    return record


def _source(root: str, path: Path) -> str:
    """Dotted name of a field, e.g. ``profile.learning_traits.depth``."""
    return ".".join([root, *(str(key) for key in path)])


def _added(
    builder: Builder,
    frame: Frame,
    base: Mapping[Any, Any],
    base_line: str,
    path: Path,
    *,
    value: Any,
) -> str:
    """Return what the field at ``path`` adds to what ``base`` produces."""
    body = _body(_build(builder, _only(base, path, value)), frame)
    if not base_line:
        return body
    if body.startswith(base_line + "\n"):
        return body[len(base_line) + 1 :]
    return ""


def _field_lines(
    builder: Builder,
    frame: Frame,
    base: Mapping[Any, Any],
    record: Mapping[Any, Any],
    root: str,
    base_line: str = "",
) -> list[Line]:
    """For each field of ``record``: the line it produces on its own."""
    lines: list[Line] = []
    for count, (path, value) in enumerate(_leaves(record)):
        if count >= _MAX_FIELDS:
            break
        if len(path) == 1 and path[0] in base:
            continue
        line = _added(builder, frame, base, base_line, path, value=value)
        if line:
            lines.append((_source(root, path), line))
    return lines


def _attribute(body: str, candidates: list[Line], unknown: str) -> list[Line]:
    """Split ``body`` into the candidates' lines, in the order they appear.

    Text no candidate accounts for is kept as one last line attributed to
    ``unknown``, so nothing in the fragment goes unlisted.
    """
    lines: list[Line] = []
    left = list(candidates)
    rest = body
    while rest:
        match: Line | None = None
        for candidate in left:
            line = candidate[1]
            fits = rest == line or rest.startswith(line + "\n")
            if fits and (match is None or len(line) > len(match[1])):
                match = candidate
        if match is None:
            lines.append((unknown, rest))
            break
        lines.append(match)
        left.remove(match)
        rest = rest[len(match[1]) + 1 :]
    return lines


def _switched_off(
    builder: Builder,
    frame: Frame,
    base: Mapping[Any, Any],
    record: Mapping[Any, Any],
    added: list[Line],
) -> list[Line]:
    """Fields that add nothing now but would add a line if set to ``True``.

    These are the on/off learning traits the user has but has not switched
    on. Returned in the order the builder would print them.
    """
    adding = {source for source, _line in added}
    lines: list[Line] = []
    switched: dict[Any, Any] = dict(base)
    for count, (path, value) in enumerate(_leaves(record)):
        if count >= _MAX_FIELDS:
            break
        source = _source("profile", path)
        if value is True or source in adding or path[0] in base:
            continue
        line = _added(builder, frame, base, "", path, value=True)
        if line:
            lines.append((source, line))
            switched = _merged(switched, path)
    if len(lines) < 2:  # noqa: PLR2004 — nothing to put in order.
        return lines
    ordered = _attribute(_body(_build(builder, switched), frame), lines, "")
    known = [item for item in ordered if item in lines]
    return known + [item for item in lines if item not in known]


def _merged(record: dict[Any, Any], path: Path) -> dict[Any, Any]:
    """Return ``record`` with the field at ``path`` also set to ``True``."""
    node = record
    for key in path[:-1]:
        child = node.get(key)
        if not isinstance(child, dict):
            child = {}
            node[key] = child
        node = child
    node[path[-1]] = True
    return record


def _rules_chars(builder: Builder, text: str, frame: Frame) -> int:
    """Size of the fixed rules text that follows the profile lines."""
    rules = getattr(_module_of(builder), "_INSTRUCTION", None)
    if isinstance(rules, str) and rules and text.endswith(rules):
        return len(rules)
    return len(frame[1])


def _module_of(builder: Builder) -> Any:
    """Return the module a builder lives in (``None`` when unknown)."""
    return sys.modules.get(getattr(builder, "__module__", "") or "")
