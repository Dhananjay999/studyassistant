// Acquisition attribution. `first_touch` is written once and kept for the
// life of the browser profile; `last_touch` is refreshed whenever a landing
// carries utm_* params or arrives from an external referrer. Both persist
// across navigations so a `/?utm_source=google` visit is still attributed
// on the chat page ten minutes later.

import type { CampaignContext, CampaignTouch } from "./types";
import { STORAGE_KEYS, readJSON, writeJSON } from "./storage";
import { safeReferrer } from "./context";

const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
] as const;

function currentTouch(): CampaignTouch | null {
  const params = new URLSearchParams(window.location.search);
  const touch: CampaignTouch = { at: new Date().toISOString() };
  let hasUtm = false;
  for (const key of UTM_KEYS) {
    const v = params.get(key);
    if (v) {
      touch[key] = v.slice(0, 100);
      hasUtm = true;
    }
  }
  const referrer = safeReferrer();
  let external = false;
  if (referrer) {
    try {
      const host = new URL(referrer).hostname;
      if (host && host !== window.location.hostname) {
        touch.referrer_domain = host;
        external = true;
      }
    } catch {
      /* ignore */
    }
  }
  if (!hasUtm && !external) return null;
  touch.landing_page = window.location.pathname;
  return touch;
}

/**
 * Called once at init (a full page load). Updates persisted attribution and
 * returns the merged context. Safe to call again; it is idempotent for the
 * same page load.
 */
export function captureAttribution(): CampaignContext {
  const stored = readJSON<CampaignContext>(STORAGE_KEYS.attribution) ?? {};
  const touch = currentTouch();
  let changed = false;

  if (!stored.first_touch) {
    stored.first_touch = touch ?? {
      at: new Date().toISOString(),
      landing_page: window.location.pathname,
    };
    changed = true;
  }
  if (touch) {
    stored.last_touch = touch;
    changed = true;
  }
  if (changed) writeJSON(STORAGE_KEYS.attribution, stored);
  return stored;
}

export function getAttribution(): CampaignContext {
  return readJSON<CampaignContext>(STORAGE_KEYS.attribution) ?? {};
}
