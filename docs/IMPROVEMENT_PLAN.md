# User-Feedback Improvement Plan

Source: analysis of three real student sessions (Avni, Class 7 — Aug 2026).
Each issue below is something a real user hit. Status: ✅ fixed in code,
🔧 config/ops change, 🚧 planned (needs a feature build).

## ✅ Fixed in code

| # | Issue seen by the user | Root cause | Fix |
|---|---|---|---|
| 1 | "What is my name?" → *"I don't have access to your name"* in a new session | Chat history is session-scoped (last 20 messages); profile prompt only applies after onboarding and has no name | `build_identity_block()` in `aeva/llm/prompts/personalization.py` injects the account `full_name` (Google sign-in) into every turn's prompt, wired in `assistant_orchestrator._setup_and_plan` |
| 2 | Wrong/confusing science from the cheap model (nitrogen fixation contradiction, garbled Pakistan answer, mis-mapped student mnemonic that silently dropped Hg) | Planner prompt routed "definitions / simple explanations / straightforward educational questions" to the cheapest model | MODEL SELECTION rules rewritten in `aeva/llm/prompts/orchestrator.py`: anything that teaches facts/concepts → stronger model; cheap tier only for greetings/small talk/formatting |
| 3 | Aeva's Hindi gender flips ("samajh **gaya**" vs "de **dungi**") | No grammatical-gender rule in the system prompt | `system.py`: Aeva is female; always feminine first-person in Hindi/Hinglish |
| 4 | "How to create a document in Aeva?" → refusal + MS Word instructions; "page 236 dekho" → bare apology with no pointer to upload | System prompt had no product knowledge | `system.py`: StudyAssistant feature block + rule to suggest uploading textbook pages/photos when a book/page is referenced |
| 5 | Class 7 student asks for "IIT/JEE notes" → silently complies at full JEE level | No level-calibration rule | `system.py`: acknowledge the gap, teach a foundation version that builds toward the goal |
| 6 | "From now on talk in Hinglish" forgotten after a few turns | Only "language continuity" for referenced content was specified | `system.py`: standing mid-chat preferences persist for the whole conversation and outrank the profile language |
| 7 | Image replies dump the full raw generation prompt ("Here's the image you asked for: Create a clean educational…") | Caption fallback echoed the prompt (`image_generator.py:123`) | Friendly fixed fallback; raw prompt never shown |
| 8 | Duplicate user bubbles: "creayte a quiz on metals" followed by "Generate a quiz on metals and non-metals" | Quiz-setup submission sends a canonical message with no `displayText` (`ChatPage.tsx handleGenerateQuiz`) | Renders as a short "Start quiz: <topic>" action label |
| 9 | Follow-up suggestion chips appear only sometimes | The `ANSWER_META_INSTRUCTION` prompt ended mid-sentence ("Use [] for suggested_followups when no meaningful") | Sentence completed in `response_meta.py`; teaching answers must always carry follow-ups |
| 10 | **Almost every answer ran on the mini model** even though gpt-5.4/gpt-4.1 were configured | `_fast_path_plan` skipped the planner for ANY no-media plain-text turn and hardwired `LLM_FAST_MODEL` (gpt-4o-mini) — so the planner's model choice (and fix #2) never ran for ordinary questions | Fast path now gated by `_is_small_talk()` (greetings/thanks/acks only, incl. Hinglish); every real question goes through the planner, which picks from the tool's candidate list |
| 11 | Users expect Aeva to remember across chats (it doesn't, by design) | No UI communicated that memory is per-chat | `MemoryHint` component on both empty-chat screens (`EmptyState`, `WelcomeHome`): "Aeva remembers only this chat — new chats start fresh", pointing to Settings → Learning Profile for lasting preferences |

## 🔧 Config / ops (no code)

- **"⚡ powered by: \<model\>" visible to students** — dev badge; set
  `SHOW_MODEL_BADGE=false` (or unset) in the production environment. The
  frontend already strips old baked-in trailers at render time.
- **Model candidate lists** — routing quality also depends on
  `GENERAL_LLM_MODELS` etc. Keep at least one strong model in the `general`
  tool's list, or fix #2 only helps where a strong candidate exists.

## 🚧 Planned (feature work, in priority order)

1. **Textbook grounding (RAG over the student's book).** The user named her
   exact book and page and got nothing. Short term the upload nudge (#4)
   covers it; the real feature is board/NCERT textbook ingestion so
   chapter-scoped flashcards/mnemonics cover the *whole* chapter (her
   complaint: "itna bada chapter aur bas itna hi?"). Scale generated study
   material to chapter size.
2. **Structured mindmaps instead of image generation.** Text-heavy diagrams
   from the image model produce typos (the "phetosyhesis" incident — the typo
   was in Aeva's own generated mindmap). Render mindmaps/flowcharts as
   Mermaid/SVG in the chat; keep the image model for pictorial diagrams
   (stomata, comics).
3. **Profile fields for name/class in onboarding** — preferred name, class,
   board, target exam; feeds #1 and #5 without inference.
4. **Admin/analytics label polish** — a student saw "documents-0" in
   analytics and asked Aeva about it; human-readable labels + empty states.
5. **Hinglish quality QA set** — a small eval set of real Hinglish student
   turns (from these transcripts) run against candidate models before
   changing routing/config.
