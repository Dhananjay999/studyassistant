// Marks a same-tab Google sign-in that has left the site, so the app can tell
// "came back through /auth/callback" from "came back any other way" (back
// button, a failed exchange that never reached the callback page, a reload).
// sessionStorage: it survives the round trip to Google in this tab and never
// leaks to another tab. Every access is guarded: WebKit can drop storage on
// pages that are closing or in private mode.

const KEY = "aeva_login_redirect_started_at";

/** Remember that a redirect sign-in just started (before navigating away). */
export function markRedirectStarted(): void {
  try {
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* storage unavailable: the return can't be told apart, that's all */
  }
}

/** Take the pending redirect start, if any: when it began (epoch ms). */
export function consumeRedirectStart(): number | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw === null) return null;
    sessionStorage.removeItem(KEY);
    const at = Number(raw);
    return Number.isFinite(at) && at > 0 ? at : null;
  } catch {
    return null;
  }
}
