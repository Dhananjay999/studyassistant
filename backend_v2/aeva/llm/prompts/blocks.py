"""Shared prompt blocks referenced by capability templates via placeholders.

These are the reusable pieces every capability template pulls in through a
``{PLACEHOLDER}`` so a common instruction is written once and stays consistent:

* ``{SYSTEM_PROMPT}`` — Aeva's identity and behavioural contract.
* ``{TEACHING}`` — the tutoring protocol (answer tools only, never generators).
* ``{USER_PROFILE}`` — the personalization segment (empty unless onboarded).
* ``{ANSWER_META}`` — the hidden follow-up metadata trailer.
* ``{QUIZ_RESULTS}`` — the shared quiz-result context (see ``quiz_common``).

The canonical text still lives in its focused module (``system``,
``personalization``, ``response_meta``); this module only names the pieces as
shared blocks so templates can compose them.
"""

from aeva.llm.prompts.response_meta import ANSWER_META_INSTRUCTION
from aeva.llm.prompts.system import SYSTEM_PROMPT
from aeva.llm.prompts.teaching import TEACHING_PROTOCOL

# Named shared blocks (stable placeholder → text). Kept as module constants so
# a capability template can list them in its ``defaults`` map.
SYSTEM_PROMPT_BLOCK = SYSTEM_PROMPT
TEACHING_BLOCK = TEACHING_PROTOCOL
ANSWER_META_BLOCK = ANSWER_META_INSTRUCTION


def user_profile_segment(personalization: str | None) -> str:
    r"""Resolve the ``{USER_PROFILE}`` placeholder for a system template.

    Takes the personalization block already built from the user's profile
    (``build_personalization_block`` — carried on ``ToolContext``). Returns
    ``""`` when the user has not completed onboarding, else the block with its
    own leading separator. Appending this to ``{SYSTEM_PROMPT}`` reproduces the
    previous ``personalize(SYSTEM_PROMPT, block)`` byte-for-byte (base, or
    ``base + "\n\n" + block``), so personalized and unpersonalized turns are
    identical to the previous hand-assembled prompts.
    """
    block = (personalization or "").strip()
    if not block:
        return ""
    return f"\n\n{block}"
