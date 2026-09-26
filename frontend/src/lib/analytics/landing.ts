// Per-visit state for the public marketing pages (landing, features, about…).
//
// `useLandingAnalytics` (hooks/useLandingAnalytics.ts) owns the visit: it
// starts one on mount, feeds scroll / section / CTA / activity signals into
// it and emits a single `LANDING_EXIT` summary when the visitor leaves. The
// landing components (Google CTA, FAQ, hero demo) and the auth flow call the
// small `note*` helpers below so the summary can answer "how far did they
// get, what did they touch, and did they try to sign in?" without those
// components knowing about the hook. Every helper is a no-op when no visit
// is active (e.g. the signed-in app).

export type LandingLoginOutcome =
  | "none"
  | "started"
  | "abandoned"
  | "failed"
  | "succeeded";

export interface LandingVisit {
  page: string;
  /** performance.now() at entry. */
  enteredAt: number;
  maxScrollPct: number;
  sectionsViewed: string[];
  ctaViewed: string[];
  ctaClicks: number;
  faqOpens: number;
  demoInteractions: number;
  exitIntent: boolean;
  loginOutcome: LandingLoginOutcome;
  /** Milliseconds the tab was visible with recent input. */
  activeMs: number;
  /** Number of LANDING_EXIT events already sent for this visit. */
  exits: number;
}

let current: LandingVisit | null = null;

export function beginLandingVisit(page: string): LandingVisit {
  current = {
    page,
    enteredAt: performance.now(),
    maxScrollPct: 0,
    sectionsViewed: [],
    ctaViewed: [],
    ctaClicks: 0,
    faqOpens: 0,
    demoInteractions: 0,
    exitIntent: false,
    loginOutcome: "none",
    activeMs: 0,
    exits: 0,
  };
  return current;
}

export function endLandingVisit(): void {
  current = null;
}

export function landingVisit(): LandingVisit | null {
  return current;
}

/** Seconds since the visitor entered the current public page (0 if none). */
export function landingElapsedS(): number {
  return current ? Math.round((performance.now() - current.enteredAt) / 1000) : 0;
}

/** Deepest scroll position reached so far on the current public page. */
export function landingScrollPct(): number {
  return current?.maxScrollPct ?? 0;
}

export function noteLandingCtaClick(): void {
  if (current) current.ctaClicks += 1;
}

export function noteLandingFaqOpen(): void {
  if (current) current.faqOpens += 1;
}

export function noteLandingDemo(): void {
  if (current) current.demoInteractions += 1;
}

export function noteLandingLogin(outcome: LandingLoginOutcome): void {
  if (!current) return;
  // Never downgrade a success; otherwise the latest outcome wins.
  if (current.loginOutcome === "succeeded") return;
  current.loginOutcome = outcome;
}
