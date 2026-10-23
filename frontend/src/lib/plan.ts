// The user's plan (free / pro) and the Pro Early Access introduction.
//
// Aeva is free today and everyone gets the Pro experience. This module is
// the ONE place the frontend reads plan state from, so that Free vs Pro
// limits, paid subscriptions and billing can be added later by extending
// `hasProAccess` / `planLabel` rather than touching feature code.
//
// It also owns the "when do we introduce Pro?" decision. The popup never
// shows right after login: the user first reaches a value moment. Features
// report those with `noteProValueMoment(kind)` (a chat answer, a finished
// quiz, a studied deck, an indexed upload, an exam plan); once enough points
// accumulate for the signed-in user on this device, the host
// (`components/pro/ProAccessHost.tsx`) opens the introduction at a quiet
// moment. Whether it has already been shown lives on the profile
// (`pro_prompt_shown`), so a dismissal on one device holds on every device.
//
// Everything is SSR-safe: nothing touches `window` at import time.

import type { ProValueMoment } from "@/lib/analytics";
import type {
  Plan,
  PlanCatalogEntry,
  PlanCurrency,
  PlanPrice,
  PlanStatus,
  User,
} from "@/types";

/** The value moments features report; the same set `PRO_INTRO_SHOWN` sends. */
export type ProValueMomentKind = ProValueMoment;

/** Points each value moment is worth. A major feature reaches the
 *  threshold on its own; chat answers add up over three turns. */
const VALUE_POINTS: Record<ProValueMomentKind, number> = {
  chat_response: 1,
  quiz_completed: 3,
  flashcards_studied: 3,
  upload_indexed: 3,
  exam_plan_created: 3,
};

/** Points needed before the Pro introduction may open. */
export const PRO_PROMPT_THRESHOLD = 3;

// localStorage, per user: accumulated value points on this device.
const POINTS_KEY = "aeva_pro_value_points";

type PlanFields = Pick<
  User,
  "plan" | "plan_status" | "pro_activated_at" | "pro_prompt_shown" | "currency"
>;

/* ------------------------------- plan state ------------------------------- */

export function planOf(user: PlanFields | null | undefined): Plan {
  return user?.plan === "pro" ? "pro" : "free";
}

export function planStatusOf(
  user: PlanFields | null | undefined,
): PlanStatus {
  return user?.plan_status ?? "none";
}

const ACTIVE_STATUSES: ReadonlySet<PlanStatus> = new Set([
  "early_access",
  "active",
  "past_due",
]);

/** Whether the user is on Pro with a live status. Nothing is gated during
 *  Early Access, so no feature checks this yet; it exists so the first
 *  limit added later has one switch to flip. */
export function hasProAccess(user: PlanFields | null | undefined): boolean {
  return planOf(user) === "pro" && ACTIVE_STATUSES.has(planStatusOf(user));
}

/** Whether the user is on Pro at ₹0 — the "✨ Pro · Early Access" state. */
export function isProEarlyAccess(
  user: PlanFields | null | undefined,
): boolean {
  return planOf(user) === "pro" && planStatusOf(user) === "early_access";
}

/** Short status for profile / account surfaces, or null while on free. */
export function planLabel(user: PlanFields | null | undefined): string | null {
  if (planOf(user) !== "pro") return null;
  return planStatusOf(user) === "early_access" ? "Pro · Early Access" : "Pro";
}

/* --------------------------------- prices --------------------------------- */

/** Fallback for a frontend deployed ahead of the backend (`/config.plans`).
 *  Mirrors the backend catalog in `aeva/plan/plan_service.py`. */
export const PRO_PLAN_FALLBACK: PlanCatalogEntry = {
  key: "pro",
  label: "Aeva Pro",
  prices: [
    { interval: "month", amount: 99, currency: "INR" },
    { interval: "year", amount: 799, currency: "INR" },
    { interval: "month", amount: 4.99, currency: "USD" },
    { interval: "year", amount: 39, currency: "USD" },
  ],
  current_amount: 0,
  early_access: true,
};

export function proPlan(
  plans: PlanCatalogEntry[] | undefined,
): PlanCatalogEntry {
  return plans?.find((p) => p.key === "pro") ?? PRO_PLAN_FALLBACK;
}

/* -------------------------------- currency -------------------------------- */

const INDIA_TIMEZONES: ReadonlySet<string> = new Set([
  "Asia/Kolkata",
  "Asia/Calcutta",
]);

/**
 * Whether this device looks like it is in India: the browser's locale region
 * or its timezone. Device signals only, never the account's language or the
 * app's interface language (a Hindi-speaking student abroad pays in USD).
 */
export function deviceIsInIndia(): boolean {
  if (typeof navigator === "undefined") return true;
  try {
    const langs = navigator.languages?.length
      ? navigator.languages
      : [navigator.language];
    for (const lang of langs) {
      const region = new Intl.Locale(lang).region;
      if (region === "IN") return true;
    }
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && INDIA_TIMEZONES.has(tz)) return true;
  } catch {
    /* ignore: an odd locale string falls through to the default */
  }
  return false;
}

/**
 * The currency to quote: what the profile remembers once Pro is activated
 * (so the price never changes under the user), else the device's region.
 * INR for India, USD for everyone else.
 */
export function currencyFor(
  user: PlanFields | null | undefined,
  inIndia: boolean = deviceIsInIndia(),
): PlanCurrency {
  if (user?.currency === "INR" || user?.currency === "USD") {
    return user.currency;
  }
  return inIndia ? "INR" : "USD";
}

/** One plan's prices in one currency, monthly first. */
export function pricesFor(
  plan: PlanCatalogEntry,
  currency: PlanCurrency,
): { monthly?: PlanPrice; yearly?: PlanPrice } {
  const own = plan.prices.filter((p) => p.currency === currency);
  return {
    monthly: own.find((p) => p.interval === "month"),
    yearly: own.find((p) => p.interval === "year"),
  };
}

/** `₹99`, `₹799`, `$4.99`, `$39`, `₹0`, `$0`. Whole amounts drop decimals. */
export function formatPrice(amount: number, currency: PlanCurrency): string {
  const whole = Number.isInteger(amount);
  try {
    return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    }).format(amount);
  } catch {
    const symbol = currency === "INR" ? "₹" : "$";
    return `${symbol}${whole ? amount : amount.toFixed(2)}`;
  }
}

/* ------------------------------ value moments ----------------------------- */

type Listener = () => void;
const listeners = new Set<Listener>();
let currentUserId: string | null = null;
// Per page load. Points persist across visits (localStorage), but the
// introduction must follow a value moment the user just had: a counter that
// crossed the threshold while the popup was blocked must not open it 2 s
// into the next app boot, on whatever page they land on.
let momentsThisLoad = 0;
let lastMoment: ProValueMomentKind | null = null;
// Set the moment the introduction opens, so a failed "prompt shown" write
// can never re-arm it in the same visit (the server flag covers later ones).
let shownThisLoad = false;

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function readPoints(): Record<string, number> {
  if (!isBrowser()) return {};
  try {
    const raw = localStorage.getItem(POINTS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, number>)
      : {};
  } catch {
    return {};
  }
}

function writePoints(points: Record<string, number>): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(POINTS_KEY, JSON.stringify(points));
  } catch {
    /* storage unavailable — the prompt simply waits for a later visit */
  }
}

function emit(): void {
  listeners.forEach((l) => l());
}

/** Told by the host which user is signed in (null when nobody is). */
export function setProPromptUser(userId: string | null): void {
  if (currentUserId === userId) return;
  currentUserId = userId;
  emit();
}

/** Value points the signed-in user has accumulated on this device. */
export function getProValuePoints(): number {
  if (!currentUserId) return 0;
  return readPoints()[currentUserId] ?? 0;
}

/**
 * A feature just delivered value. Called from the same places the matching
 * analytics event fires; it never throws and is a no-op while signed out.
 */
export function noteProValueMoment(kind: ProValueMomentKind): void {
  if (!currentUserId || !isBrowser()) return;
  momentsThisLoad += 1;
  lastMoment = kind;
  const points = readPoints();
  const next = (points[currentUserId] ?? 0) + VALUE_POINTS[kind];
  if (next === points[currentUserId]) return;
  writePoints({ ...points, [currentUserId]: next });
  emit();
}

/** The most recent value moment in this page load (for analytics). */
export function getLastProValueMoment(): ProValueMomentKind | null {
  return lastMoment;
}

/** The host calls this as the introduction opens: never again this load. */
export function markProPromptShownThisLoad(): void {
  shownThisLoad = true;
}

/** Forget the counter once the introduction has been shown. */
export function clearProValuePoints(): void {
  if (!currentUserId) return;
  const points = readPoints();
  if (!(currentUserId in points)) return;
  delete points[currentUserId];
  writePoints(points);
  emit();
}

export function subscribeProValuePoints(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/* -------------------------------- decision -------------------------------- */

/** Why the introduction may not open right now. */
export type ProPromptBlockReason =
  | "server"
  | "signed_out"
  | "already_shown"
  | "already_pro"
  | "not_enough_value"
  | "other_popup_open"
  | "user_busy";

export type ProPromptDecision =
  | { ok: true }
  | { ok: false; reason: ProPromptBlockReason };

/** Blocks that no later retry in this page visit can clear. */
export const PRO_PROMPT_PERMANENT_BLOCKS: ReadonlySet<ProPromptBlockReason> =
  new Set(["server", "already_shown", "already_pro"]);

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return (el as HTMLElement).isContentEditable === true;
}

/** Any Radix / vaul dialog, sheet, drawer or popover currently open. */
function otherPopupOpen(): boolean {
  return (
    document.querySelector(
      '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
    ) !== null
  );
}

/** Tab hidden, typing, or selecting text: not the moment to interrupt. */
function userBusy(): boolean {
  if (document.visibilityState !== "visible") return true;
  if (isEditable(document.activeElement)) return true;
  try {
    if ((window.getSelection()?.toString() ?? "").length > 0) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/** The single eligibility check the host runs before opening. */
export function shouldShowProPrompt(
  user: (PlanFields & { id: string }) | null | undefined,
): ProPromptDecision {
  if (!isBrowser()) return { ok: false, reason: "server" };
  if (!user) return { ok: false, reason: "signed_out" };
  if (user.pro_prompt_shown || shownThisLoad) {
    return { ok: false, reason: "already_shown" };
  }
  if (planOf(user) === "pro") return { ok: false, reason: "already_pro" };
  if (momentsThisLoad === 0 || getProValuePoints() < PRO_PROMPT_THRESHOLD) {
    return { ok: false, reason: "not_enough_value" };
  }
  if (otherPopupOpen()) return { ok: false, reason: "other_popup_open" };
  if (userBusy()) return { ok: false, reason: "user_busy" };
  return { ok: true };
}
