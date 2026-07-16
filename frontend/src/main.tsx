import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import "@fontsource-variable/sora";
import "@fontsource-variable/inter";
import "./index.css";
import App from "./App.tsx";
import { initAnalytics } from "./lib/analytics";
import { initAppMode } from "./lib/appMode";
import { attachGlobalRipple } from "./lib/ripple";
import { API_BASE_URL } from "./lib/api";

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
  <>
    <App />
    <Analytics />
  </>,
);

initAnalytics();
