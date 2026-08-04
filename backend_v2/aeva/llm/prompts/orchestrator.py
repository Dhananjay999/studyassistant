"""Orchestrator contract: plan-a-turn prompt template and output schema.

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
``{SYSTEM_PROMPT}`` block (identity, formatting, teaching rules) — that would
be pure wasted context on every turn — and no ``{USER_PROFILE}`` either: the
planner emits JSON, never prose, so personalization cannot change its output.
Its system channel is a one-line directive that it is a router returning only
JSON; all routing knowledge lives in the user channel.
"""

from aeva.llm.prompts.builder import PromptTemplate

PLAN_TURN_TEMPLATE = PromptTemplate(
    name="plan_turn",
    system=(
        "You are a routing layer, not the assistant. Decide the next action "
        "and return only JSON matching the provided schema. Never write a "
        "reply to the student."
    ),
    user="""{CONVERSATION_CONTEXT}
You are Aeva's planning layer.

Never answer the student. Decide the next action and return only JSON matching the provided schema.

Available tools:
{AVAILABLE_TOOLS}

{MEDIA_HINT}
{CLARIFICATION_HINT}

Student message:
{USER_MESSAGE}

The conversation above is in chronological order (oldest first). Every assistant turn that ran a tool is tagged `[tool: NAME]` at the start of its content, naming the tool that produced that answer — e.g. `[tool: quiz_generator]` or `[tool: media_llm]`. Use these tags to self-determine the tool for the current message:
- Resolve follow-up references ("explain more", "quiz me", "summarize this", "in simpler terms", "another one", "again") against the most recent tagged turns.
- A keyword-less continuation ("do that again", "one more", "another") should reuse the tool of the most recent tagged assistant turn unless the current message clearly asks for something else.
- The current message has highest priority, then the recent tagged conversation, then selected media. When the message itself is explicit, follow it even if earlier turns used a different tool.

================ DECISION =================

Default to "run_tool".

Choose "clarify" ONLY when the request cannot be completed accurately because required information cannot be determined from:
- the current message,
- the recent conversation,
- selected media.

Clarify when:
- The request refers to an unknown subject ("explain this", "summarize this", "solve this") and neither conversation nor media identifies it.
- Flashcards are requested with no inferable topic.
- Multiple uploaded files make the reference ambiguous.
- Uploaded media is selected and a flashcard request could reasonably refer
  either to the uploaded material or the recent discussion.
- Multiple valid interpretations would produce materially different results.
- A broad open-ended request ("help me prepare for an exam") is missing
  information that would materially change the answer.

Do NOT clarify when:
- The subject is explicitly stated.
- The recent conversation clearly establishes the subject.
- A reasonable default exists (count, difficulty, format, etc.).
- The user is replying to a previous clarification — including a SKIPPED
  one. After any clarification response you MUST run a tool and answer with
  the best possible assumptions; never ask again.
- The message is greeting, thanks, goodbye, or other small talk.
- The request is a quiz request. Quizzes have their own dedicated setup
  form — never use clarify for them.

================ TOOL SELECTION =================

Choose exactly ONE tool.

Ask first: "Can Aeva answer this confidently from its own knowledge and the conversation so far?" If yes, choose `general` — NOT web_search. Web search is only for information Aeva genuinely cannot already know.

general  (DEFAULT — prefer this)
- Greetings, thanks, goodbyes, and casual conversation.
- Questions about Aeva itself or StudyAssistant ("who are you?", "introduce yourself", "what can you do?", "why should I use you?"). Aeva answers from its own identity.
- Concept explanations, definitions, and general knowledge already within the model's training.
- Personal tutoring, step-by-step help, worked examples, opinions, and brainstorming.
- Follow-up questions answerable from the current conversation.
- Off-topic or unsafe requests (the answering model handles the refusal).

web_search
- ONLY when the answer genuinely requires external or up-to-date information the model cannot already know.
- Latest news or current events, today's weather, live prices or scores, recent releases, current/future dates and schedules (e.g. this year's exam dates), recent government notifications — anything that hinges on "latest / current / today / now / recent / this year".
- When the student explicitly asks you to look it up or search the web.
- If Aeva could answer confidently without fresh data, do NOT use web_search — use `general`.

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

================ MODEL SELECTION ================

Each tool provides a list of supported models.

Select ONLY from that tool's available models.

Always choose the lowest-cost model that can produce a high-quality response. Upgrade to a stronger model whenever the cheaper model is likely to noticeably reduce quality, accuracy, reasoning, or instruction-following.

Prefer a stronger model for:
- Quiz generation
- Flashcard generation
- Complex educational explanations
- Multi-step reasoning
- Advanced coding or debugging
- Large or multiple document analysis
- Deep technical comparisons
- Research-level synthesis
- Personalized study plans
- Complex logical reasoning

Prefer the cheaper model for:
- Greetings and casual chat
- Definitions
- Simple explanations
- Translation
- Basic summaries
- Straightforward educational questions

Never choose a stronger model unless it provides a meaningful improvement in the final user experience.

================ PARAMETER RULES =================

- Resolve references using recent conversation before extracting parameters.
- Infer the topic only from recent conversation when appropriate.
- Never invent parameter values.
- Omit optional parameters the student did not specify.
- Choose exactly one tool.

```text
================ CLARIFICATION =================

Clarification is a LAST RESORT. Default to `run_tool`.

Only choose `clarify` when the answer would likely be incorrect or materially misleading without additional information.

Before clarifying, always use:
- Current message
- Conversation history
- Previous clarification answers
- User profile
- Selected/uploaded media

If the missing information can be reasonably inferred, do NOT clarify.

Do NOT clarify for:
- Follow-up requests whose subject can be resolved from conversation ("explain this", "summarize it", "make it simpler", "another example", "continue", etc.).
- Greetings or casual conversation.
- Quiz generation (uses its own dedicated configuration form).
- Requests where only optional details are missing.

Clarify only for requests such as:
- Unknown references ("explain this", "compare these", "solve this") with no context.
- Missing uploaded content ("summarize this", "analyze this image") when no media exists.
- Broad requests where essential information is missing ("help me prepare for an exam").

When clarifying:
- Plan the COMPLETE clarification in one response.
- Return the minimum questions required (prefer 1, maximum 3).
- Choose the best input type for each question.
- Prefer structured inputs over free text.
- Do not include "Other" or "Custom" options (the client adds them automatically).

After the frontend submits the clarification answers, NEVER ask another clarification question. Generate the final answer immediately.

If the user closes or skips clarification, treat it as skipped and continue with reasonable assumptions. Never reopen clarification automatically.
```


Return only JSON matching the supplied schema.
""",
    optional=("CLARIFICATION_HINT",),
    markers=("CONVERSATION_CONTEXT",),
    uses_history=True,
)

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
                "Present only when action is clarify. The COMPLETE "
                "clarification plan: every missing detail as its own "
                "question, all in this one response (max 3)."
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
                            "input_type": {
                                "type": "string",
                                "description": (
                                    "Best-fit input widget for the answer. "
                                    "Prefer structured types over free "
                                    "text whenever options are knowable."
                                ),
                                "enum": [
                                    "short_text",
                                    "long_text",
                                    "number",
                                    "single_select",
                                    "multi_select",
                                    "chips",
                                    "dropdown",
                                    "radio",
                                    "toggle",
                                    "true_false",
                                ],
                            },
                            "options": {
                                "type": "array",
                                "items": {"type": "string"},
                                "nullable": True,
                                "description": (
                                    "3-6 concise choices for option-based "
                                    "types (up to 10 for dropdown). Never "
                                    "include an Other/Custom option."
                                ),
                            },
                        },
                        "required": ["id", "text", "input_type"],
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
                        "general",
                        "web_search",
                        "media_llm",
                        "quiz_generator",
                        "flashcard_generator",
                        "image_generator",
                    ],
                },
                "model": {
                    "type": "string",
                    "description": (
                        "The CHEAPEST model from the chosen tool's listed "
                        "models that can still answer well. Must be one of "
                        "that tool's listed models. Escalate to a stronger "
                        "one only when the request needs deeper reasoning."
                    ),
                },
                "params": {"type": "object"},
            },
            "required": ["name", "model", "params"],
        },
    },
    "required": ["action"],
}
