# StudyAssistant (Aeva) — rules for Claude

Layout: `frontend/` is Vite + React + TypeScript + Tailwind + shadcn/Radix.
`backend_v2/` is Python (`aeva/` package) on Supabase Postgres, with SQL
migrations in `backend_v2/supabase/migrations/`.

These five rules apply to every change in this repo. Before handing work back,
say in the summary how each relevant rule was checked, and say plainly if one
could not be checked.

## Shared Claude setup

- `.mcp.json` connects Supabase, Sentry, PostHog and Vercel. On a new machine,
  run `/mcp` once and sign in to each server.
- `.claude/skills/product-intelligence/` is the `/product-intelligence` command:
  a read-only, multi-agent product analysis (code, PostHog, Sentry, Supabase,
  AI traces) that ends in a prioritized report. It runs its agents in the
  foreground, defaults to the last 30 days, and never changes anything.

## 1. Never break what already works

A new feature or fix must not change the behaviour, layout or feel of any
existing feature, unless that change was asked for.

- Before editing shared code (a component in `frontend/src/components/ui/`, a
  hook, `lib/api.ts`, `index.css`, `tailwind.config.ts`, a backend service or
  repository), find every place that uses it and confirm each one still behaves
  the same.
- Prefer adding over modifying: a new prop with a default that keeps the old
  behaviour, a new function, a new module. Keep the diff to existing files as
  small as possible, and do not refactor or restyle code the task did not need.
- Cross-cutting backend logic (tracing, debugging, instrumentation) goes in its
  own service module, such as `backend_v2/aeva/tracing/services/`. The main flow
  files (orchestrator, agent runner, tools, retrieval, LLM client, prompts) gain
  only an import and short calls to it.
- Do not change existing API response shapes, route paths, DB column meanings,
  localStorage keys or analytics event names. Add new ones instead.
- Global style changes (CSS variables, base styles, Tailwind theme) affect every
  screen. Scope styles to the new feature unless a global change was requested.
- After the change, check the screens and flows next to the one you touched,
  not only the new feature. Run `npm run build` in `frontend/` and the backend
  tests in `backend_v2/tests/` for the areas affected.

## 2. Mobile comes first (about 90% of users are on phones)

Design and build for a phone first, then make sure desktop still works.

- Check every UI change at 360px wide, and at 320px for overflow, with touch
  emulation on. Do this as a separate pass after the feature works on desktop.
- Nothing may scroll the page sideways. Long text, tables, toolbars and action
  rows must wrap, truncate or scroll inside their own container.
- Touch targets are at least 44×44px with enough space between them.
- Never hide a control behind hover alone. Use the `mouse:` and `touch:`
  variants from `frontend/tailwind.config.ts` (for example
  `mouse:opacity-0 group-hover:opacity-100`), so the control stays visible on
  touch devices.
- Check with the on-screen keyboard open: inputs stay visible, and fixed footers
  and bottom sheets are not covered. Respect safe-area insets on notched phones.
- Dialogs and menus must fit a phone screen. Prefer a bottom sheet or a
  full-screen view over a wide desktop modal.
- Keep it light for mobile networks: lazy-load heavy pages and libraries, and
  avoid large images or bundles on the first screen.

## 3. Keep analytics in step with the product

Every feature that is added, changed or removed gets an analytics check.

- All tracking goes through `@/lib/analytics`. Read `README.md` and `EVENTS.md`
  in `frontend/src/lib/analytics/` before adding events.
- Adding a feature: add events for the actions that matter (opened, started,
  completed, failed), following the "Adding an event" steps in that README:
  enum member in `events.ts`, props type in `EventPropsMap`, the
  `analytics.track(...)` call, and a row in `EVENTS.md` in the same change.
  Use `analyticsAttrs(...)` for plain clicks.
- Changing a feature: check that existing events still fire at the right moment
  with the right props. Do not rename an event or change what a prop means,
  because that breaks existing dashboards and funnels. Add a new event or prop.
- Removing a feature: remove its tracking calls, mark the events as retired in
  `EVENTS.md`, and list the PostHog insights and dashboards that depended on
  them.
- Props carry lengths, counts and ids only. Never send message text, note
  content, file names, emails or other personal data (see "Privacy rules").
- Dashboards: when a feature needs one, create or update the PostHog insight or
  dashboard through the PostHog MCP without asking first, and report what was
  created with its link. Ask before deleting or overwriting an existing
  dashboard or insight.

## 4. Database changes must hold up at millions of users

Treat every schema or query change as if the tables already had millions of
rows and thousands of concurrent users.

- Schema changes go in a new numbered file in
  `backend_v2/supabase/migrations/` (next number after the latest, such as
  `027_<name>.sql`). Never edit a migration that has already been applied.
- Every new query needs an index that serves its `WHERE`, `JOIN` and `ORDER BY`
  columns. Index every foreign key and every column used in a Row-Level Security
  policy. Do not add indexes nothing uses, because each one slows writes.
- No unbounded reads. List endpoints paginate (keyset pagination for large or
  growing tables, not a deep `OFFSET`), select only the columns they need, and
  never load a whole table to filter or count in Python.
- No N+1 queries: fetch related rows in one query or a batch, not inside a loop.
- Migrations must be safe on a large live table: no long table locks, no full
  table rewrites, `CREATE INDEX CONCURRENTLY` for indexes on existing tables,
  backfills in batches, and new `NOT NULL` columns added in steps (add nullable,
  backfill, then constrain).
- Keep RLS policies simple and index-backed. A policy with a subquery runs for
  every row.
- For any new or changed query on a large table, run `EXPLAIN (ANALYZE)` and
  confirm it uses an index rather than a sequential scan. Run the Supabase
  performance and security advisors after a schema change and fix what they
  report.
- Write heavy or growing data (traces, logs, events) with a retention or
  partitioning plan, and say what that plan is.
- State the expected row growth and the query plan in the summary of the change.

## 5. Use animation where it helps the user

The interface should feel alive and polished, without motion for its own sake.

- Animate when it explains something: an element entering or leaving, a state
  change (loading to loaded, collapsed to expanded, success or error), a
  response to a tap, a list reordering, a page or sheet transition.
- Do not animate things that loop for decoration, delay the user, move content
  the user is reading, or play on every re-render.
- Keep it quick: about 150–250ms for small interactions and up to about 400ms
  for sheets and page transitions, with ease-out for entering and ease-in for
  leaving.
- Animate only `transform` and `opacity`, so it stays smooth on low-end phones.
  Avoid animating `width`, `height`, `top`, `left` or box shadows on large areas.
- Use what the project already has: `framer-motion` (`motion`,
  `AnimatePresence`) for component motion, and the Tailwind and `index.css`
  keyframes for simple cases. Match the timing and feel of nearby screens.
- Respect reduced motion. `index.css` already disables CSS animation under
  `prefers-reduced-motion`; with `framer-motion`, use `useReducedMotion()` and
  fall back to a plain fade or no motion.
- Check the animation on a 360px touch viewport. It must not cause layout shift,
  jank or horizontal scroll.
