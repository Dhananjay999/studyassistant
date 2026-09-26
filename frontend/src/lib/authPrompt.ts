// Sign-in encouragement prompt for anonymous visitors on the public pages.
//
// This module is the ONE place that decides whether the prompt may open.
// Components never check conditions themselves: they call
// `requestAuthPrompt(trigger)` at a moment of intent (tapping the demo
// composer, using a members-only demo action) and get back whether it
// opened, so they can fall back to their own inline nudge when it didn't.
// The passive "stayed engaged for a while" trigger lives in
// `hooks/useDelayedAuthPrompt.ts` and goes through the same gate.
//
// The UI host (`components/auth/AuthPrompt.tsx`) subscribes to the store,
// keeps the environment (auth state, route) up to date, and renders the
// modal/sheet. Everything is SSR-safe: nothing touches `window` at import
// time and every check answers "no" on the server.
//
// Respecting the visitor is the core rule: once dismissed (X, Escape, tap
// outside, drag down, "Not now") the prompt never returns on
// this device, and it shows at most once per tab session even when several
// triggers fire in quick succession. Successful login marks the device
// "converted" so someone who logs out isn't nagged to create an account.

import { isAppMode } from "@/lib/appMode";
import type {
  AuthPromptDismissVia,
  AuthPromptTrigger,
} from "@/lib/analytics";

export type { AuthPromptDismissVia, AuthPromptTrigger };

/** Public routes where the prompt may appear (never legal or share pages). */
export const AUTH_PROMPT_ELIGIBLE_PATHS: ReadonlySet<string> = new Set([
  "/",
  "/features",
  "/about",
]);

/**
 * Active engagement (tab visible + input in the last 10 s) required before
 * the passive trigger may fire. Long enough for the hero demo (~12 s) and a
 * scroll through the features to play out, short enough that an interested
 * visitor sees it before leaving. Intent triggers ignore this delay.
 */
export const AUTH_PROMPT_DELAY_ACTIVE_MS = 30_000;

// localStorage: `{ at, via }` once dismissed/converted — permanent.
const DISMISSED_KEY = "aeva_auth_prompt_dismissed";
// sessionStorage: "1" once shown in this tab — at most one prompt per visit.
const SHOWN_KEY = "aeva_auth_prompt_shown";

/** Why `shouldShowAuthPrompt` said no. */
export type AuthPromptBlockReason =
  | "server"
  | "app_mode"
  | "auth_loading"
  | "authenticated"
  | "signing_in"
  | "page_ineligible"
  | "dismissed"
  | "already_shown"
  | "already_open"
  | "other_popup_open"
  | "user_busy";

/** Blocks that no later retry in this page visit can clear. */
export const AUTH_PROMPT_PERMANENT_BLOCKS: ReadonlySet<AuthPromptBlockReason> =
  new Set([
    "server",
    "app_mode",
    "authenticated",
    "page_ineligible",
    "dismissed",
    "already_shown",
  ]);

export type AuthPromptDecision =
  | { ok: true }
  | { ok: false; reason: AuthPromptBlockReason };

export interface AuthPromptState {
  open: boolean;
  trigger: AuthPromptTrigger | null;
  /** performance.now() when it opened (0 while closed). */
  openedAt: number;
}

interface AuthPromptEnvironment {
  authenticated: boolean;
  authLoading: boolean;
  signingIn: boolean;
  pathname: string;
}

interface DismissedRecord {
  at: string;
  via: AuthPromptDismissVia | "converted";
}

/* ------------------------------ storage ------------------------------ */

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function readLocal(key: string): string | null {
  if (!isBrowser()) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string | null): void {
  if (!isBrowser()) return;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Private mode / disabled storage: the prompt simply can't remember.
  }
}

function readSession(key: string): string | null {
  if (!isBrowser()) return null;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string | null): void {
  if (!isBrowser()) return;
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // Best-effort only; the in-memory state still prevents double opens.
  }
}

/* ------------------------------- store ------------------------------- */

const CLOSED: AuthPromptState = { open: false, trigger: null, openedAt: 0 };

let state: AuthPromptState = CLOSED;
let env: AuthPromptEnvironment = {
  authenticated: false,
  authLoading: true,
  signingIn: false,
  pathname: "/",
};
// Storage can be unavailable (private mode); mirror the flags in memory so
// "once per session" still holds for this page load.
let shownThisLoad = false;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

export function subscribeAuthPrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAuthPromptState(): AuthPromptState {
  return state;
}

export function getServerAuthPromptState(): AuthPromptState {
  return CLOSED;
}

/** Called by the host whenever auth state or the route changes. */
export function setAuthPromptEnvironment(next: AuthPromptEnvironment): void {
  env = next;
}

/* ------------------------------ decision ----------------------------- */

/** True while the visitor has already said "no" (or has an account). */
export function hasDismissedAuthPrompt(): boolean {
  return readLocal(DISMISSED_KEY) !== null;
}

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

/**
 * The visitor is mid-something a passive prompt must not interrupt: the tab
 * is hidden, they're typing, or they're selecting text to read/copy.
 */
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

/**
 * The single frequency/eligibility check. Intent triggers (the visitor just
 * tapped something) skip the "busy" test because the tap IS the interaction;
 * the passive trigger must also find a quiet moment.
 */
export function shouldShowAuthPrompt(
  trigger: AuthPromptTrigger,
): AuthPromptDecision {
  if (!isBrowser()) return { ok: false, reason: "server" };
  if (isAppMode()) return { ok: false, reason: "app_mode" };
  if (env.authLoading) return { ok: false, reason: "auth_loading" };
  if (env.authenticated) return { ok: false, reason: "authenticated" };
  if (env.signingIn) return { ok: false, reason: "signing_in" };
  if (!AUTH_PROMPT_ELIGIBLE_PATHS.has(env.pathname)) {
    return { ok: false, reason: "page_ineligible" };
  }
  if (hasDismissedAuthPrompt()) return { ok: false, reason: "dismissed" };
  if (shownThisLoad || readSession(SHOWN_KEY) === "1") {
    return { ok: false, reason: "already_shown" };
  }
  if (state.open) return { ok: false, reason: "already_open" };
  if (otherPopupOpen()) return { ok: false, reason: "other_popup_open" };
  if (trigger === "delayed" && userBusy()) {
    return { ok: false, reason: "user_busy" };
  }
  return { ok: true };
}

/* ------------------------------- actions ----------------------------- */

/**
 * Open the prompt for `trigger` if the gate allows it. Returns whether it
 * opened so the caller can fall back to its own inline hint when it didn't.
 */
export function requestAuthPrompt(trigger: AuthPromptTrigger): boolean {
  if (!shouldShowAuthPrompt(trigger).ok) return false;
  shownThisLoad = true;
  writeSession(SHOWN_KEY, "1");
  state = { open: true, trigger, openedAt: performance.now() };
  emit();
  return true;
}

/** Close without recording a dismissal (CTA clicked, or the user logged in). */
export function closeAuthPrompt(): void {
  if (!state.open) return;
  state = CLOSED;
  emit();
}

/** The visitor said no: remember it on this device and close. */
export function dismissAuthPrompt(via: AuthPromptDismissVia): void {
  const record: DismissedRecord = { at: new Date().toISOString(), via };
  writeLocal(DISMISSED_KEY, JSON.stringify(record));
  closeAuthPrompt();
}

/**
 * The visitor now has an account on this device. Treated like a dismissal:
 * the prompt exists to win new accounts, not to nag people who log out.
 */
export function markAuthPromptConverted(): void {
  if (hasDismissedAuthPrompt()) return;
  const record: DismissedRecord = {
    at: new Date().toISOString(),
    via: "converted",
  };
  writeLocal(DISMISSED_KEY, JSON.stringify(record));
}

/**
 * Deliberate reset (admin Dev Tools / QA): forget the dismissal and the
 * per-session flag so the prompt can show again on this device.
 */
export function resetAuthPrompt(): void {
  writeLocal(DISMISSED_KEY, null);
  writeSession(SHOWN_KEY, null);
  shownThisLoad = false;
  closeAuthPrompt();
}
