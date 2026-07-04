"""The single prompt builder: assemble every LLM prompt from one template.

Every capability declares one :class:`PromptTemplate` that shows its *complete*
prompt with ``{PLACEHOLDER}`` tokens — the system instruction, the shared
blocks, the conversation marker, and the user message — so a developer can open
one file and see exactly what the model receives. Nothing is concatenated
anywhere else; :func:`PromptBuilder.build` is the only place placeholders are
resolved.

Channels
--------
The model does not receive one flat string: the system instruction, the
conversation history, and the user message travel as *separate* provider
channels (a Gemini/Groq call treats each specially). A template therefore
routes its placeholders:

* ``system`` — the system-role instruction (identity, personalization).
* ``user`` — the user message (rules, retrieved context, the question, the
  metadata trailer).
* history — a structural marker only. ``{CONVERSATION_CONTEXT}`` resolves to
  the empty string; the recent turns are attached as the provider's structured
  history array by the caller (``uses_history`` documents this). Keeping it a
  marker, not inline text, is what makes the render byte-for-byte identical to
  the previous hand-assembled prompts.

Substitution is two-phase so it is both recursive and safe:

1. Static blocks (defaults / optional / markers) are expanded first, repeatedly,
   so a block may reference another block.
2. Dynamic values (the caller's runtime data — the user message, retrieved
   excerpts) are injected in a single left-to-right pass, so text a *user*
   typed is never re-scanned for placeholders.

Only ``{UPPER_SNAKE}`` tokens are placeholders, so literal JSON braces in the
metadata trailer (``{"available_actions":[]}``) pass through untouched — which
is why the trailer no longer needs to be appended after the fact.
"""

import logging
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from enum import Enum

from aeva.common.logging_config import prompt_debug_enabled

logger = logging.getLogger(__name__)

# A placeholder is an all-caps, underscore-delimited token: ``{USER_MESSAGE}``.
# JSON braces (``{"key":...}``) and the ``@@AEVA_META@@`` sentinel never match,
# so trailers and code samples inside a prompt are left verbatim.
_PLACEHOLDER_RE = re.compile(r"\{([A-Z_][A-Z0-9_]*)\}")

# Guard against a static block that (mis)references itself in a cycle.
_MAX_STATIC_PASSES = 10


class PromptError(RuntimeError):
    """A template could not be rendered (missing or unresolved placeholder)."""


class Channel(str, Enum):
    """Which provider channel a rendered segment is routed to."""

    SYSTEM = "system"
    USER = "user"
    HISTORY = "history"


@dataclass(frozen=True)
class PromptTemplate:
    """One capability's complete, self-contained prompt.

    ``system`` and ``user`` are the two text channels; each is a template
    string whose ``{PLACEHOLDER}`` tokens are resolved from three sources, in
    precedence order: the caller's runtime values, this template's ``defaults``
    (shared static blocks), then ``""`` for a name in ``optional`` or
    ``markers``. Any token that resolves from none of these is a required
    placeholder the caller must supply — an unresolved one fails the build.
    """

    name: str
    system: str
    user: str
    # Static shared blocks (e.g. the system prompt, the answer-meta trailer),
    # resolved before any runtime value so a block may embed another block.
    defaults: Mapping[str, str] = field(default_factory=dict)
    # Placeholders that resolve to "" when the caller omits them (a cleanly
    # removed optional section — its separator lives inside the supplied value).
    optional: tuple[str, ...] = ()
    # Structural placeholders that always resolve to "": the conversation is
    # attached as the provider's structured history array, not inline text.
    markers: tuple[str, ...] = ()
    # Documentation flags for the caller (the builder never touches these
    # channels); they also drive the debug log's "attached" notes.
    uses_history: bool = False
    uses_attachments: bool = False

    def static_names(self, dynamic: set[str]) -> set[str]:
        """Names resolvable without a runtime value (blocks, optionals)."""
        names = set(self.defaults) | set(self.optional) | set(self.markers)
        return names - dynamic


@dataclass(frozen=True)
class RenderedPrompt:
    """The resolved text for each channel the builder owns."""

    system_prompt: str
    user_message: str


class PromptBuilder:
    """Resolve a :class:`PromptTemplate` into channel-ready text.

    The one place placeholder substitution happens. It injects the supplied
    values, expands shared blocks, drops omitted optional sections, verifies no
    ``{PLACEHOLDER}`` is left unresolved, and — when ``PROMPT_DEBUG`` is on —
    logs the fully rendered prompt before it reaches the LLM client.
    """

    @classmethod
    def build(
        cls,
        template: PromptTemplate,
        **values: str,
    ) -> RenderedPrompt:
        """Render ``template`` with ``values`` into a :class:`RenderedPrompt`.

        Raises :class:`PromptError` if a required placeholder is missing, a
        static block cannot be fully expanded, or a supplied value matches no
        placeholder in the template (almost always a typo).
        """
        dynamic = set(values)
        used: set[str] = set()
        system = cls._render(template, template.system, values, dynamic, used)
        user = cls._render(template, template.user, values, dynamic, used)
        unused = sorted(dynamic - used)
        if unused:
            raise PromptError(
                f"Value(s) {unused} were supplied but template "
                f"'{template.name}' has no matching placeholder — "
                f"check for a typo in the build() call or the template.",
            )
        rendered = RenderedPrompt(system_prompt=system, user_message=user)
        cls._debug(template, rendered)
        return rendered

    @classmethod
    def _render(
        cls,
        template: PromptTemplate,
        text: str,
        values: Mapping[str, str],
        dynamic: set[str],
        used: set[str],
    ) -> str:
        """Two-phase substitution for one channel, validating in between."""
        static = template.static_names(dynamic)

        # Phase 1: expand trusted static blocks, repeatedly, so a block may
        # embed another block. Only names known to be static are touched.
        def resolve_static(match: re.Match[str]) -> str:
            name = match.group(1)
            if name in static:
                return cls._static_value(template, name)
            return match.group(0)

        for _ in range(_MAX_STATIC_PASSES):
            text, count = _PLACEHOLDER_RE.subn(resolve_static, text)
            if not count or not any(
                m.group(1) in static for m in _PLACEHOLDER_RE.finditer(text)
            ):
                break

        # Phase 2: validate BEFORE injecting runtime values, so validation
        # never scans text a user typed. Every placeholder still standing must
        # have a supplied value; anything else is a missing required value (or
        # a static block that could not be fully expanded — a cycle).
        remaining = {m.group(1) for m in _PLACEHOLDER_RE.finditer(text)}
        missing = sorted(remaining - dynamic)
        if missing:
            raise PromptError(
                f"Unresolved placeholder(s) {missing} in template "
                f"'{template.name}'. Supply them as build() arguments or "
                f"declare them in the template's defaults/optional/markers.",
            )
        used |= remaining

        # Phase 3: inject runtime values in a single left-to-right pass;
        # injected text is never re-scanned, so user-typed braces are safe.
        def resolve_dynamic(match: re.Match[str]) -> str:
            name = match.group(1)
            if name in dynamic:
                return values[name]
            return match.group(0)

        return _PLACEHOLDER_RE.sub(resolve_dynamic, text)

    @staticmethod
    def _static_value(template: PromptTemplate, name: str) -> str:
        """Resolve a static placeholder (default block, else empty section)."""
        if name in template.defaults:
            return template.defaults[name]
        # optional and marker placeholders collapse to nothing.
        return ""

    @classmethod
    def _debug(
        cls,
        template: PromptTemplate,
        rendered: RenderedPrompt,
    ) -> None:
        """Log the fully rendered prompt when ``PROMPT_DEBUG`` is enabled."""
        if not prompt_debug_enabled():
            return
        lines = [
            f"PROMPT_DEBUG '{template.name}' — fully rendered prompt",
            f"── system channel ──\n{rendered.system_prompt}",
        ]
        if template.uses_history:
            lines.append(
                "── history channel ──\n(recent turns attached as the "
                "provider's structured history array)",
            )
        if template.uses_attachments:
            lines.append(
                "── attachments ──\n(media attached as provider binary parts)",
            )
        lines.append(f"── user channel ──\n{rendered.user_message}")
        logger.info("\n".join(lines))
