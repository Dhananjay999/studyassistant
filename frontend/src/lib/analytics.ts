/**
 * Optional third-party analytics, loaded only in production and only when the
 * corresponding env var is set (see env.example):
 *
 * - Google Analytics 4:  VITE_GA_MEASUREMENT_ID (G-XXXXXXXXXX)
 * - Microsoft Clarity:   VITE_CLARITY_ID
 *
 * Both scripts are injected async after the app mounts, so they never block
 * rendering. GA4's automatic page_view is disabled — this is an SPA, so
 * `AnalyticsTracker` (in App.tsx) reports route changes instead.
 */

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

const GA_ID = import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined;
const CLARITY_ID = import.meta.env.VITE_CLARITY_ID as string | undefined;

function injectScript(src: string): void {
  const s = document.createElement("script");
  s.async = true;
  s.src = src;
  document.head.appendChild(s);
}

/** Load configured analytics. Call once from main.tsx; safe to re-call. */
export function initAnalytics(): void {
  if (!import.meta.env.PROD) return;

  if (GA_ID && !window.gtag) {
    window.dataLayer = window.dataLayer ?? [];
    // Must be a real `function` pushing the `arguments` object — gtag.js only
    // executes dataLayer entries that are Arguments objects, so an arrow
    // function pushing a rest-args array is silently ignored.
    window.gtag = function gtag() {
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer?.push(arguments);
    };
    window.gtag("js", new Date());
    // SPA: page_views are sent from AnalyticsTracker on route changes.
    window.gtag("config", GA_ID, { send_page_view: false });
    injectScript(`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`);
  }

  if (CLARITY_ID && !document.getElementById("ms-clarity")) {
    const s = document.createElement("script");
    s.id = "ms-clarity";
    s.async = true;
    s.src = `https://www.clarity.ms/tag/${CLARITY_ID}`;
    document.head.appendChild(s);
  }
}

/** Report an SPA navigation to GA4. No-op unless GA4 is configured. */
export function trackPageview(path: string): void {
  window.gtag?.("event", "page_view", {
    page_path: path,
    page_location: window.location.href,
    page_title: document.title,
  });
}
