"""Follow-up metadata contract — emitted inside the SAME answer call.

Rather than spend a second LLM call classifying the finished answer, the answer
model appends a hidden metadata trailer after its reply: a sentinel line
followed by a one-line JSON object. The orchestrator streams only the answer to
the client (holding back the sentinel) and parses the trailer for the follow-up
chips. Because the model writes the trailer having just written the answer, the
chips are still grounded in the actual response — at zero extra calls.
"""

from aeva.mcp.base import LEARNING_ACTIONS

# Unlikely-to-occur marker separating the visible answer from its metadata.
META_SENTINEL = "@@AEVA_META@@"

_ACTIONS = ", ".join(LEARNING_ACTIONS)

# The {ANSWER_META} shared block on every text-answer template (web search,
# media). The JSON example's braces are safe: the builder only treats
# {UPPER_SNAKE} tokens as placeholders, so the literal example passes through.
ANSWER_META_INSTRUCTION = f"""
After your answer, append this metadata trailer exactly:

{META_SENTINEL}
{{"available_actions":[],"suggested_followups":[]}}

Rules:
- Output the sentinel, then one valid JSON object, and nothing after it.
- available_actions: choose only relevant actions from [{_ACTIONS}]. Use [] for greetings, small talk, refusals, or non-study replies. Prefer a few high-value actions.
- Offer an action only when your reply contains study content it can be built from: never offer a quiz or flashcards on a reply that only asks a question, chats, or says what you cannot do.
- suggested_followups: provide 2–3 natural next questions based on your answer. Each item must contain:
  - title: short (max 6 words).
  - prompt: the complete message to send if selected.
- Use [] for suggested_followups only when no meaningful next step exists (greetings, goodbyes, refusals). For any teaching answer, always suggest follow-ups.
- If the student-safety rule applied to this reply, use [] for both lists and add "flag":"student_safety" to the JSON object. Never add "flag" otherwise.
"""
