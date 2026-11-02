import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import "@fontsource-variable/sora";
import "@fontsource-variable/inter";
import "./index.css";
import App from "./App.tsx";
import { analytics, AnalyticsEvent, initAnalytics } from "./lib/analytics";
import { initAppMode } from "./lib/appMode";
import { attachGlobalRipple } from "./lib/ripple";
import { API_BASE_URL } from "./lib/api";
import { initSentry } from "./lib/sentry";
import { ErrorBoundary } from "./components/common/ErrorBoundary";

// First, so a crash anywhere in boot is still reported (SDK loads async).
initSentry();

// A deploy replaces the hashed chunks; a tab opened before it fails to import
// the next lazy page ("Failed to fetch dynamically imported module", Sentry
// CLIENT-2: 7 events / 6 users in one week) and landed on the crash screen.
// Reload once to pick up the new build. A second failure within a minute is
// left to the error boundary so a broken deploy cannot loop the tab.
const STALE_CHUNK_KEY = "aeva:stale-chunk-reload";
const STALE_CHUNK_WINDOW_MS = 60_000;
function readStaleChunkReload(): number {
  try {
    return Number(sessionStorage.getItem(STALE_CHUNK_KEY)) || 0;
  } catch {
    return 0;
  }
}
window.addEventListener("vite:preloadError", (event) => {
  const last = readStaleChunkReload();
  if (last && Date.now() - last < STALE_CHUNK_WINDOW_MS) return;
  try {
    sessionStorage.setItem(STALE_CHUNK_KEY, String(Date.now()));
  } catch {
    // Storage unavailable: still better to reload once than to crash.
  }
  event.preventDefault();
  window.location.reload();
});

// Before first paint: detect native-app (WebView) mode and install the
// delegated touch ripple so every tappable gets native-feeling feedback.
initAppMode();
attachGlobalRipple();

// Warm the API origin (DNS + TCP + TLS) before the first data fetches fire —
// the app's startup queries are on the LCP critical path (Lighthouse).
try {
  const apiOrigin = new URL(API_BASE_URL, window.location.href).origin;
  if (apiOrigin !== window.location.origin) {
    const link = document.createElement("link");
    link.rel = "preconnect";
    link.href = apiOrigin;
    link.crossOrigin = "anonymous";
    document.head.appendChild(link);
  }
} catch {
  // Malformed API base URL — preconnect is best-effort only.
}

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
    <Analytics />
  </ErrorBoundary>,
);

initAnalytics();

// Report the reload above once the SDK is up (the event could not be sent
// before the page went away). The marker is kept so the loop guard holds.
if (readStaleChunkReload()) {
  analytics.track(AnalyticsEvent.APP_STALE_CHUNK_RELOADED);
}
