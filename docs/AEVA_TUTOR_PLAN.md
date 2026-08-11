# Aeva: Chatbot → Adaptive Tutor — Architecture Review & Implementation Plan

Goal: transform Aeva from "AI chatbot for students" into an adaptive tutor that
remembers how the student learns, detects misconceptions, teaches accurately,
adapts to exam level and language, and drives active practice. Evidence base:
the real student transcripts (Avni, Class 7, Aug 2026) + the 42-point product
spec. Companion doc: `IMPROVEMENT_PLAN.md` (transcript bug fixes already made).

---

## 1. Current architecture (what exists today)

One turn flows: **frontend `send()` → `AssistantOrchestrator` → planner →
tool → streamed answer + metadata trailer → persisted message**.

| Spec §40 asks "where is…" | Answer |
|---|---|
| 1. System prompts | `backend_v2/aeva/llm/prompts/system.py` (identity/behavior, shipped on every answer call), composed via `{SYSTEM_PROMPT}` block in `blocks.py`. Per-capability templates: `general.py`, `web_search.py`, `media.py`, `quiz_generation.py`, `flashcard.py` |
| 2. User preferences | Supabase `profiles` table (learning-profile columns) via `learning_profile/` module; rendered by `prompts/personalization.py` → `{USER_PROFILE}` |
| 3. Conversation context | `assistant_orchestrator._get_history()` — last 20 messages (`CHAT_HISTORY_LIMIT`), session-scoped; assistant turns tagged `[tool: NAME]` for the planner |
| 4. Model selection | Planner (`prompts/orchestrator.py` MODEL SELECTION rules) picks from per-tool env candidate lists (`orchestration/model_candidates.py`); small-talk-only fast path → `LLM_FAST_MODEL` |
| 5. Response structure | `AssistantResult` + SSE chunks; per-tool `response_type` (`mcp/base.py`: NORMAL, CLARIFICATION, QUIZ_CREATED, FLASHCARD_CREATED, WEB_SEARCH, FILE_ANALYSIS, ERROR) |
| 6. `available_actions` | Zero-extra-call metadata trailer: answer model appends `@@AEVA_META@@ {json}` (`prompts/response_meta.py`), parsed by orchestrator `_attach_actions`; vocabulary = `LEARNING_ACTIONS` in `mcp/base.py` (QUIZ, FLASHCARDS, SIMPLIFY, DETAIL, SUMMARY, STUDY_PLAN, ANALYZE) |
| 7. Quiz generation | `mcp/tools/quiz_generator.py` + `prompts/quiz_generation.py`; setup form → deterministic forced plan; exam patterns in `quiz/exam_patterns.py`; receives `{USER_PROFILE}` |
| 8. Flashcards | `mcp/tools/flashcard_generator.py` + `prompts/flashcard.py`; receives `{USER_PROFILE}` |
| 9. Image generation | `mcp/tools/image_generator.py` (single `_STYLE_PREFIX`, gpt-image-1); planner routes on "draw/diagram/…" |
| 10. Profile data | Supabase `profiles` row (also carries `full_name`, `is_debug_user`) |
| 11. Sessions/messages | Supabase `sessions` + `messages` (metadata: tool_used, content); Study Spaces carry a **memory digest** (`space.settings.memory`: `recent_quizzes`, `weak_topics`) rolled up by `quiz/quiz_service.py` |
| 12. Action chips | `frontend/src/components/chat/SuggestedActions.tsx` (actions + follow-up chips), rendered from message meta in `ChatMessages.tsx` |

**Already-solid foundations to extend, not duplicate:**
- §29 model-agnostic policy: *already the design* — one shared SYSTEM_PROMPT +
  profile block reaches every model; policy lives above the model layer.
- §37 clarification logic: planner has tuned clarify-vs-run rules + an
  over-clarification guard (`_refine_plan`) + never-re-clarify contract.
- §34 progress: a revision module already exists (streaks, due topics,
  recommendations on `WelcomeHome`; space memory digest).
- §11 memory seed: space memory digest is the natural home for concept /
  misconception memory — schema-free JSON, already read into prompts by
  `build_space_block`.
- Recently fixed (see IMPROVEMENT_PLAN.md): strong-model routing for teaching
  answers, identity block (name), in-session language stickiness, Hindi gender,
  image prompt leak, follow-ups trailer bug, quiz message duplication.

---

## 2. Requirement coverage map

| Spec sections | Status | Where |
|---|---|---|
| §2 accuracy routing | ✅ done | planner MODEL SELECTION + small-talk gate |
| §3 error correction, §4 assumption validation, §5/§26 analogy mapping, §8 teaching structure, §14/§15 depth, §16 concept-check, §21 endings, §24 typos, §25 layered meaning | 🟡 prompt work | one TEACHING block (workstream A) |
| §6 language persistence | 🟡 partial | in-session done; durable persistence = workstream B |
| §7/§38 learning profile | 🟡 partial | columns exist; missing exam_target + traits = workstream C |
| §10–§12, §33 concept/misconception memory | 🔴 missing | workstream D (extends meta trailer + space memory) |
| §13/§18/§19 exam mode, quiz/flashcard personalization | 🟡 partial | profile reaches generators; needs exam_target + trap/exception instructions = workstream E |
| §20/§21 contextual actions | 🟡 partial | trailer already picks per-response; vocabulary too small = workstream F |
| §17/§31 Socratic & Challenge modes | 🔴 missing | workstream G |
| §22/§23 visual templates | 🟡 partial | one generic style prefix; templates = workstream H |
| §9/§32 curiosity trail, §10 concept graph UI, §34 progress UI | 🔴 missing | workstream I (P2, feeds off D) |
| §27/§28 academic breadth & beliefs | 🟡 small prompt edit | folded into A |
| §30 confidence handling | 🟡 prompt-level now, verifier later | A now; P2 eval-gated verifier |
| §35/§36 response architecture | 🟡 mostly exists | extend trailer + add CORRECTION type (A, D) |
| §37 clarification | ✅ exists | no change |
| §29 model-agnostic policy | ✅ by design | guard with eval set (workstream J) |

---

## 3. Workstreams

### P0

#### A. Teaching-quality system prompt v2 (§2–5, 8, 14–16, 21, 24–28, 30, 36)
- **Current**: SYSTEM_PROMPT covers identity, formatting, level-matching, app
  knowledge; no teaching protocol.
- **Problem (transcript)**: premise "why do stomata close at night?" accepted
  blindly; analogies drifted into wrong biology ("plants respire at night"
  framing); typo lecture instead of silent normalization; mistakes brushed off
  ("Typos happen, but the concept stays strong"); repetitive "If you want, I
  can…" endings; contradictory nitrogen-fixation answers across turns.
- **Recommended**: add a compact TEACHING block to the shared system prompt
  (or a `{TEACHING}` block included only in general/web_search/media templates
  to keep planner + generators lean). Rules, each ~1 line:
  1. *Assumption check*: if the question embeds a premise, validate it first;
     correct gently, then answer the intended question (name key exceptions,
     e.g. CAM plants).
  2. *Correction protocol*: when challenged or when you contradict an earlier
     answer — say plainly what was wrong, give the corrected concept, continue
     teaching. Never minimize ("typos happen").
  3. *Simplify without lying*: a simplification must stay true; state the
     precise version alongside the simple one when the gap matters.
  4. *Analogy mapping*: every analogy ends with "what each part represents";
     if the analogy would make the science false, change the analogy.
  5. *Layered depth for teaching answers*: simple meaning → analogy (if the
     student likes them) → precise explanation → exam-level insight/trap →
     one **concept-check question**. Scale to question complexity; never
     force the full ladder on trivial questions.
  6. *Simple question ≠ beginner*: keep the base explanation simple, add one
     deeper layer for an exam-target student.
  7. *Typos*: silently normalize obvious misspellings; never lecture.
  8. *Endings*: no "If you want, I can…" — the UI shows action chips; end with
     the concept-check question or a clean stop.
  9. *Scope*: any academic subject is in scope; for belief-laden topics label
     historical evidence vs scientific evidence vs belief vs interpretation.
  10. *Confidence*: when genuinely unsure, say what is uncertain and what it
     depends on — never fabricate to keep an analogy or a rhyme.
- **Changes**: prompt-only (`system.py`, optionally `blocks.py` for a separate
  block). Add `RESPONSE_CORRECTION = "CORRECTION"` in `mcp/base.py`; the
  trailer may set `response_type: CORRECTION` so the frontend can badge it
  (optional chip styling in `SuggestedActions.tsx`/`ChatMessages.tsx`).
- **Risk**: prompt bloat → token cost on every call. Mitigate: keep ≤ 25
  lines, measure with the eval set (J).

#### B. Durable language persistence (§6)
- **Current**: profile has `preferred_language` but the block only renders
  after onboarding is **completed**; a mid-chat "from now on Hinglish" lives
  only inside one session's 20-message window.
- **Recommended**:
  1. In `personalization.py`, apply `preferred_language` (and only it +
     identity) even when onboarding is skipped/pending — other fields stay
     gated.
  2. Deterministic post-turn hook in the orchestrator: if the user message
     matches a standing-language request (regex: "from now on / hamesha /
     always … in (hinglish|hindi|english)"), upsert
     `profiles.preferred_language` via the existing
     `update_learning_profile()`. No LLM call, no new API.
  3. Explicit per-message overrides ("answer this in English") already win via
     the prompt priority rules.
- **Changes**: backend only (`personalization.py`, orchestrator hook,
  `supabase_service.update_learning_profile` reuse). No DB, no API change.
  UI already shows the per-chat `MemoryHint`; update its copy once preferences
  persist ("language preference is saved to your profile").

#### C. Learning-profile extension (§7, 38)
- **Current columns**: education_level, preferred_language, explanation_style,
  favorite_subjects, learning_goal, ai_personality, communication_style,
  custom_instructions.
- **Missing**: `exam_target` (JEE/NEET/boards/none) and a compact
  `learning_traits` JSONB (likes_funny_examples, likes_visual_explanations,
  curiosity_level, preferred_depth, wants_concept_check_questions).
- **Changes**:
  - DB: migration `021_learning_profile_tutor.sql` — `ADD COLUMN exam_target
    TEXT`, `ADD COLUMN learning_traits JSONB DEFAULT '{}'::jsonb`.
  - Backend: extend `learning_profile/schema`, repository, `_FIELDS` in
    `personalization.py` ("Exam Target"), render traits as short lines.
  - Frontend: onboarding + Settings → Learning Profile: one exam-target
    select + a few toggles. Traits may also be set *by Aeva* later (D) — keep
    user-editable UI as the source of truth.
  - Privacy rule (§38): only learning-related fields; never infer or store
    personal/sensitive data. Enforce in the trait-extraction prompt (D).

### P1

#### D. Concept & misconception memory (§10–12, 33, 35)
- **Current**: the ANSWER_META trailer already returns
  `available_actions` + `suggested_followups` at zero extra calls; space
  memory digest already stores quiz results and is read into prompts.
- **Recommended** (extend both, no new pipeline):
  1. Extend the trailer JSON: `"concepts": ["refraction", …]` (≤3 slugs) and
     `"misconception": {"belief": …, "correction": …} | null` — the answer
     model tags them while writing the answer.
  2. Orchestrator rolls them into `space.settings.memory` next to
     `weak_topics`: `concepts_taught` (capped ring buffer, e.g. last 30) and
     `misconceptions` (belief, correction, status: corrected, at).
  3. `build_space_block` renders: "Concepts already covered: …", "Corrected
     misconceptions: … — occasionally re-check one with a quick question."
  4. Quiz/flashcard prompts receive the same digest → revision questions from
     real mistakes (§12, §19).
- **Changes**: `response_meta.py`, orchestrator `_attach_actions`/persist path,
  `personalization.py`, quiz/flashcard templates. DB: none (JSON in existing
  `spaces.settings`). Note: General (default) space keeps no memory by design —
  decide either to accept that or add an equivalent JSON on `profiles` for
  space-less users (small migration; recommended: `profiles.learning_memory
  JSONB`).
- **§33/§10 payoff**: "jo refraction humne pehle discuss kiya tha…" comes free
  once `concepts_taught` is in the prompt.

#### E. Exam mode & generator personalization (§13, 18, 19)
- **Current**: quiz/flashcard templates already get `{USER_PROFILE}`; exam
  patterns exist for quiz marking schemes.
- **Recommended**: when `exam_target` is set, generators add: NCERT-anchored
  facts, exceptions, common traps, assertion-reason & application items,
  difficulty auto-tuned by recent scores (already in the digest). Teaching
  answers get the `🎯 JEE Point / ⚠️ Common Trap / ❓ Quick Check` callouts via
  the TEACHING block (A) — only when they add value.
- **Changes**: prompt edits (`quiz_generation.py`, `flashcard.py`), reads
  from C + D. No API change (schema already free-form enough).

#### F. Contextual actions vocabulary (§20, 21)
- **Current**: trailer picks per-response from 7 generic actions.
- **Recommended**: extend `LEARNING_ACTIONS` with `GO_DEEPER`, `VISUALIZE`,
  `COMPARE`, `EXPLAIN_DIFFERENTLY`, `CHALLENGE` (maps to G); trailer rule:
  choose 2–4 actions that fit *this* answer (ray diagram → VISUALIZE; two
  confused terms → COMPARE + QUIZ). Frontend: add labels/icons + handlers in
  `SuggestedActions.tsx` (VISUALIZE → sends a draw prompt; GO_DEEPER → "go
  deeper on <topic>"; CHALLENGE → challenge prompt).
- **Changes**: `mcp/base.py`, `response_meta.py`, `SuggestedActions.tsx`.

### P2

#### G. Challenge Me + Socratic mode (§17, 31)
- CHALLENGE action (F) → prompt: one exam-style item (MCQ / assertion-reason /
  numerical / trap) on the concept just taught, then evaluate the student's
  reply. Socratic = an `ai_personality` option ("Socratic coach") + TEACHING
  rule: hint first for conceptual questions, full answer on request. Both are
  prompt + one enum value; no schema changes.

#### H. Educational visual templates (§22, 23)
- Replace the single `_STYLE_PREFIX` with per-template prefixes
  (`MIND_MAP`, `FLOWCHART`, `PROCESS_DIAGRAM`, `COMIC`, `RAY_DIAGRAM`,
  `ANATOMY`, `CHEMISTRY_STRUCTURE`, `COMPARISON`) chosen by the planner via a
  `template` param on `image_generator`; each prefix encodes correctness
  rules (right arrows, sequence, readable labels, minimal clutter).
  Text-heavy templates (MIND_MAP/FLOWCHART/COMPARISON) should render as
  Mermaid/SVG in-chat instead of the image model (kills the
  "phetosyhesis-typo-in-image" class of bugs); frontend adds a mermaid
  renderer to the markdown pipeline.
- The trailer's `visual_suggestion` (§35): optional field naming a template
  when a visual would materially help → frontend surfaces VISUALIZE chip.

#### I. Curiosity trail & progress surfaces (§9, 32, 34)
- Data comes from D (`concepts_taught` sequence). UI: a small "learning trail"
  strip in the session view; per-subject progress on the revision page only
  where data is reliable (≥ N quizzes). Prompt nudge (already cheap): after a
  chain of related "why" questions, one-line acknowledgement + suggested next
  concept — never on every turn.

#### J. Accuracy eval set & verifier decision (§2, 30)
- Build a ~50-case eval set from the real transcripts (nitrogen fixation,
  stomata/CAM, excretion vs egestion, oligarchy example, Hinglish quality,
  premise-checking, correction behavior). Run on every prompt/model/routing
  change. THEN decide whether a second-pass verifier call for academic answers
  is worth the latency/cost — don't add it speculatively.

---

## 4. Phased roadmap

1. **Phase 1 (P0, ~small)**: A (prompt v2 + CORRECTION type) → B (language
   persistence) → C (migration + onboarding fields). Ship together; verify
   with J's first 20 cases.
2. **Phase 2 (P1)**: D (memory via trailer) → E (exam-aware generators) →
   F (action vocabulary). D before E — generators feed off the digest.
3. **Phase 3 (P2)**: G, H, I in any order; J runs continuously from Phase 1.

## 5. Risks & migration notes

- **Prompt budget**: SYSTEM_PROMPT ships on every call; TEACHING block must
  stay tight (≤ ~25 lines) or split per-template. Measure tokens before/after.
- **Trailer fragility**: more trailer fields = more malformed-JSON risk on
  weaker models; keep fields optional, parse defensively (existing parser
  already holds back the sentinel), and let strong-model routing carry it.
- **Space-less users**: space memory only exists inside real Study Spaces;
  decide `profiles.learning_memory` JSONB (one migration) so General-chat
  users get memory too.
- **Trait inference (§38)**: traits written by Aeva must pass a whitelist
  (learning-related keys only), be visible & editable in Settings, and never
  include personal/sensitive inferences.
- **Model variance (§29)**: policy is centralized, but instruction-following
  differs per model — the eval set (J) is the guard, plus the existing
  candidate-list config to drop a misbehaving model without code changes.
- **Migrations**: additive columns only (`exam_target`, `learning_traits`,
  optional `learning_memory`) — no backfill needed; all render paths treat
  missing values as "absent" today.

## 6. Validation against the transcript

Every P0/P1 item traces to observed behavior: premise acceptance (stomata),
factual drift (rhizobium/nitrogen), mistake-minimizing ("typos happen"),
language reminders repeated, IIT/JEE asks with no exam model, identical
generic actions on every answer, image typos, and the student's own habits
(funny examples, visual asks, chained "why" questions, typo-heavy Hinglish).
Re-run the same transcript flows after each phase as the acceptance test.
