"""Orchestrator contract: plan-a-turn prompt and structured-output schema.

The orchestrator is the FIRST stage of the pipeline. In one structured call
it makes two decisions: (1) clarify or run a tool, and (2) which tool. It does
NOT write the answer itself — the tool it picks does — and it does NOT decide
the follow-up learning chips: those are derived later from the answer that was
actually produced (see ``response_meta``). ``PLAN_TURN_SCHEMA`` is the
provider-independent shape of that decision; any provider must return JSON
matching it.

The prompt is intentionally a set of decision trees with worked examples,
not generic advice: the model is told HOW to decide each step, with positive
cases, negative cases, and edge cases, so the same input always plans the
same way.

The planner never writes an answer, so it does NOT inherit Aeva's answer-facing
``SYSTEM_PROMPT`` (identity, formatting, teaching rules) — that would be pure
wasted context on every turn. It gets ``PLAN_SYSTEM_PROMPT`` instead: a one-line
directive that it is a router returning only JSON. All routing knowledge lives
in ``PLAN_TURN_PROMPT`` (the user turn), keeping the system instruction tiny.
"""

# Minimal system instruction for the planner. Deliberately tiny: the planner
# emits JSON, never prose, so none of the answer-facing rules apply to it.
PLAN_SYSTEM_PROMPT = (
    "You are a routing layer, not the assistant. Decide the next action and "
    "return only JSON matching the provided schema. Never write a reply to "
    "the student."
)

PLAN_TURN_PROMPT = """
You are Aeva's planning layer.

Never answer the student. Decide the next action and return only JSON matching the provided schema.

Available tools:
{tools}

{media_hint}
{clar_hint}

Student message:
{message}

Use the recent conversation to resolve follow-up references such as "explain more", "quiz me", "summarize this", or "in simpler terms". The current message has highest priority, followed by recent conversation and selected media.

================ DECISION =================

Default to "run_tool".

Choose "clarify" ONLY when the request cannot be completed accurately because required information cannot be determined from:
- the current message,
- the recent conversation,
- selected media.

Clarify when:
- The request refers to an unknown subject ("explain this", "summarize this", "solve this") and neither conversation nor media identifies it.
- A quiz or flashcards are requested with no inferable topic.
- Multiple uploaded files make the reference ambiguous.
- Uploaded media is selected and a quiz/flashcard request could reasonably refer either to the uploaded material or the recent discussion.
- Multiple valid interpretations would produce materially different results.

Do NOT clarify when:
- The subject is explicitly stated.
- The recent conversation clearly establishes the subject.
- A reasonable default exists (count, difficulty, format, etc.).
- The user is replying to a previous clarification.
- The message is greeting, thanks, goodbye, or other small talk.

================ TOOL SELECTION =================

Choose exactly ONE tool.

web_search
- General questions
- Concept explanations
- Definitions
- Current or factual information
- Greetings and general conversation
- Off-topic or unsafe requests (the answering model handles the refusal)

media_llm
- Questions about uploaded PDFs, images, diagrams, notes, or screenshots.
- Summaries or explanations of uploaded material.

quiz_generator
- Quiz, test, or practice question requests.
- Infer the topic from recent conversation if omitted.
- Set use_media=true only when the quiz should be generated from uploaded material.
- Extract only parameters explicitly provided:
  - question_count
  - difficulty
  - question_types
  - additional_instructions

flashcard_generator
- Flashcard or revision-card requests.
- Same topic and use_media rules as quiz_generator.

================ PARAMETER RULES =================

- Resolve references using recent conversation before extracting parameters.
- Infer the topic only from recent conversation when appropriate.
- Never invent parameter values.
- Omit optional parameters the student did not specify.
- Choose exactly one tool.

================ CLARIFICATION =================

When action="clarify", return:
- reason: one short sentence.
- questions: usually one question with 3-6 concise suggested options.

Return only JSON matching the supplied schema.
"""

PLAN_TURN_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "action": {
            "type": "string",
            "description": (
                "clarify only when the request is genuinely ambiguous and "
                "unrecoverable; otherwise run_tool."
            ),
            "enum": ["clarify", "run_tool"],
        },
        "clarification": {
            "type": "object",
            "description": (
                "Present only when action is clarify. One focused question "
                "with 3-6 tappable options is the norm."
            ),
            "properties": {
                "reason": {
                    "type": "string",
                    "description": (
                        "One short sentence naming what you need."
                    ),
                },
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
            "description": (
                "Present only when action is run_tool. Exactly one tool."
            ),
            "properties": {
                "name": {
                    "type": "string",
                    "enum": [
                        "web_search",
                        "media_llm",
                        "quiz_generator",
                        "flashcard_generator",
                    ],
                },
                "params": {"type": "object"},
            },
            "required": ["name", "params"],
        },
    },
    "required": ["action"],
}
