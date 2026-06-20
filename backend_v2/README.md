# StudyAssistant — Backend (Aeva API)

Flask + flask‑smorest API powering the **Aeva** assistant. It orchestrates MCP‑style tools
(web search, media Q&A, quiz generation) over Google Gemini, with Supabase for Postgres,
storage, and Google OAuth.

## Tech

Python 3.12 · Flask · flask‑smorest (OpenAPI/Swagger) · marshmallow · dependency‑injector ·
Supabase · Google Gemini (`google-genai`) · PyJWT · Pillow · Poetry.

## Setup

```bash
cd backend_v2
cp .env.sample .env            # fill in Supabase + Gemini values
poetry install
poetry run poe run             # http://localhost:8000
```

- **Swagger UI:** http://localhost:8000/docs  ·  **OpenAPI spec:** `/openapi.json`
- **Health:** `/health`

### Tooling

| Command | Description |
|---|---|
| `poetry run poe run` | Dev server (`flask --app aeva.app run --debug --port 8000`) |
| `poetry run poe lint-check` / `lint-fix` | Ruff lint |
| `poetry run poe format` | Ruff format |
| `poetry run poe type-check` | mypy (strict) |

### Environment variables

See `.env.sample` for the full list. Required: `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`. Key optional ones: `SUPABASE_JWT_SECRET`,
`SUPABASE_STORAGE_BUCKET`, `LLM_MODEL` + per‑capability `LLM_*_MODEL` / `LLM_*_PROVIDER`,
`ALLOWED_ORIGINS`, `FRONTEND_URL`, `COOKIE_SECURE`, `MAX_UPLOAD_MB`, `QUIZ_MAX_QUESTIONS`.

## API endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Health check |
| GET | `/auth/login/google` | Start Google OAuth (PKCE, backend‑driven) |
| GET | `/auth/callback` | OAuth callback → redirects to frontend with tokens |
| POST | `/auth/refresh` | Refresh access token |
| GET/PUT | `/auth/me` | Current profile / upsert |
| GET/POST | `/sessions/` | List / create chat sessions |
| PATCH/DELETE | `/sessions/{id}` | Rename / delete |
| GET | `/sessions/{id}/messages` | Message history |
| GET/POST | `/media/` | List / upload media |
| DELETE | `/media/{id}` | Delete media |
| POST | `/assistant/` · `/assistant/stream` | Run a turn (JSON / SSE) |
| POST | `/chat/` · `/chat/stream` | Legacy chat (shim over assistant) |
| GET | `/quiz/{id}` · POST `/quiz/{id}/submit` | Fetch / submit a quiz |

All non‑auth routes require `Authorization: Bearer <supabase_jwt>`. Responses use a
`{ "msg": str, "data": ... }` envelope. In Swagger, click **Authorize** and paste a JWT.

## Architecture

**Per‑domain vertical slices** — each domain (`auth`, `session`, `media`, `chat`,
`assistant`, `quiz`) has a `*_controller` (flask‑smorest blueprint of `MethodView`s, with
`@user_required` injecting `current_user`), a `*_repository` (stateless business logic), and
a `schema` (marshmallow + a frozen request dataclass). Errors raise `CustomError`; success
goes through `success_response()`.

**The assistant core** — `/chat` is a thin shim over `aeva/orchestration/assistant_orchestrator.py`:

```
turn → plan (Gemini structured output) → clarify? ─yes→ ask & persist run
                                          │
                                          └no→ run ONE MCP tool → persist → stream/return
```

- **MCP tools** (`aeva/mcp/`): `web_search` (Gemini + Google Search grounding),
  `media_llm` (multimodal over uploaded files), `quiz_generator` (structured quiz, persisted).
  Add a tool = implement `BaseTool` + register in `containers.py`.
- **LLM providers** (`aeva/llm/providers/`): a provider interface + factory selected by
  config, so each capability can use a different model/provider. Gemini is the only
  implementation today; the prompts + output schemas live per‑capability in `aeva/llm/prompts/`.
- **Supabase** (`aeva/supabase/supabase_service.py`): single wrapper for DB, storage, and the
  PKCE Google OAuth + JWT verification. Uses the service‑role key; ownership is enforced in
  code by always filtering on `user_id`.

## File structure

```
backend_v2/
├── api/index.py               # Vercel serverless entry (exposes `app`)
├── main.py                    # WSGI entry (local gunicorn / dev)
├── vercel.json · .vercelignore
├── pyproject.toml             # deps + poe tasks + ruff/mypy config
├── requirements.txt           # used by Vercel
├── supabase/migrations/*.sql  # DB schema (run in order)
└── aeva/
    ├── app.py                 # app factory, config, blueprint + Swagger registration
    ├── containers.py          # dependency-injection wiring (LLM clients, tool registry)
    ├── auth/  session/  media/  chat/  assistant/  quiz/   # domain slices
    │     └── *_controller.py · *_repository.py · schema/
    ├── orchestration/
    │     ├── assistant_orchestrator.py   # plan → clarify / run tool → stream
    │     └── models.py                    # AssistantContext, RunStatus, QuizOptions…
    ├── mcp/
    │     ├── base.py · registry.py
    │     └── tools/  web_search.py · media_llm.py · quiz_generator.py
    ├── llm/
    │     ├── llm_client.py                # provider-agnostic facade
    │     ├── providers/  base.py · gemini.py · factory.py
    │     └── prompts/     system · orchestrator · web_search · media · quiz
    ├── quiz/  quiz_engine.py (scoring) · quiz_service.py · quiz_repository.py
    ├── media/ compression.py · attachments.py
    ├── supabase/supabase_service.py
    └── common/  decorators.py · errors.py · schema/
```

## Database

Supabase Postgres with Row‑Level Security. Apply `supabase/migrations/*.sql` in order.
Tables: `profiles`, `sessions`, `messages`, `media`, `orchestration_runs`, `quizzes`,
`quiz_questions`, `quiz_attempts` (+ a storage bucket for media).

## Deploy

Vercel (Python). `api/index.py` is the entry; `vercel.json` rewrites all paths to it with
`maxDuration: 60`. See [../DEPLOYMENT.md](../DEPLOYMENT.md) for env vars and the full guide.
