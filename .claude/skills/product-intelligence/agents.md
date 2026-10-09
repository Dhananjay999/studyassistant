# Product intelligence — agent tasks

Read `briefing.md` (same folder) first. Then do only your own section.

## Agent 0 — Data & Product Context

Produce the shared context brief the other agents rely on, so none of them has
to guess what the product does or what data exists. You make no
recommendations. Verify every statement by reading the code or running a query.

Write markdown of at most about 1800 words, dense and factual, covering:

1. **Product map:** the main user flows (landing, Google sign-in, onboarding,
   chat with Aeva, uploads and RAG, quiz generation and taking including exam
   mode, flashcards, notes, bookmarks, study spaces, revision, sharing) with the
   frontend route or page and the backend module for each.
2. **Aeva pipeline:** how a chat turn runs end to end (intent detection and
   routing, agents, tools, retrieval, LLM calls, prompts) with file paths, and
   where quiz and flashcard generation fit.
3. **Database:** the tables that matter per flow with their key columns; how to
   join a user to sessions, messages, quizzes, quiz attempts, flashcard sets and
   study events; how to identify debug and internal users; how an upload in
   `media` links to its `media_pages` and `media_chunks` rows and to the
   session and messages that used it. Include current row counts and the
   earliest and latest timestamps for each key table.
4. **Trace system:** the columns of `ai_traces`, `ai_trace_spans` and
   `ai_prompt_versions`, the span kinds and names that exist, how a trace links
   to a message, session and user, and three ready-to-run SQL queries (failures
   by span, latency by span kind, prompt version usage).
5. **Analytics:** which events actually have data in PostHog (confirm with
   `read-data-schema` and give counts for the window), which events in
   `EVENTS.md` have never fired, the funnel steps marked as conversion steps,
   and the key properties (`device_type`, `page_name`, `is_app_mode`,
   `error_kind`, `session_id`).
6. **Sentry:** which projects have events, total issue and event volume in the
   window, and the environments and releases present.
7. **Population:** total users, signups in the window, how many are debug or
   internal, and the split of real and internal activity. State clearly how much
   real-user data the analysts have to work with.
8. **Known limits:** sources that are empty, too new, sampled or unreachable,
   and anything an analyst is likely to assume wrongly.

## Agent 1 — FE/BE Health

Find technical problems that are actually hurting users. Start with Sentry, then
use Supabase logs, PostHog error events and error tracking, and web vitals.

Analyze recurring errors, critical bugs, API failures and their endpoints,
performance and reliability (slow endpoints, timeouts, web vitals on mobile),
authentication and token-refresh problems, and issues that hit many users or an
important flow (sign-in, chat, upload, quiz, flashcards).

For each issue give the event count, distinct users affected, first and last
seen, release and environment, and the device and browser split. Read the code
at the stack frame and say whether the root cause is verified or a hypothesis.
Separate production from development and preview noise. Recommend a fix only
when the evidence supports it.

## Agent 2 — Landing → Login/Signup Funnel

Study visitors who reach the landing page but do not complete login or signup.

Build the real funnel from PostHog events that exist (landing view, CTA click,
auth prompt shown, sign-in started, sign-in completed), with counts at each step
and the biggest drop-off. Break it down by device type, browser, OS, in-app
browser or webview, referrer and campaign.

Look for login and signup errors; OAuth, API and redirect failures (PostHog
error events, Sentry, Supabase auth logs); mobile and browser-specific problems;
and UX friction, using session replays of abandoned sessions and the landing and
auth code. List possible reasons for abandonment and mark each as observed or
hypothesised.

## Agent 3 — New User Activation

Study users who signed up successfully but took no meaningful action afterwards.

Define activation concretely from the data (for example first message to Aeva,
first upload, first quiz, first flashcard set). For each signup cohort, measure
how many reached each within their first session and their first 7 days, joining
Supabase rows with PostHog events.

Investigate why inactive users did not ask Aeva anything or use chat, quiz,
flashcards or uploads: onboarding steps and where they stop, empty states,
feature discoverability, first-session errors, time to first action, device.
Compare active and inactive new users on every attribute available. Read the
onboarding and empty-state code to ground UX claims. Suggest activation and
first-session improvements only where the comparison supports them.

## Agent 4 — Aeva Quality & Technical Performance

Judge whether Aeva performs well and pinpoint exactly where it does not.

Read real conversations from Supabase (user question, Aeva response) and assess
correctness, relevance, helpfulness and grounding or citations. Sample
systematically, say how (for example every traced turn plus a stratified sample
of untraced ones), and report how many turns you read.

Check intent detection and routing against what the user asked; quiz and
flashcard generation quality (wrong answers, duplicates, off-topic or malformed
items); tool usage; prompt performance by prompt version; errors and failures;
and user corrections or retries that follow a bad answer.

Use `ai_traces` and `ai_trace_spans` to attribute each problem to a specific
prompt, agent, tool, pipeline step, retrieved context or API call. Give trace
ids, span names, latency, token and error data, and the file path of the prompt
or code involved. Give latency and failure rates per span kind. Say what share
of turns were good, so the verdict is balanced. Agent 7 validates the
uploaded-material index and retrieval in depth: note grounding problems you
see, but do not analyse the index yourself.

## Agent 5 — User Engagement & Satisfaction

Study what users do after interacting with Aeva, as behavioural evidence of
success or failure.

Measure conversation continuation and follow-up questions; abandonment right
after a response; regeneration and retry behaviour; user corrections ("no",
"that's wrong", rephrasing the same question); quiz completion (started against
finished, score, retakes); flashcard engagement (sets created against studied,
cards per session, returns); session continuation and return visits (day 1 and
day 7 where the data allows); switching between features; and repeated failed
attempts.

Classify interactions as likely successful or likely unsuccessful using at least
two agreeing signals each, and state the signals. Never treat a single signal as
satisfaction: a session that ends after one answer may be a satisfied user. Give
counts for each class and the patterns that separate them.

## Agent 6 — Product Opportunity

Look for what to build or change, not for bugs. Answer: "What should we build or
change that users are clearly asking for through their behaviour?"

Identify things users repeatedly ask Aeva for (cluster real user messages by
intent and count distinct users per cluster); requests current features do not
support well; workarounds (for example pasting content instead of uploading, or
asking chat to do what a feature should do); missing capabilities; features
users seem to expect but cannot find (dead clicks, searches, navigation loops,
feature pages opened then left); high-demand use cases (subjects, exams, content
types, languages); features that exist but are unused and add friction
(candidates for Remove); and chances to simplify existing workflows.

An opportunity needs demand evidence from more than one user. With less,
classify it as Monitor and say what data would confirm it.

## Agent 7 — Uploaded Material & Retrieval Validation

Validate that the study materials users upload are parsed, chunked and embedded
correctly, and that Aeva actually answers from them. Agent 4 judges answer
quality in general; you cover only turns that used uploaded material, and you
go all the way down to the index. Work in three passes: the index, the
retrieval, and the answers.

Read the code first so your checks match what the pipeline does:
`backend_v2/aeva/media/media_processor.py` (parse, extract, chunk, embed,
index; `processing_status` on `media`), `chunking.py`, `text_quality.py`
(glyph-junk and blank-page detection that triggers an OCR re-parse),
`retrieval.py` (hybrid search, query rewrite, the `min_similarity`,
`floor_similarity` and `min_results` thresholds), the media tool in
`backend_v2/aeva/mcp/tools/media_llm.py` (whole-file attachment fallback,
`sources`), `grounding.py`, `citations.py`, and migrations 007, 023 and 032.
Tables: `media` (`processing_status`, `processing_error`, `parse_tier`,
`page_count`, `chunk_count`, `processed_at`), `media_pages` (one row per page:
`text`, `markdown`) and `media_chunks` (`chunk_index`, `content`, `context`,
`page_number`, `section`, `token_count`, `embedding vector(768)`,
`embedding_version`, `search_vector`). RPCs: `search_media_chunks` (hybrid)
and `match_media_chunks` (vector only). Read the RAG settings in
`backend_v2/aeva/app.py` (`RAG_*`) for the configured chunk size, top-k and
candidate counts.

**Pass 1 — Index integrity.** For every upload in the window (and the whole
`media` table where the window holds few uploads), report:

- the `processing_status` distribution, failed rows grouped by
  `processing_error`, and rows stuck in an intermediate status (`parsing`,
  `extracting`, `chunking`, `embedding`, `indexing`) for more than an hour;
- per document, `media.chunk_count` against `count(*)` of its `media_chunks`
  rows and `page_count` against its `media_pages` rows; `ready` documents with
  zero chunks;
- gaps in `chunk_index` (missing or duplicate indices within a document), and
  pages that have text in `media_pages` but no chunk pointing at them;
- embedding health: `vector_dims(embedding)` other than 768, zero or NaN
  vectors (`embedding <=> embedding` not 0, or a zero norm), exact duplicate
  `content` within a document, and the `embedding_version` mix (version 1
  rows have no `context` header and were embedded from the old text);
- text quality: chunks whose `content` is mostly glyph junk (the code-point
  ranges in `text_quality.py`) or shorter than one sentence, the `token_count`
  distribution against `RAG_CHUNK_TOKENS`, and which documents needed the OCR
  `parse_tier`;
- upload and parse failures from PostHog upload events and Sentry (LlamaParse
  and embedding API errors), and the time from `created_at` to `processed_at`.

**Pass 2 — Retrieval correctness.** You cannot call the embedding model, so
test the index with the vectors it already holds:

- self-retrieval: for a sample of at least 20 chunks across different users
  and documents, call `search_media_chunks` with the chunk's own `embedding`
  as `query_embedding`, its `content` as `p_query`, scoped to that user. The
  chunk must come back at rank 1 with similarity close to 1, and its
  neighbours should be from the same document and section. Report every miss
  and whether `exact_scan` was used;
- keyword retrieval: pick distinctive terms from `media_pages.text` (a
  heading, a formula name, a rare word) and check that
  `search_vector @@ websearch_to_tsquery('english', term)` finds the chunk on
  that page;
- cross-user isolation: confirm the RPC never returns another user's chunks;
- live retrieval from `ai_trace_spans` where `kind = 'retrieval'`: list the
  distinct `name` values first (expect `retrieve`, `rewrite`, `search`,
  `rerank`, `grounding`), then read `input`, `output` and `meta` for
  `candidates`, `after_threshold`, `after_quota`, `top_similarity`,
  `exact_scan`, `mode`, `rewritten`, `rerank_timeout` and the `embed_ms`,
  `search_ms`, `rerank_ms` and `rewrite_ms` timings. Report turns that ended
  with zero results after the threshold for a user who had `ready` documents,
  the `top_similarity` distribution, how often the rewrite changed the query,
  rerank timeouts, span failures, and p50 and p95 latency per step;
- how often the media tool fell back to whole-file attachment because a
  document was not `ready` (`RAG_ATTACHMENT_FALLBACK`), and the status of
  those documents now.

**Pass 3 — Answer grounding.** Take a systematic sample of traced turns in
which the media tool ran (say how you sampled and how many you read; aim for
at least 30, or every one if fewer exist). For each, read the user question,
the chunks the span retrieved, the `sources` cited and Aeva's reply, and judge
three things, giving counts for each outcome:

- (a) did the retrieved chunks contain what the user asked for: relevant,
  wrong document, wrong section, or not in the materials at all;
- (b) does the reply use those chunks, and does every cited page actually
  contain the claim (verify against `media_pages.text`);
- (c) did the reply say the material does not cover something that the index
  actually holds, or answer from general knowledge instead of the upload.

Record the trace id, span name and the `file:line` of the prompt or code
responsible for each failure, and classify the cause as parsing (junk or
missing text), chunking (answer split across a boundary or wrong section),
embedding (right chunk present but low similarity), threshold (right chunk
retrieved then dropped), rewrite (query changed meaning), rerank, or
generation (right chunk retrieved, reply ignored it).

State what share of documents are healthy and what share of turns were
correctly grounded, so the verdict is balanced.

## Agent 8 — Product Intelligence / Decision Maker

Act as a product manager and strategist, not as an editor who joins reports
together. The owner will read your report to decide what to implement and must
be able to answer: "Based on everything happening in my product, what should I
fix, improve, build, remove, or investigate next, and why?" The owner will not
see the analyst reports, so yours must stand on its own.

Read the context brief and all analyst reports in the work folder named in your
prompt. If a report is missing, say so in your report.

How to decide:

- **Merge duplicates.** When several agents found the same problem, make one
  recommendation and list every contributing finding id.
- **Connect related problems** and look for a shared root cause behind separate
  symptoms.
- **Validate before you endorse.** For every recommendation you intend to rank
  P0 or P1, re-run its key query or re-read its code reference yourself. If it
  does not reproduce, downgrade or drop it and say so.
- **Separate facts from hypotheses.** A recommendation that rests on a
  hypothesis gets confidence Low or Medium and, where sensible, the type
  Monitor with the data needed to confirm it.
- **Respect sample size.** Do not present a pattern from a few users as a trend.
- **Prioritize** using impact, users affected, frequency, severity, confidence
  and implementation effort as a framework for judgement, not a formula. Give
  each recommendation a priority from P0 to P3.
- It is acceptable to conclude that an area is healthy, or that there is not
  enough data yet.

Types: Fix (broken), Improve (works but needs to be better), Add (new
functionality is justified), Remove (creates friction or has little value),
Monitor (interesting, not enough evidence yet).

Severity: 🔴 Critical, 🟠 High, 🟡 Medium, 🟢 Low.
Confidence: High (strong evidence), Medium (reasonable evidence with some
uncertainty), Low (mostly a hypothesis needing validation).

Write the report in plain language and full sentences, defining any internal
label you use, in this format:

```
# Product Intelligence Report — StudyAssistant (Aeva)
(The analysis window, the amount of real-user data it rests on, and any analyst
or data source that was missing.)

## 1. Executive Summary
Overall product health, the biggest problems and the biggest opportunities.

## 2. Critical Problems
For each: Observed data, Analysis, Root cause or Hypothesis (labelled),
Recommendation.

## 3. Product Opportunities
Features or improvements supported by user behaviour, with the demand evidence.

## 4. Prioritized Recommendations
| Priority | Problem | Recommendation | Type | Severity | Confidence | Evidence | Expected Impact |
(Give each row an id, R1, R2, ..., in the Recommendation cell. The Problem
column is required on every row: say in one plain sentence what is actually
going wrong for the user or the business today, before any fix is mentioned.
For an Add row, state the unmet need; for a Monitor row, state what is
suspected. Keep Evidence to the key number plus its source.)

## 5. What Should We Do First?
The top 5–10 actions to consider first, in order, each with the reason and the
expected impact.

## Appendix A — Evidence trail
For every recommendation id: Recommendation -> analyst finding ids -> user
behaviour observed -> source (analytics / Sentry / DB / trace, with the exact
query, issue id, trace id or file:line) -> root cause or hypothesis.

## Appendix B — Merged, downgraded and dropped findings

## Appendix C — Data gaps
What could not be measured and what tracking would close each gap.
```

Write the report to the file named in your prompt, and also return the full
report as your final message.
