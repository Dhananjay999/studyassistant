/**
 * Server-side entry used ONLY by `scripts/prerender.mjs` at build time.
 *
 * Renders the public, indexable routes to static HTML so crawlers that don't
 * execute JavaScript (social scrapers, GPTBot/ClaudeBot/PerplexityBot, some
 * search engines) see real content and correct per-page head tags. The client
 * still mounts normally over the prerendered markup (see `src/main.tsx`).
 *
 * Public pages are imported eagerly (React.lazy can't resolve inside
 * `renderToString`) and the provider tree mirrors `App.tsx` minus the
 * browser-only pieces (router swapped for StaticRouter; toasts/overlays that
 * render nothing on public pages are omitted).
 */
import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import { Route, Routes } from "react-router-dom";
import { HelmetProvider, type HelmetServerState } from "react-helmet-async";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider } from "@/contexts/AuthContext";
import LandingPage from "@/pages/LandingPage";
import FeaturesPage from "@/pages/FeaturesPage";
import AboutPage from "@/pages/AboutPage";
import PrivacyPage from "@/pages/PrivacyPage";
import TermsPage from "@/pages/TermsPage";

// Route list for scripts/prerender.mjs (same bundle, no duplicate source).
export { PUBLIC_ROUTES } from "@/lib/seo-routes";

export interface RenderResult {
  html: string;
  helmet: HelmetServerState;
}

/** Render one public route to static HTML plus its helmet head tags. */
export function render(path: string): RenderResult {
  const helmetContext: { helmet?: HelmetServerState } = {};
  const html = renderToString(
    <HelmetProvider context={helmetContext}>
      <ThemeProvider>
        <AuthProvider>
          <StaticRouter location={path}>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/features" element={<FeaturesPage />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="/privacy" element={<PrivacyPage />} />
              <Route path="/terms" element={<TermsPage />} />
            </Routes>
          </StaticRouter>
        </AuthProvider>
      </ThemeProvider>
    </HelmetProvider>,
  );
  return { html, helmet: helmetContext.helmet as HelmetServerState };
}
