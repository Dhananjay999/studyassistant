# StudyAssistant — Frontend

The web app: an animated, SEO‑optimized landing page and the **Aeva** chat experience.
Built as a Vite + React SPA with an "Aurora‑glass" design system.

## Tech

Vite · React 18 · TypeScript · Tailwind CSS · shadcn/ui (Radix) · framer‑motion ·
TanStack Query · React Router · react‑helmet‑async · react‑markdown · react‑pdf ·
next‑themes · sonner · lucide‑react.

## Setup

```bash
cd frontend
cp env.example .env
npm install
npm run dev        # http://localhost:8080
```

### Environment variables (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:8000` | Backend base URL |
| `VITE_API_TIMEOUT` | `30000` | REST request timeout (ms) |
| `VITE_MAX_UPLOAD_FILES` | `10` | Max files per upload action |
| `VITE_MAX_SELECTED_FILES` | `5` | Max files selectable as context |

### Scripts

| Command | Description |
|---|---|
| `npm run dev` | Dev server (port 8080) |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Preview the production build |
| `npm run lint` | ESLint |

## Architecture

- **Data layer (no UI):** `lib/api.ts` (typed client + endpoints, `{msg,data}` unwrap),
  `hooks/api.ts` (TanStack Query hooks), `hooks/useAssistantStream.ts` (SSE: content /
  clarification / quiz_setup / done, rAF‑batched), `contexts/AuthContext.tsx` (Google
  popup login + token refresh). **All backend contracts live here** — UI never calls
  `fetch` directly.
- **Design system:** `index.css` (HSL tokens, dark‑first, `.glass`, gradients) +
  `tailwind.config.ts` (brand ramp, animations) + `components/common/*`.
- **Code‑splitting:** the whole `/chat` route and heavy deps (react‑pdf, react‑markdown)
  are lazy‑loaded, so the landing bundle stays small.
- **SEO:** static meta + JSON‑LD in `index.html`, per‑route `<Seo>` (react‑helmet‑async);
  `/chat` is `noindex`.

## Routes

| Path | Page |
|---|---|
| `/` | Landing (or redirect to `/chat` if signed in) |
| `/chat?sessionId=…` | Chat app (protected) |
| `/auth/callback` | OAuth token handler (popup → `postMessage`) |
| `*` | 404 |

## File structure

```
frontend/
├── index.html                 # SEO meta + JSON-LD, favicon, root mount
├── vercel.json                # SPA rewrite (deep links → index.html)
├── env.example
├── tailwind.config.ts         # aurora theme: brand colors, animations
├── vite.config.ts             # alias @, manual vendor chunks
└── src/
    ├── main.tsx               # fonts + render
    ├── App.tsx                # providers (Helmet, Query, Theme, Auth) + router
    ├── index.css              # design tokens + utilities (glass, gradient, scrollbar-hide)
    ├── pages/
    │   ├── LandingPage.tsx
    │   ├── ChatPage.tsx       # chat orchestration (sessions, streaming, media, quiz)
    │   ├── AuthCallback.tsx
    │   └── NotFound.tsx
    ├── components/
    │   ├── common/            # AuroraBackground, GlassCard, GradientText, Reveal,
    │   │                      #   Marquee, RotatingWords, IntroLoader, BrandLogo, Seo
    │   ├── landing/           # Navbar, Hero, Features, HowItWorks, Faq, CtaBand,
    │   │                      #   Footer, GoogleButton
    │   ├── chat/              # ChatMessages, ChatComposer, SessionSidebar, MediaSidebar,
    │   │                      #   ClarificationPanel, QuizCard, QuizDrawer, QuizSetupForm,
    │   │                      #   QuizSetupPopover, ThinkingIndicator, EmptyState
    │   ├── auth/              # SigningInModal
    │   ├── ui/                # shadcn/Radix primitives (vendored)
    │   ├── ThemeProvider.tsx · ThemeToggle.tsx · ProtectedRoute.tsx · PDFViewer.tsx
    ├── contexts/AuthContext.tsx
    ├── hooks/                 # api.ts, useAssistantStream.ts, use-mobile, use-toast
    ├── lib/                   # api.ts, config.ts, queryClient.ts, utils.ts
    ├── types/index.ts         # shared domain types
    └── utils/compress.ts      # client-side image compression
```

## Notes

- Google login opens a **popup**; a "Signing you in…" modal stays until tokens return
  (falls back to a full redirect if the popup is blocked).
- Quizzes render as a **card** in chat; clicking it opens the exam **drawer** on the right.
- Deploy: see [../DEPLOYMENT.md](../DEPLOYMENT.md). On Vercel, set the env vars above and
  point `VITE_API_BASE_URL` at the deployed backend.
