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

================  FOLLOW-UP METADATA (required)  ================

After your COMPLETE answer to the student, append a metadata trailer so the app
can offer next steps. Output it exactly like this, on its own lines:

{META_SENTINEL}
{{"available_actions": ["QUIZ", "SUMMARY"],
  "suggested_followups": [{{"title": "...", "prompt": "..."}}]}}

Rules for the trailer:
- Put NOTHING after the JSON. The student never sees this trailer.
- "available_actions": the subset of [{_ACTIONS}] that a student would
  realistically tap to learn more about THIS answer. Use [] for greetings,
  small talk, refusals, or non-study replies. Prefer fewer, high-value chips.
- "suggested_followups": 2-3 natural next questions grounded in your answer.
  Each has a short "title" (<= 6 words, shown on a chip) and a richer "prompt"
  (the full, self-contained message actually sent when the chip is tapped, e.g.
  title "How do I start?" -> prompt "I want to start learning X from scratch.
  Create a beginner-friendly roadmap with topics and resources."). Use [] when
  the answer is not study-related.
- The JSON must be valid and compact (parseable with a standard JSON parser).
"""
