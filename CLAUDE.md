# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout

Two apps live in this repo:

- `backend_v2/` — the **authoritative** backend: Flask + flask-smorest + Supabase + Google Gemini.
- `frontend/` — Vite + React 18 + TypeScript + Tailwind + shadcn/ui SPA.

> The root `README.md` is **stale**. It documents an older FastAPI / Groq / ChromaDB / spaCy backend (and a `backend/app/` tree) that no longer exists. Ignore its stack, commands, and env vars. Trust `backend_v2/README.md` and this file instead. Likewise, the `backend_v2/app/` package is being deleted in favor of `backend_v2/aeva/` — only `aeva/` is live.

## Commands

### Backend (`backend_v2/`, Python 3.12, Poetry)

```bash
poetry install
poetry run poe run            # flask --app aeva.app run --debug --port 8000
poetry run poe lint-check     # ruff check
poetry run poe lint-fix       # ruff check --fix
poetry run poe format         # ruff format
poetry run poe type-check     # mypy (strict: disallow_untyped_defs)
poetry run pytest             # tests (pytest is configured; no test suite committed yet)
```

Ruff runs with `select = ["ALL"]` and 80-char lines — new code must pass the full ruff ALL ruleset and mypy strict typing. Match the existing style: module/function docstrings on everything, double quotes, explicit type hints.

Requires a `.env` (copy from `.env.sample`). `aeva.app.load_env_vars` raises `KeyError` at startup if `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, or `GEMINI_API_KEY` are missing.

### Frontend (`frontend/`, npm)

```bash
npm install
npm run dev        # Vite dev server on :5173
npm run build      # production build
npm run lint       # eslint
```

`@/` is the path alias for `frontend/src/`. API base URL comes from `VITE_API_BASE_URL` (default `http://localhost:8000`).

### Database

Supabase Postgres. Migrations are plain SQL in `backend_v2/supabase/migrations/` (`001_initial_schema.sql`, `002_storage_bucket.sql`, `003_orchestration_and_quiz.sql`) — run them in order in the Supabase SQL editor. Every table uses Row-Level Security scoped to `auth.uid()`. Tables: `profiles`, `sessions`, `messages`, `media`, `orchestration_runs`, `quizzes`, `quiz_questions`, `quiz_attempts`.

## Backend architecture

### Layering (per-domain vertical slices)

Each domain (`auth`, `session`, `media`, `chat`, `assistant`, `quiz`) follows the same three layers:

- **controller** — a flask-smorest `Blueprint` of `MethodView` classes. Uses `@blueprint.arguments(Schema)` for marshmallow validation and the `@user_required` decorator (from `aeva/common/decorators.py`) which verifies the Supabase JWT and injects `current_user: UserData` as the first argument.
- **repository** — business logic, exposed as `@staticmethod`s on a class (e.g. `ChatRepository.process_chat`). Repositories are stateless; they call services directly.
- **schema** — marshmallow schemas plus a frozen dataclass for the validated request data.

Blueprints are registered in `aeva/app.py:create_app()`. All routes are prefixed by their blueprint (`/auth`, `/sessions`, `/media`, `/chat`, `/assistant`, `/quiz`); `/health` is the only unprefixed route. Swagger UI is served at `/docs`.

### Conventions

- **Response envelope**: every success returns `{"msg": str, "data": ...}` via `success_response()` in `aeva/common/schema/__init__.py`.
- **Errors**: raise `CustomError(ERROR_CODES["..."])` (see `aeva/common/errors.py`). The global handler in `app.py` serializes it to `{"msg", "code"}` with the right HTTP status. Unhandled exceptions become a 500 `INTERNAL_ERROR`.
- **Auth**: all routes except `/health`, `/auth/login/google`, `/auth/callback`, `/auth/refresh` require `Authorization: Bearer <supabase_jwt>`.

### Dependency injection

`aeva/containers.py` is a `dependency-injector` `DeclarativeContainer` wired into the app (`container.wire`, stored at `app.extensions["container"]`). It provides singletons for `SupabaseService`, per-capability `LLMClient`s, and the `tool_registry`. Code that needs the registry pulls it lazily via `current_app.extensions["container"].tool_registry()`.

### The assistant orchestrator (core of chat)

The chat flow is the most important thing to understand:

1. `POST /chat/` (and `/chat/stream`) → `ChatRepository` is a **thin shim** that maps the request to an `AssistantRequestData` and delegates to `AssistantRepository` → `AssistantOrchestrator`. `/assistant/` hits the same orchestrator directly. New behavior belongs in the orchestrator, not the chat shim.
2. `AssistantOrchestrator.run()` (`aeva/orchestration/assistant_orchestrator.py`):
   - Loads session + recent message history from Supabase, persists the user message.
   - **Plan step**: calls the LLM with `generate_structured()` against `PLAN_TURN_SCHEMA` to decide between `clarify` and `run_tool` (picking a tool + params from the registry's tool definitions).
   - **Anti-over-clarification guard**: `_clarification_unnecessary()` heuristically overrides a `clarify` plan for greetings, short/question-shaped messages, or when media is attached, falling back to a rule-based tool pick (`_fallback_tool_plan`).
   - **Clarify path**: persists an `orchestration_runs` row (`awaiting_clarification`) and returns questions to the client. The client answers, re-calls with `run_id` + `clarification`, and `_merge_clarification` folds the answers into an enriched message before re-planning.
   - **Tool path**: executes the chosen tool via the `ToolRegistry`, persists the assistant message with `metadata` (`tool_used`, `content`, `status`), and auto-titles the session from the first message.

### MCP-style tools

Tools implement `BaseTool` (`aeva/mcp/base.py`): a `definition` (name, description, JSON-Schema `parameters_schema`) and `execute(ctx, params)`. They are registered in `ToolRegistry` (`aeva/mcp/registry.py`) by `build_tool_registry` in the container. Current tools (`aeva/mcp/tools/`):

- `web_search` — Gemini answer grounded with Google Search; returns `{answer, sources}`.
- `media_llm` — answers over uploaded media (downloads files from Supabase Storage, attaches to the Gemini call).
- `quiz_generator` — generates a quiz, persisted via the quiz layer.

The orchestrator passes tool definitions to the LLM as part of the plan prompt, so **adding a tool = implement `BaseTool` + register it in `build_tool_registry`**; the orchestrator will discover it automatically.

### LLM client

`aeva/llm/llm_client.py` wraps `google-genai` (Gemini). Key points:

- Constructed with a `config_key` (e.g. `LLM_WEB_SEARCH_MODEL`) so each capability can use a different model; all keys fall back to `LLM_MODEL` (default `gemini-2.5-flash`). Models are configured in `aeva/app.py:load_env_vars`.
- `generate()`, `generate_structured(schema)` (JSON mode), and `generate_stream()`. `use_search=True` enables Google Search grounding; grounding citations are captured on `self.last_sources` after each call.
- `format_sse_chunk()` produces the `data: {...}\n\n` SSE frames used by streaming endpoints.
- Prompts live in `aeva/llm/prompts.py`; structured-output JSON schemas in `aeva/llm/schemas/`.

### Supabase service

`aeva/supabase/supabase_service.py` is the single wrapper over the Supabase client (created with the **service role key**, so app-level RLS is bypassed — ownership is enforced in code by always filtering on `user_id`). It also owns the server-side **PKCE Google OAuth** flow (`build_oauth_url`, `exchange_code`, `refresh_session`) and JWT verification (`verify_token` handles both HS256 shared-secret and asymmetric JWKS tokens). The client and JWKS client are cached as class attributes.

### Deployment

`main.py` exposes `app = create_app()` as the WSGI entry point; `vercel.json` routes everything to it via `@vercel/python`.

## Frontend architecture

- **Auth** (`src/contexts/AuthContext.tsx`): fully token-based. Login redirects the browser to the backend's `/auth/login/google`; the backend redirects back to `/auth/callback#access_token=...&refresh_token=...` (handled by `src/pages/AuthCallback.tsx`). Tokens live in `localStorage` (`aeva_*` keys); a timer auto-refreshes via `/auth/refresh` ~1 min before expiry. There are **no Supabase keys in the frontend** — auth is entirely backend-driven.
- **API layer** (`src/services/`): `apiService` (`api.ts`) for REST, `streamingService` (`streamingService.ts`) for SSE. Both take a token-getter set once in `AuthContext`. Endpoint paths and base URL are centralized in `src/constants/api.ts`. The REST response shape is `APIEnvelope<T> = { msg, data }`, matching the backend envelope.
- **Routing/pages**: `src/pages/` (`LoginPage`, `AuthCallback`, `ChatPage`, `NotFound`); `ProtectedRoute` gates authenticated pages. Chat UI components are in `src/components/chat/` (`ChatInput`, `ChatMessages`, `SessionSidebar`, `ClarificationPanel`, `QuizPanel`) — note the clarification and quiz panels mirror the backend orchestrator's clarify/quiz responses.
- **UI primitives**: `src/components/ui/` is shadcn/ui (Radix + Tailwind) — generated components; prefer composing them over hand-rolling.
</content>
</invoke>
