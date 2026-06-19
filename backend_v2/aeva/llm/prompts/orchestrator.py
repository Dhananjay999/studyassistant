"""Orchestrator contract: plan-a-turn prompt and structured-output schema.

The orchestrator asks the LLM to either request clarification or pick exactly
one tool to run. ``PLAN_TURN_SCHEMA`` is the provider-independent shape of that
decision; any provider must return JSON matching it.
"""

PLAN_TURN_PROMPT = """You are the planning layer for a student learning assistant.

Available tools:
{tools}

{media_hint}
{clar_hint}

Student message:
{message}

Use the recent conversation (provided as history) to resolve references and
vague requests. Follow-ups like "make a quiz", "test me", or "explain more"
almost always refer to the subject discussed in the last few turns — carry that
subject forward instead of treating the message in isolation.

CRITICAL: Default to action "run_tool". Clarification is RARE.

Return action "clarify" ONLY when you genuinely cannot proceed, for example:
- A quiz/answer is requested but there is NO subject in the message AND nothing
  in the recent conversation to infer one.
- Media IS selected AND the user asks for a quiz: it is ambiguous whether they
  want the quiz built from the uploaded material or from the conversation
  topic. Ask which, and supply both as options, e.g. "From your uploaded
  material" and "From our discussion of <topic>".
- Multiple files are uploaded and the user says "explain this" with no hint
  about which file.

NEVER clarify for:
- Greetings or small talk (hi, hello, thanks, bye) → web_search
- Clear questions (e.g. "What is photosynthesis?") → web_search
- A quiz request whose subject is clear from the message OR the recent
  conversation → run quiz_generator (do NOT clarify just to confirm the topic)
- Anything you can answer with sensible defaults

When action is "run_tool":
- Pick exactly ONE tool: web_search, media_llm, or quiz_generator.
- quiz_generator: set "topic" from the message, or infer it from the recent
  conversation when the message doesn't name one. If the user has confirmed
  they want the quiz from their uploaded material, set "use_media" to true.
- media_llm: the user asks about their uploaded files (and it is not a quiz).
- web_search: everything else (greetings, questions, chat).
- If the user already answered a clarification, always run_tool and honor their
  choice (e.g. set use_media=true when they picked the uploaded material).
"""

PLAN_TURN_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "action": {
            "type": "string",
            "enum": ["clarify", "run_tool"],
        },
        "clarification": {
            "type": "object",
            "properties": {
                "reason": {"type": "string"},
                "questions": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "text": {"type": "string"},
                            "options": {
                                "type": "array",
                                "items": {"type": "string"},
                                "nullable": True,
                            },
                        },
                        "required": ["id", "text"],
                    },
                },
            },
            "required": ["reason", "questions"],
        },
        "tool": {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "enum": [
                        "web_search",
                        "media_llm",
                        "quiz_generator",
                    ],
                },
                "params": {"type": "object"},
            },
            "required": ["name", "params"],
        },
    },
    "required": ["action"],
}
