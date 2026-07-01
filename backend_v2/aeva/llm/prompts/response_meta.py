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

# Appended to every text-answer prompt (web search, media). Kept brace-free
# except the JSON example, which is fine because tools append this AFTER their
# own str.format() call — it never itself passes through format().
ANSWER_META_INSTRUCTION = f"""
After your answer, append this metadata trailer exactly:

{META_SENTINEL}
{{"available_actions":[],"suggested_followups":[]}}

Rules:
- Output the sentinel, then one valid JSON object, and nothing after it.
- available_actions: choose only relevant actions from [{_ACTIONS}]. Use [] for greetings, small talk, refusals, or non-study replies. Prefer a few high-value actions.
- suggested_followups: provide 2–3 natural next questions based on your answer. Each item must contain:
  - title: short (max 6 words).
  - prompt: the complete message to send if selected.
- Use [] for suggested_followups when no meaningful
"""
