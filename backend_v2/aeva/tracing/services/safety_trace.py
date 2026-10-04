"""Mark the turns where Aeva applied the student-safety rule.

The answer model reports it in its metadata trailer (``"flag"``), next to the
follow-up chips. Only that category is recorded on the turn's trace, never
any of the conversation, so a person can find the turn and review it.
"""

import json

from aeva import tracing

# Key under the trace's ``meta``; query with ``meta->>'safety_flag'``.
FLAG_KEY = "safety_flag"
STUDENT_SAFETY = "student_safety"
_KNOWN_FLAGS = frozenset({STUDENT_SAFETY})


def note_answer_flag(tail: str) -> None:
    """Record the trailer's ``flag`` on the current trace when it is known.

    ``tail`` is the raw text after the metadata sentinel. Anything that is
    not a known flag is ignored, so the model cannot write free text here.
    """
    try:
        data = json.loads(tail[tail.index("{") : tail.rindex("}") + 1])
    except ValueError:
        return
    flag = data.get("flag") if isinstance(data, dict) else None
    if isinstance(flag, str) and flag in _KNOWN_FLAGS:
        tracing.annotate(**{FLAG_KEY: flag})
