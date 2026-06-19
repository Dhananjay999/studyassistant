# Aeva Backend v2

Flask + flask-smorest study assistant API backed by Supabase.

## Setup

1. Copy `.env.sample` to `.env` and fill in values
2. Run Supabase migrations in `supabase/migrations/`
3. Install dependencies:

```bash
poetry install
```

4. Run the server:

```bash
poetry run poe run
# or
poetry run flask --app aeva.app run --debug --port 8000
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/auth/login/google` | Start Google OAuth (redirects browser) |
| GET | `/auth/callback` | OAuth callback; redirects to frontend with token |
| POST | `/auth/refresh` | Refresh access token from refresh token |
| GET | `/auth/me` | Current user profile |
| PUT | `/auth/me` | Upsert profile |
| GET | `/sessions/` | List chat sessions |
| POST | `/sessions/` | Create session |
| PATCH | `/sessions/{id}` | Update session |
| DELETE | `/sessions/{id}` | Delete session |
| GET | `/sessions/{id}/messages` | Get messages |
| POST | `/media/` | Upload media |
| GET | `/media/` | List media |
| DELETE | `/media/{id}` | Delete media |
| POST | `/chat/` | Send message |
| POST | `/chat/stream` | Stream response (SSE) |

All endpoints except `/health` and the `/auth/login/google`, `/auth/callback`,
`/auth/refresh` routes require `Authorization: Bearer <supabase_jwt>`.

## Google login setup

Login is fully backend-driven, so the frontend needs no Supabase keys.

1. In Supabase: Authentication -> Providers -> enable Google (set Google client
   id/secret).
2. In Supabase: Authentication -> URL Configuration -> add the backend callback
   to "Redirect URLs": `http://localhost:8000/auth/callback` (and your prod URL).
3. Set `FRONTEND_URL` so the backend knows where to send the user after login.

Flow: FE opens `/auth/login/google` -> backend redirects to Google via Supabase
(PKCE) -> Supabase calls `/auth/callback` -> backend exchanges the code and
redirects to `FRONTEND_URL/auth/callback#access_token=...&refresh_token=...`.

## Environment Variables

See `.env.sample` for all required variables.

## Linting

```bash
poetry run poe lint-check
poetry run poe type-check
```
