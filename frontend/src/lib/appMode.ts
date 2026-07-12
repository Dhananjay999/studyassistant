// Native-app (WebView) mode. The mobile app sets
// `localStorage.is_open_from_app = "true"` before loading the site (or loads
// it once with `?app=1`, which persists the same flag). Everything
// app-specific keys off this ONE flag: the entry screen, onboarding, and the
// `app-mode` class on <html> that CSS uses for native polish.

const APP_FLAG = "is_open_from_app";
const ONBOARDING_FLAG = "app_onboarding_seen";

/** Safe localStorage getter (private mode / disabled storage tolerant). */
function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable — app mode simply won't persist.
  }
}

/** True when running inside the native mobile app's WebView. */
export function isAppMode(): boolean {
  return read(APP_FLAG) === "true";
}

/** Whether the swipeable app onboarding has been completed/skipped. */
export function hasSeenAppOnboarding(): boolean {
  return read(ONBOARDING_FLAG) === "true";
}

export function markAppOnboardingSeen(): void {
  write(ONBOARDING_FLAG, "true");
}

/** Explicit reset (e.g. from a future settings entry) re-shows onboarding. */
export function resetAppOnboarding(): void {
  write(ONBOARDING_FLAG, null);
}

/**
 * Manually add/remove the app-mode flag on THIS device (admin Dev Tools).
 * Lets an admin validate the app experience before the native app exists,
 * without affecting any other user. Applies the `app-mode` class immediately;
 * entry-screen routing picks it up on the next navigation/reload.
 */
export function setAppModeFlag(enabled: boolean): void {
  write(APP_FLAG, enabled ? "true" : null);
  document.documentElement.classList.toggle("app-mode", enabled);
}

/**
 * Startup hook (called from main.tsx before render): persists the `?app=1`
 * query alias into the flag and stamps `app-mode` on <html> so CSS can strip
 * web chrome without JS round-trips.
 */
export function initAppMode(): void {
  const params = new URLSearchParams(window.location.search);
  if (params.get("app") === "1") write(APP_FLAG, "true");
  document.documentElement.classList.toggle("app-mode", isAppMode());
}
