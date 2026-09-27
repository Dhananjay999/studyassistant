"""Web search tool contract: the complete prompt template + MCP parameters.

``WEB_SEARCH_TEMPLATE`` below IS the prompt the model receives — system
channel, conversation marker, tool rules, the intent-specific answer shape,
user message, and the metadata trailer — with every ``{PLACEHOLDER}``
resolved by :class:`PromptBuilder`.

``search_intent`` (planner-chosen, else guessed from the wording) shapes the
answer: a *compare* turn gets a decision table, a *recommend* turn a
shortlist plus one clear pick, a *news* turn dated facts. Without it every
product question came back as an essay with the comparison buried inside.
"""

import re

from aeva.llm.prompts.blocks import (
    ANSWER_META_BLOCK,
    SYSTEM_PROMPT_BLOCK,
    TEACHING_BLOCK,
)
from aeva.llm.prompts.builder import PromptTemplate

SEARCH_INTENT_LOOKUP = "lookup"
SEARCH_INTENT_COMPARE = "compare"
SEARCH_INTENT_RECOMMEND = "recommend"
SEARCH_INTENT_NEWS = "news"
SEARCH_INTENTS = (
    SEARCH_INTENT_LOOKUP,
    SEARCH_INTENT_COMPARE,
    SEARCH_INTENT_RECOMMEND,
    SEARCH_INTENT_NEWS,
)

# Answer-shape instructions per intent, resolved into {SEARCH_MODE}.
SEARCH_INTENT_GUIDANCE: dict[str, str] = {
    SEARCH_INTENT_LOOKUP: (
        "Answer the question directly first, then give the supporting "
        "details and context."
    ),
    SEARCH_INTENT_COMPARE: """This is a COMPARISON. Structure the answer as:
1. One line naming what is being compared and for whom.
2. A Markdown comparison table: one row per option, 4-7 columns for the attributes that actually decide the choice (price, key specs or features, pros, cons, best for). Keep cells short. Cite each row's source in the option's name cell or in a final Source column.
3. "Which to pick": 2-4 lines with a clear recommendation, the deciding factor, and when the other option is the better choice.""",
    SEARCH_INTENT_RECOMMEND: """This is a RECOMMENDATION. Structure the answer as:
1. A shortlist of 2-4 options in a Markdown table (option, price, why it fits, who it's for), each cited.
2. ONE clear pick for a student — name it explicitly — with the single biggest reason.
3. The runner-up and exactly when to prefer it. Say so if waiting or a cheaper alternative is the smarter move.""",
    SEARCH_INTENT_NEWS: (
        "This is about RECENT or scheduled events: lead with the newest, "
        "dated facts (state dates explicitly), separate what is confirmed "
        "from what is reported or rumoured, and say when something is still "
        "unannounced."
    ),
}


def search_mode_block(intent: str | None) -> str:
    """Resolve ``{SEARCH_MODE}`` for an intent (unknown → lookup)."""
    guidance = SEARCH_INTENT_GUIDANCE.get(
        intent or "", SEARCH_INTENT_GUIDANCE[SEARCH_INTENT_LOOKUP]
    )
    return f"\n{guidance}\n"


_COMPARE_RE = re.compile(
    r"\b(vs\.?|versus|compare|comparison|differences? between|"
    r"better(?: than|:))\b",
    re.IGNORECASE,
)
_RECOMMEND_RE = re.compile(
    r"\b(best|top \d+|top|suggest|recommend|which (?:one )?should i|"
    r"worth (?:buying|it)|should i (?:buy|get)|cheapest|budget)\b",
    re.IGNORECASE,
)
_NEWS_RE = re.compile(
    r"\b(news|latest|announce[ds]?|announcement|update[sd]?|released?|"
    r"launch(?:ed|ing)?|upcoming|schedule|dates?|results?|notification)\b",
    re.IGNORECASE,
)


def guess_search_intent(text: str) -> str:
    """Cheap wording-based intent guess (compare > recommend > news)."""
    if _COMPARE_RE.search(text):
        return SEARCH_INTENT_COMPARE
    if _RECOMMEND_RE.search(text):
        return SEARCH_INTENT_RECOMMEND
    if _NEWS_RE.search(text):
        return SEARCH_INTENT_NEWS
    return SEARCH_INTENT_LOOKUP


WEB_SEARCH_TEMPLATE = PromptTemplate(
    name="web_search",
    system="{SYSTEM_PROMPT}{TEACHING}{USER_PROFILE}",
    user="""{CONVERSATION_CONTEXT}
Answer the student's question as Aeva, grounded in web search.

Today's date: {CURRENT_DATE}. Treat anything older as potentially outdated and prefer the most recent reliable sources.

This is a web-search answer: search the web for the question and base your answer on what you find. Prefer official, primary, or well-known authoritative sources (manufacturers, exam boards, government sites, reputable publications) over forums and content farms.
{SEARCH_MODE}
When writing the answer:
- Cite inline: right after a fact that came from the web, add a Markdown link to the source, e.g. "India's population is ~1.43 billion ([Worldometer](https://www.worldometers.info/...))". Use the real source URL, keep the link text short (site or source name), one link per claim, and only cite claims that actually came from a source — never invent a URL.
- Give prices and dates as found, with the region and currency the source uses; when the student's profile says they are in India, prefer Indian pricing and availability if sources have it.
- If reliable sources disagree or remain uncertain, say so instead of guessing.

Student question:
{USER_MESSAGE}
{PLANNER_NOTE}{ANSWER_META}""",
    defaults={
        "SYSTEM_PROMPT": SYSTEM_PROMPT_BLOCK,
        "TEACHING": TEACHING_BLOCK,
        "ANSWER_META": ANSWER_META_BLOCK,
    },
    optional=("USER_PROFILE", "SEARCH_MODE", "PLANNER_NOTE"),
    markers=("CONVERSATION_CONTEXT",),
    uses_history=True,
)

# MCP tool input schema (what the planner fills in to call this tool).
WEB_SEARCH_PARAMS: dict = {
    "type": "object",
    "properties": {
        "query": {
            "type": "string",
            "description": (
                "Standalone, self-contained search question: include the "
                "product, exam, or entity names and the year when relevant."
            ),
        },
        "search_intent": {
            "type": "string",
            "enum": list(SEARCH_INTENTS),
            "description": (
                "lookup = a fact or explainer; compare = two or more named "
                "options or 'X vs Y'; recommend = 'best / suggest / which "
                "should I buy'; news = events, releases, announcements, "
                "dates."
            ),
        },
    },
    "required": ["query"],
}
