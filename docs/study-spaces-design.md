# Study Spaces — Technical Design

**Status:** Draft for review · **Author:** Claude + Dhananjay · **Date:** 2026-08-03

Study Spaces reorganizes StudyAssistant around subjects instead of chats: every
conversation, upload, quiz, flashcard set, note, and bookmark lives inside a
dedicated workspace for one topic ("Operating Systems", "NEET Biology"). This
document is the full technical design — data model, API, frontend architecture,
AI context, migration, and a phased delivery plan — grounded in the current
codebase so no phase requires reworking an earlier one.

**Decisions already made**

- Migration strategy: every existing user gets an auto-created **General**
  space; all current data is backfilled into it. Zero data loss, the app
  behaves identically on day one.
- Delivery is phased (foundation → notes → dashboard/home → search & export);
  the schema below is final from Phase 1 so later phases are additive.
- **Opt-in, never forced.** Spaces are an additive layer, not a replacement.
  A user who never touches the feature keeps today's exact experience:
  chat-first sidebar, same home screen, no onboarding prompts, no redirects.
  The General space is a data-level default that never surfaces in the UI
  unless the user opens the Spaces area. Spaces-specific UI (Continue
  Learning rail, space chips) appears only after the user has created at
  least one real (non-default) space.

---

## 1. Concept & terminology

| Term | Meaning |
|---|---|
| **Study Space** | A per-user workspace for one subject/course/goal. Owns sessions, media, quizzes, flashcard sets, bookmarks, notes, and (later) progress. |
| **General space** | Each user's default space (`is_default = true`). Created automatically; cannot be deleted. Holds legacy + unfiled content. |
| **Convert to space** | Promoting an existing chat into a new space: the session (and everything derived from it) moves there. |

Ownership rule: **every content row belongs to exactly one space.** A space
belongs to exactly one user (collaboration comes later via a membership table —
see §9; the schema does not block it).

---

## 2. Data model

### 2.1 New table: `study_spaces` (migration `016_study_spaces.sql`)

```sql
CREATE TABLE IF NOT EXISTS study_spaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',          -- free text + suggested list in UI
    color TEXT NOT NULL DEFAULT 'brand',       -- app-level palette key
    icon TEXT NOT NULL DEFAULT 'book',         -- app-level icon key (lucide name)
    cover_url TEXT,                            -- optional storage path
    is_default BOOLEAN NOT NULL DEFAULT FALSE, -- the user's General space
    -- Drives "Continue Learning" ordering; bumped by any activity inside.
    last_activity_at TIMESTAMPTZ DEFAULT NOW(),
    -- Room for future per-space settings (AI tone, exam target, …) without
    -- migrations.
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_spaces_user ON study_spaces(user_id, last_activity_at DESC);
-- Exactly one General space per user.
CREATE UNIQUE INDEX idx_spaces_one_default
    ON study_spaces(user_id) WHERE is_default;
```

RLS: enabled, same service-role pattern as every other table (ownership is
enforced in code by filtering on `user_id`).

### 2.2 Scoping existing tables

Add a nullable `space_id` FK to the four content roots. Children (messages,
quiz_questions, flashcards, media_chunks…) inherit through their parent — they
never carry `space_id` themselves.

```sql
ALTER TABLE sessions        ADD COLUMN space_id UUID REFERENCES study_spaces(id) ON DELETE SET NULL;
ALTER TABLE media           ADD COLUMN space_id UUID REFERENCES study_spaces(id) ON DELETE SET NULL;
ALTER TABLE quizzes         ADD COLUMN space_id UUID REFERENCES study_spaces(id) ON DELETE SET NULL;
ALTER TABLE flashcard_sets  ADD COLUMN space_id UUID REFERENCES study_spaces(id) ON DELETE SET NULL;
ALTER TABLE bookmarks       ADD COLUMN space_id UUID REFERENCES study_spaces(id) ON DELETE SET NULL;
-- One partial index per table: (space_id, created_at DESC)
```

Why nullable + `ON DELETE SET NULL`, given "everything belongs to a space":

- **Nullable** keeps the migration online (no table rewrite under lock) and
  makes the app defensive: `space_id IS NULL` is *read as* the General space.
  The application always **writes** an explicit `space_id`.
- **SET NULL** means deleting a space can never destroy content by accident at
  the DB layer. The API's space deletion explicitly offers "move contents to
  General" (default) or "delete everything" — both implemented in the
  repository, not by cascade.

Derived rows follow their parents automatically: a quiz generated in a chat
gets the session's `space_id` at insert time (one extra field in the existing
insert paths — `quiz_repository`, `flashcard_repository`, media upload,
bookmark create).

### 2.3 Backfill (same migration)

```sql
-- One General space per existing user…
INSERT INTO study_spaces (user_id, name, is_default, subject, icon)
SELECT id, 'General', TRUE, '', 'sparkles' FROM profiles
ON CONFLICT DO NOTHING;

-- …and every existing row files into it.
UPDATE sessions s SET space_id = sp.id
FROM study_spaces sp
WHERE sp.user_id = s.user_id AND sp.is_default AND s.space_id IS NULL;
-- (repeat for media / quizzes / flashcard_sets / bookmarks)
```

New users: the General space is created in `AuthRepository.get_me` alongside
the profile upsert (lazy, idempotent — same pattern as profile creation).

### 2.4 Phase 2 table (designed now, created later): `notes`

```sql
CREATE TABLE IF NOT EXISTS notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    space_id UUID REFERENCES study_spaces(id) ON DELETE SET NULL,
    title TEXT NOT NULL DEFAULT 'Untitled note',
    content_md TEXT NOT NULL DEFAULT '',        -- markdown, KaTeX, code fences
    source_type TEXT NOT NULL DEFAULT 'manual'  -- manual | response | media | quiz
        CHECK (source_type IN ('manual', 'response', 'media', 'quiz')),
    source_ref TEXT,                            -- message id / media id / …
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

Notes reuse the existing renderer (`MarkdownContent` already does markdown,
tables, KaTeX + mhchem, code); editing is a textarea/CodeMirror + live preview,
not a block editor — that keeps "Generate Quiz / Flashcards / Summarize from
note" trivial (`source_content` flow already exists for exactly this).
Bookmarks already accept `item_type = 'note'`; migration 008's
`search_vector` pattern is applied to `notes` on creation.

### 2.5 What deliberately has **no** new table

| Spec item | Covered by |
|---|---|
| Quiz history / retakes / analysis | Already exists (`quiz_attempts`, analytics) — only gains a space filter. |
| Flashcard progress | Already exists (`flashcard_study`). |
| Sharing notes/quizzes/flashcards | Generic `shares` table takes any `content_type` (TEXT) — `note` and later `space` need **zero** schema change, just a resolver in `share/resolvers.py`. |
| In-space search | Migration 008's `search_all()` + per-table `search_vector` — add a `p_space` parameter and the `notes` branch. |
| Study time / progress stats | Phase 3 computes from existing rows (messages, attempts, study events). If that proves too coarse, an append-only `space_events` table can be added later without touching anything above. |

---

## 3. Backend design

### 3.1 New vertical slice: `aeva/space/`

Follows the house pattern exactly (`*_controller` MethodViews +
`@user_required`, stateless `*_repository`, marshmallow `schema/`, registered
in `app.py`).

| Method & path | Purpose |
|---|---|
| `GET /spaces/` | List my spaces, ordered by `last_activity_at` (drives sidebar + Continue Learning). Each row carries lightweight counts. |
| `POST /spaces/` | Create (name, description?, subject?, color?, icon?, cover?). |
| `GET /spaces/{id}` | Space detail + counts per content type. |
| `PATCH /spaces/{id}` | Rename / restyle / edit description. |
| `DELETE /spaces/{id}?mode=move\|purge` | Default `move`: contents → General. `purge`: delete contents too. General itself is undeletable (400). |
| `GET /spaces/{id}/overview` | Aggregated workspace payload: recent sessions, media, quizzes, flashcards, bookmarks (+ notes in P2), continue-learning pointers. One round-trip for the workspace page. |
| `POST /spaces/convert` | Body `{session_id, name?, …style}`. Creates a space from an existing chat and re-files the session **and its derived content** (media, quizzes, flashcard sets, bookmarks referencing it) into it. |

### 3.2 Changes to existing slices (all additive)

- **sessions**: `POST /sessions/` accepts `space_id` (default: General);
  `GET /sessions/` accepts `?space_id=` filter. Any turn bumps the space's
  `last_activity_at` (piggybacks on the existing `update_session` call).
- **media / quiz / flashcard / bookmark** list endpoints: `?space_id=` filter.
  Create paths stamp `space_id` (from the session for chat-generated items,
  from the request for direct uploads).
- **search**: `GET /search?space_id=` → passes through to `search_all()`.
- **orchestrator**: see §5.

`space_id` resolution helper lives once in `SupabaseService`
(`resolve_space(user_id, space_id | None) -> id`, creating/fetching General as
needed) — no per-domain reimplementation.

### 3.3 Export (Phase 4)

`GET /spaces/{id}/export?format=md` streams a single markdown bundle (notes,
quiz Q&A, flashcards, bookmark list, media file list). PDF reuses the existing
client-side `quizPdf`/`printReport` machinery generalized to a space; ZIP is
future (needs storage egress thought).

---

## 4. Frontend design

### 4.1 Information architecture

```
/spaces                     My Study Spaces (grid; create dialog)
/spaces/:spaceId            Space workspace (persistent header: icon, name,
                            subject · tabs below)
   ├── (default tab) Chat   — chat list + active conversation
   ├── Media                — uploads scoped to the space
   ├── Quizzes              — sets, attempts, retake
   ├── Flashcards           — decks + study
   ├── Bookmarks            — space-scoped
   └── Notes (P2) · Progress (P3)
/chat?sessionId=…           KEPT — legacy deep links resolve the session's
                            space and redirect to /spaces/:id/chat
```

- **Sidebar** (`AppSidebar`) stays chat-first. A compact, collapsible
  "Study Spaces" section is ADDED (spaces by activity + "New space" +
  "All spaces" link); the chat list, global tabs, and mobile shell are
  untouched. Users who ignore the section lose nothing and see no behavioral
  change anywhere else.
- **Home** (`/chat` today): unchanged by default. A "Continue Learning" rail
  appears on the empty state ONLY when the user has at least one real space
  (General alone ⇒ nothing renders). Phase 3's home redesign remains gated on
  the same condition.
- **Convert chat → space**: menu action on any session row; opens the create
  dialog pre-filled (name = session title) and calls `/spaces/convert`.

### 4.2 State & data

- New query keys: `qk.spaces`, `qk.space(id)`, `qk.spaceOverview(id)`; existing
  list hooks gain an optional `spaceId` argument that flows into both the query
  key and the request. Active space id lives in the URL (same philosophy as
  `sessionId`) — no context/global store needed.
- `types/index.ts`: `StudySpace`, `SpaceOverview`; `Session`, `MediaItem`,
  `QuizContent`, `FlashcardContent`, `Bookmark` gain `space_id?: string`.
- Creation dialog: name, subject (combobox with the landing page's `SUBJECTS`
  list as suggestions), description, color swatch row, icon picker (curated
  ~20 lucide names), optional cover upload (reuses media upload → storage).

### 4.3 Design language

Notion/NotebookLM-flavored but native to the existing aurora-glass system:
space cards use the space color as a soft gradient tint on `GlassCard`;
workspace header mirrors the admin `AdminShell` layout patterns; tabs use the
existing `Tabs` primitives. No new design system.

---

## 5. AI context ("Aeva remembers the subject")

Layered, cheapest-first — each layer is additive and independently shippable:

1. **Space identity block (Phase 1).** The orchestrator already builds a
   personalization block from the profile; it gains a space section rendered
   from the session's space: name, subject, description. Planner + answer
   models both receive it (`prompts/personalization.py` pattern). Cost: zero
   extra queries — the session row (already fetched) carries `space_id`, one
   cached space fetch.
2. **Space memory digest (Phase 3).** A rolling `settings.memory` JSON on the
   space: recent topics studied, weak topics from quiz analytics, flashcard
   decks in rotation. Updated opportunistically after quiz submission /
   flashcard sessions (no new infra). Injected as a short "What I know about
   this student's progress in this space" block.
3. **Cross-chat retrieval (Phase 4+).** `media_chunks` embeddings already
   exist per document; extend RAG so `media_llm` searches the whole space's
   documents (filter chunks by the space's media ids), not just selected ones.
   The knowledge-graph future slots in here without schema changes to §2.

Recommendations (Phase 4) are computed from the same inputs as layer 2 and
rendered as suggestion chips on the space workspace — server-computed, no new
LLM surface initially.

---

## 6. Progress dashboard (Phase 3)

All derivable today, per space, without new tables:

| Metric | Source |
|---|---|
| Questions asked | `messages` count (role=user) via space sessions |
| PDFs uploaded | `media` count |
| Quizzes completed / scores | `quiz_attempts` |
| Flashcards reviewed | `flashcard_study` |
| Weak / strong topics | existing quiz analytics aggregation, space-filtered |
| Study time | approximated from activity timestamps (sessions/attempts/study events); if precision matters later → `space_events` table |
| Overall progress | weighted blend of the above (same formula the Analytics page uses, scoped) |

One endpoint: `GET /spaces/{id}/stats`, cached client-side with a short TTL.

---

## 7. Delivery plan

| Phase | Ships | Touches |
|---|---|---|
| **1 — Foundation** | Migration 016 + backfill; space slice (CRUD, overview, convert, delete modes); `space_id` stamping + filters in sessions/media/quiz/flashcards/bookmarks; General-space lazy create; spaces sidebar + `/spaces` grid + workspace page with 5 tabs; create/convert dialogs; chat inherits space; AI space-identity block; Continue Learning rail | ~1 migration, 1 new backend slice + 5 touched, ~8 new frontend files + sidebar/router edits |
| **2 — AI Notes** | `notes` table + slice; "Save as note" on responses; note editor (md + preview); quiz/flashcards/summarize/export-PDF from note; notes tab; note sharing via generic shares; notes in search | isolated: nothing from P1 changes |
| **3 — Progress + Home** | `/spaces/{id}/stats`; Progress tab; Continue Learning becomes the signed-in home; space memory digest into AI context | additive endpoints + one prompt block |
| **4 — Search, recommendations, export** | space-filtered `search_all` + unified in-space search UI; recommendation chips; markdown/PDF space export; space-level sharing | additive |

Each phase is independently releasable; the Phase 1 schema is the contract.

## 8. Migration & rollout safety

- Migration 016 is online-safe: additive columns, no rewrites, backfill
  batched by table. Old app code ignores `space_id` entirely, so backend can
  deploy before/after the migration in any order (writes without `space_id`
  are healed by a follow-up backfill run — the General fallback also covers
  them at read time).
- `/chat?sessionId=` deep links, bookmark resume, share URLs: all keep working
  (session→space resolution happens server-side in one place).
- Feature flag: the spaces sidebar can ship behind a simple env/config toggle
  (`FEATURE_SPACES`) for staged rollout if desired.
- Rollback story: dropping the UI reverts UX completely; data columns are
  inert if unused.

## 9. Future-proofing (explicit non-breakage arguments)

| Future feature | Why this design absorbs it |
|---|---|
| Collaborative / class spaces | Add `space_members(space_id, user_id, role)`; ownership checks route through a membership lookup instead of `user_id =`. Content FKs unchanged. |
| Teacher shared spaces / templates | A space export (P4) doubles as a template blob; `shares.content_type='space'` already fits. |
| Spaced repetition / revision calendar | Reads `flashcard_study` + space scoping; scheduling table is new + independent. |
| Knowledge graph / timeline | Built on `space_id`-scoped content + embeddings that already exist. |

## 10. Open questions (need product answers, none block Phase 1)

1. Can a session **move** between spaces after creation (drag & drop), or only
   via "convert"? (Design supports both; UI cost only.)
2. Should the mobile tab bar become space-aware in Phase 1 or keep the current
   4 global tabs until Phase 3's home redesign? (Recommend: keep until P3.)
3. Cover images: worth the storage/UX cost in P1, or defer to P2? (Recommend:
   defer; color+icon carry the identity.)
4. Space limit per user (spam/abuse)? Suggest soft cap ~50.
