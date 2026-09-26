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
  → name validated (UPPER_SNAKE_CASE, ≤ 40 chars)
  → props sanitized (sanitize.ts)
  → session ensured (session.ts) — may emit session_ended / session_started first
  → enriched: identity, session, page, device, campaign, app context
  → debug log (debug mode only)
  → outbox (outbox.ts): buffered + mirrored to localStorage; drained later
  → per provider: delivered, or queued until that provider is ready
```

`track()` returns after the enrich step — a few property reads and one
coalesced localStorage write. Nothing provider-side (PostHog property
calculation, persistence, network) runs inside the user's interaction; see
[Delivery and reliability](#delivery-and-reliability).

Providers implement `providers/provider.ts` and are registered in
`providers/index.ts`. Today: PostHog. Adding GA4 or a custom store means one
adapter + one line in the registry + its env var in `config.ts`.

## Identity and sessions

- **Device id** (`aeva_device_id` in localStorage, mirrored in the
  `aeva_did` cookie for a year, `dev_<uuid>`) is created once per browser
  profile and never rotated: not on logout, not on login. It rides on every
  event as `device_id`, is a person property, and is pinned as PostHog's
  `$device_id`. Either store surviving is enough to keep it. This is the
  "same device, whoever is signed in" key; no fingerprinting is used.
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
  are throttled to 5 s and flushed on `pagehide`/hidden. `SESSION_ENDED` is
  emitted lazily by the next page load/tab that finds the previous session
  expired (with duration, event count and last page); logout ends it
  immediately with `reason: "logout"`. Tabs share the session via the
  `storage` event.
- PostHog's own `$session_id` is forwarded as `posthog_session_id` so a
  session replay can be found from any event.

## Clicks and popups

Every press on a button, link, menu item, tab, switch or checkbox emits its
own event, named after the element: `NEW_CHAT_CLICK`, `LOG_OUT_CLICK`,
`SIDEBAR_NAV_CHAT_CLICK` (delegated listener in `clicks.ts`, no per-button
wiring). The name is the explicit `data-analytics-id`, else the label
(`data-analytics-name` → `aria-label` → `title` → visible text). Wrap lists
of user content in `data-analytics-private` (chat titles, file names, quiz
answers…) so rows there become `<SECTION>_ITEM_CLICK` with the label masked;
add `data-analytics-name` to buttons inside such a zone that deserve their
own name, and `data-analytics-section` to give them a location.
`data-analytics-ignore` opts an element out. All click events carry
`event_group: "click"`, so "all clicks" is a filter on that property.

Every shared popup primitive (`components/ui/dialog`, `alert-dialog`,
`sheet`, `drawer`, `popover`, `dropdown-menu`, `responsive-modal`, and the
command palette) emits `<NAME>_<KIND>_OPENED` / `<NAME>_<KIND>_CLOSED`
(`QUIZ_DASHBOARD_DIALOG_OPENED`, `LOG_OUT_MODAL_CLOSED`,
`BOOKMARK_POPOVER_OPENED`) from `hooks/usePopupAnalytics.tsx`. The name is
the Root's `analyticsName` prop, else the Title text, else the trigger's
label (popovers, menus); pass `analyticsName` when a title contains user
content. `via` says how it closed: `escape`, `outside` (overlay / outside
click), `dismiss` (close button or code) or `unmount`. They carry
`event_group: "popup_opened" | "popup_closed"`.

Dynamic names go through `clickEventName()` / `popupEventName()` in
`events.ts` (UPPER_SNAKE, ≤ 40 chars) and the same sanitize/enrich pipeline
as typed events via `analytics.trackNamed()`.

## Landing page engagement

`useLandingAnalytics(page)` (mounted on the landing page and every public
page) answers "what did visitors do before signing in, and where did the
ones who didn't get stuck?". It emits `LANDING_VIEWED`, scroll-depth
milestones, one `LANDING_SECTION_VIEWED` per section that scrolls into view
(mark sections with `data-landing-section="<name>"`), one
`LANDING_CTA_VIEWED` per sign-in button that becomes visible (impression;
the Google button carries `data-cta-location`), `LANDING_EXIT_INTENT`, and a
single `LANDING_EXIT` summary on leave with scroll reach, sections and CTAs
seen, clicks, FAQ/demo use, active vs total time and the login outcome.
Components report into the visit through `lib/analytics/landing.ts`
(`noteLandingCtaClick`, `noteLandingFaqOpen`, `noteLandingDemo`,
`noteLandingLogin`), which are no-ops outside public pages.

## Page lifecycle

`useAnalyticsRouteTracker` (mounted in `App.tsx`) emits `PAGE_EXIT` for the
page being left (`time_on_page_s`) and `PAGE_ENTRY` for the new one, keyed on
pathname only. A hidden tab / `pagehide` emits one `PAGE_EXIT` with
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
  are copied onto `PAGE_ENTRY` as `qp_*`.
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
`session`, `anonymousId`, `deviceId`, `ready`, `pending` (events waiting in
the outbox) and `flush()`.

## Delivery and reliability

Two guarantees, in this order: the user never waits on analytics, and no
event is lost.

**Batched, off the interaction.** `track()` only enriches the event and
appends it to the outbox (`outbox.ts`). The outbox hands batches to the
providers in a browser idle slot (`requestIdleCallback`, bounded), never
inside a click / keypress / scroll handler:

| Trigger | When the batch goes out |
|---|---|
| 20 events pending | next idle slot, at most 250 ms later |
| 5 s since the first pending event | next idle slot, at most 1 s later |
| tab hidden, `pagehide`, `freeze`, `analytics.flush()`, `identify`, logout | immediately, **urgent** |
| an event tracked while the tab is already hidden | immediately, urgent |

PostHog receives a normal batch through posthog-js's own request queue
(fetch keepalive, retried on failure). An **urgent** batch bypasses that
queue: each event is sent at once with `sendBeacon`, which the browser
completes even after the page is gone. `identify` and `reset` drain the
outbox first so provider-side ordering matches ours (pre-login events stay
on the anonymous trail; the last events before logout stay on the user).

**Nothing lost.** Pending events are mirrored to localStorage as they
arrive (one write per task, under a per-page-load key
`aeva_analytics_outbox:<id>`), and cleared only once a provider has taken
them. While every provider is still loading, batches are held there rather
than in memory. A tab that dies before draining (crash, OS kill) leaves its
key behind; the next page load replays any key older than 60 s with the
original timestamps. Every payload carries a uuid (`TrackPayload.id`,
PostHog's event `uuid`), so a rare double delivery can be de-duplicated
rather than a loss accepted. Bounds: 200 pending per tab (oldest dropped,
counted in `__aeva_analytics`), 500 ops in the per-provider pre-init queue.

Every public method is wrapped: analytics never throws into the app, never
blocks rendering (PostHog is a dynamic import), and is a no-op during SSR /
prerender. A provider that throws in `init` is disabled; per-call throws are
swallowed (and logged in debug). If every provider is disabled (e.g. an ad
blocker), the outbox drops its events instead of growing.

Rules for contributors: never call a provider or do network work from
`track()`'s path; never bypass the outbox; call `analytics.flush()` before a
deliberate navigation away (redirect login, `window.location` changes).

## Adding an event

1. Add the enum member to `events.ts` (wire name = member name, `<DOMAIN>_<OBJECT>_<PAST_TENSE>`).
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
