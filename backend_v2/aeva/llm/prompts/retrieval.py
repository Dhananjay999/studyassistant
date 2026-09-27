"""Retrieval-side LLM contracts: query rewriting and listwise reranking.

Both are small structured calls on the fast model that run BEFORE the answer
model (see ``aeva.media.retrieval``). Neither writes prose for the student,
so neither inherits Aeva's answer-facing ``{SYSTEM_PROMPT}`` block.
"""

from aeva.llm.prompts.builder import PromptTemplate

QUERY_REWRITE_TEMPLATE = PromptTemplate(
    name="rag_query_rewrite",
    system=(
        "You turn a student's latest chat message into a standalone search "
        "query over their uploaded study materials. Return only JSON "
        "matching the provided schema. Never answer the question."
    ),
    user="""Recent conversation (oldest first):
{RECENT_TURNS}

Uploaded files: {FILE_NAMES}

Latest message:
{USER_MESSAGE}

Rules:
- standalone_query: the latest message rewritten so it makes complete sense with no conversation — resolve "it", "this", "that chapter", "the same" from the turns above. Keep the student's language and their exact technical terms. Do not answer it.
- keywords: 2-6 exact terms worth matching literally in the files (names, acronyms, formulas, codes, section titles). Empty list if none.
- paraphrases: {PARAPHRASE_RULE}
- is_followup: true when the latest message depends on the conversation to be understood.
""",
)

# Resolved into {PARAPHRASE_RULE} depending on whether multi-query is on.
PARAPHRASE_RULE_ON = (
    "exactly two alternative phrasings of standalone_query that use "
    "different vocabulary: one synonym-heavy natural sentence and one "
    "keyword-dense form."
)
PARAPHRASE_RULE_OFF = "an empty list."

QUERY_REWRITE_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "standalone_query": {"type": "string"},
        "keywords": {"type": "array", "items": {"type": "string"}},
        "paraphrases": {"type": "array", "items": {"type": "string"}},
        "is_followup": {"type": "boolean"},
    },
    "required": ["standalone_query", "keywords", "paraphrases", "is_followup"],
}

RERANK_TEMPLATE = PromptTemplate(
    name="rag_rerank",
    system=(
        "You grade how useful each excerpt is for answering a student's "
        "question. Return only JSON matching the provided schema."
    ),
    user="""Question:
{QUERY}

Excerpts:
{EXCERPTS}

Score every excerpt from 0 (irrelevant) to 10 (directly contains the facts needed). Judge by whether the excerpt holds the specific information the question asks for, not by general topic overlap. Return one score per excerpt index, and nothing else.
""",
)

RERANK_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "scores": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                    "score": {"type": "number"},
                },
                "required": ["index", "score"],
            },
        },
    },
    "required": ["scores"],
}
