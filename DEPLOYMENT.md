# Deploying StudyAssistant to Vercel

This repo holds **two apps** deployed as **two separate Vercel projects** from the same
git repo, each with its own **Root Directory**:

| App      | Root Directory | Framework        |
|----------|----------------|------------------|
| Backend  | `backend_v2`   | Python (Flask)   |
| Frontend | `frontend`     | Vite             |

Config files are already in place:
`backend_v2/{api/index.py, vercel.json, .vercelignore}` and `frontend/vercel.json`.

---

## 1. Backend (project root = `backend_v2`)

Vercel auto-detects `api/index.py` as a Python function and installs `requirements.txt`;
`vercel.json` rewrites all paths to it (Flask routes internally) with `maxDuration: 60`.

**Environment variables** (Project → Settings → Environment Variables):

| Variable | Required | Notes |
|---|---|---|
| `SUPABASE_URL` | ✅ | `https://<ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase service role key |
| `SUPABASE_JWT_SECRET` | ✅ | Supabase JWT secret (Auth settings) |
| `GEMINI_API_KEY` | ✅ | Google AI Studio key |
| `SUPABASE_STORAGE_BUCKET` | ▫ | default `media` (use your bucket name) |
| `FRONTEND_URL` | ✅ | the **frontend** URL (set after FE deploy) |
| `ALLOWED_ORIGINS` | ✅ | the **frontend** URL (comma-separated) |
| `COOKIE_SECURE` | ✅ | `true` in production (HTTPS PKCE cookie) |
| `LLM_MODEL` | ▫ | default `gemini-2.5-flash` |
| `LLM_*_PROVIDER` / `LLM_*_MODEL` | ▫ | per-capability overrides (default gemini) |
| `QUIZ_MAX_QUESTIONS` | ▫ | default `10` |
| `MAX_UPLOAD_MB` | ▫ | default `10` |

> If any of the three required Supabase/Gemini vars are missing the app fails to boot
> (by design — see `aeva/app.py:load_env_vars`).

## 2. Frontend (project root = `frontend`)

Vite build → `dist`; `vercel.json` rewrites all routes to `index.html` so deep links
(`/chat`, `/auth/callback`) survive a refresh.

**Environment variables:**

| Variable | Required | Notes |
|---|---|---|
| `VITE_API_BASE_URL` | ✅ | the **backend** URL (build-time inlined) |
| `VITE_MAX_UPLOAD_FILES` | ▫ | default `10` |
| `VITE_MAX_SELECTED_FILES` | ▫ | default `5` |
| `VITE_API_TIMEOUT` | ▫ | default `30000` |

## 3. Supabase

- **Auth → Providers → Google**: enable, set client id/secret.
- **Auth → URL Configuration → Redirect URLs**: add `https://<backend-url>/auth/callback`.
- **Storage**: ensure the bucket from `SUPABASE_STORAGE_BUCKET` exists.
- Run the SQL in `backend_v2/supabase/migrations/` (in order) if not already applied.

## 4. Deploy order (avoids the chicken-and-egg on URLs)

1. **Deploy the backend** → note its URL, e.g. `https://studyassistant-api.vercel.app`.
2. Add `https://studyassistant-api.vercel.app/auth/callback` to Supabase **Redirect URLs**.
3. **Deploy the frontend** with `VITE_API_BASE_URL=https://studyassistant-api.vercel.app`
   → note its URL, e.g. `https://studyassistant.vercel.app`.
4. Back on the **backend** project, set `FRONTEND_URL` + `ALLOWED_ORIGINS` to the frontend
   URL and `COOKIE_SECURE=true`, then **redeploy**.
5. Open the frontend, click **Sign in** → Google popup → lands on `/chat`.

## 5. Caveats on Vercel

- **SSE streaming**: Vercel serverless can buffer responses, so token-by-token streaming may
  arrive in larger bursts. The app still works correctly. If real-time token streaming is a
  hard requirement, host the backend on an always-on platform (Render / Railway / Fly.io)
  instead — the frontend only needs `VITE_API_BASE_URL` pointed at it.
- **`maxDuration: 60`** covers most LLM calls; it requires a plan that permits 60s functions
  (Pro recommended). Lower it if your plan caps function duration.
- **Cold starts**: the first request after idle is slower while the function spins up.
