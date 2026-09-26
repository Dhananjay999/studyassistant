# Analytics SDK

All product analytics in StudyAssistant go through this folder. Application
code never calls PostHog (or any other vendor) directly.

```ts
import { analytics, AnalyticsEvent, analyticsAttrs } from "@/lib/analytics";

analytics.track(AnalyticsEvent.CHAT_MESSAGE_SENT, { message_length: 42, … });
analytics.identify(user);   // AuthContext does this after login / boot restore
analytics.reset();          // AuthContext does this on logout

// Generic click tracking for UI chrome (no semantic event needed):
<Button {...analyticsAttrs("sidebar.new_chat", "New chat", "sidebar")} />
```

The event catalogue lives in [`EVENTS.md`](./EVENTS.md); the typed source of
truth is [`events.ts`](./events.ts).

## How an event flows

```
track(event, props)
  → name validated (lowercase snake_case, ≤ 40 chars)
  → props sanitized (sanitize.ts)
  → session ensured (session.ts) — may emit session_ended / session_started first
  → enriched: identity, session, page, device, campaign, app context
  → debug log (debug mode only)
  → per provider: delivered, or queued (≤ 100) until that provider is ready
```

Providers implement `providers/provider.ts` and are registered in
`providers/index.ts`. Today: PostHog. Adding GA4 or a custom store means one
adapter + one line in the registry + its env var in `config.ts`.

## Identity and sessions

- **Anonymous id** (`aeva_anonymous_id`, `anon_<uuid>`) is created on first
  use and handed to PostHog as its bootstrap distinct id. `identify(user)`
  therefore merges the pre-login trail into the person. `reset()` mints a new
  anonymous id (and PostHog `reset()`), so nothing after logout is attributed
  to the previous user.
- **Person traits** sent on identify: `email`, `name`, `personalization_status`,
  `is_debug_user`, `is_app_mode`, `app_env`. They never ride on events. Use
  `is_debug_user` in PostHog's test-account filter.
- **Analytics session** (`aeva_analytics_session`, `sess_<uuid>`): new when
  none is stored, after 30 min of inactivity, or after 24 h. `session_number`
  increments per session on the browser profile. Activity is bumped by every
  tracked event and by throttled pointer/key/scroll listeners; storage writes
  are throttled to 5 s and flushed on `pagehide`/hidden. `session_ended` is
  emitted lazily by the next page load/tab that finds the previous session
  expired (with duration, event count and last page); logout ends it
  immediately with `reason: "logout"`. Tabs share the session via the
  `storage` event.
- PostHog's own `$session_id` is forwarded as `posthog_session_id` so a
  session replay can be found from any event.

## Page lifecycle

`useAnalyticsRouteTracker` (mounted in `App.tsx`) emits `page_exit` for the
page being left (`time_on_page_s`) and `page_entry` for the new one, keyed on
pathname only. A hidden tab / `pagehide` emits one `page_exit` with
`exit_type: "hidden"`; returning resets the timer without a new entry. The
PostHog adapter maps these to `$pageview` / `$pageleave` so Web Analytics and
replay keep working with PostHog's automatic pageviews disabled.

`page_name` comes from `routeName.ts` (`/bookmarks/:id` → `bookmark_detail`).
Keep it in sync with `App.tsx` routes.

## Privacy rules

- Never send message text, search text, filenames, transcripts, note bodies,
  quiz question or answer text, tokens or cookies. Send lengths, counts, ids,
  booleans, enums and durations.
- `sanitize.ts` enforces this at runtime: keys that look sensitive
  (`token|password|email|content|message|text|query|prompt|answer|question|…`)
  are dropped unless suffixed `_length|_count|_ms|_s|_id|_index|_kind|_type|
  _types|_number|_used|_total|_key|_mode` or prefixed `has_|is_`; strings that
  look like JWTs, emails or bearer tokens become `[redacted]`; strings are
  capped at 200 chars, ≤ 40 props, one level of nesting.
- Event props can never overwrite context keys (`session_id`, `page_path`,
  `utm_*`, …).
- Query strings are not sent; only `sessionId/quizId/setId/fileId/auth_error`
  are copied onto `page_entry` as `qp_*`.
- Error events carry `error_kind` (`offline | high_demand | generic`, from
  `lib/errorMessage.ts`), never the raw message.

## Configuration

| Env var | Meaning |
|---|---|
| `VITE_POSTHOG_KEY` | Project API key. Blank = PostHog provider skipped. |
| `VITE_POSTHOG_HOST` | Ingestion host (default US Cloud). |
| `VITE_ANALYTICS_ENABLED` | `"false"` disables every provider (events still log in debug). |
| `VITE_ANALYTICS_DEBUG` | `"true"`/`"false"` forces console logging; default on when `__BUILD_ENV__ !== "production"`. |
| `VITE_GA_MEASUREMENT_ID` | Reserved for the GA4 provider (not loaded yet). |

Every event carries `app_env` (`production` / `preview` / `development`),
`app_version` and `build_id`. Use one PostHog project key per environment.

Runtime debug switches: `localStorage.aeva_analytics_debug = "1"` or
`window.__aeva_analytics.debug = true`. `window.__aeva_analytics` also exposes
`session`, `anonymousId` and `ready`.

## Reliability

Every public method is wrapped: analytics never throws into the app, never
blocks rendering (PostHog is a dynamic import), and is a no-op during SSR /
prerender. A provider that throws in `init` is disabled; per-call throws are
swallowed (and logged in debug). posthog-js flushes its batch with
`sendBeacon` on `pagehide`.

## Adding an event

1. Add the enum member to `events.ts` (wire name `<domain>_<object>_<past tense>`).
2. Add its props type to `EventPropsMap` (lengths/counts/ids only).
3. Call `analytics.track(AnalyticsEvent.X, {...})` at the hook point.
4. Add a row to `EVENTS.md` in the same PR.

## Adding a provider

1. Implement `AnalyticsProvider` in `providers/<name>.ts` (`init`, `identify`,
   `reset`, `track`, `isReady`, optional `flush`). Use `flatten()` from
   `flatten.ts` to get the flat property bag.
2. Register it in `providers/index.ts` behind its config key.
3. Add the key to `config.ts` and `env.example`.

Later phases (see the project plan): a GA4 adapter and a custom Supabase
`analytics_events` store with an admin session-timeline explorer.
