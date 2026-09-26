// Deep engagement tracking for the public pages — what a visitor did before
// signing in (or leaving). Mount once per public page with the page name.
//
// Emits, per visit:
//   LANDING_VIEWED          on entry (with auth_error / visit number)
//   LANDING_SCROLL_DEPTH    once each at 25 / 50 / 75 / 100 %
//   LANDING_SECTION_VIEWED  once per `[data-landing-section]` that scrolls
//                           ≥ 35 % into view, with the order it was reached
//   LANDING_CTA_VIEWED      once per `[data-cta-location]` sign-in button that
//                           becomes ≥ 60 % visible (impression, for CTR)
//   LANDING_EXIT_INTENT     once, when the mouse leaves through the top edge
//   LANDING_EXIT            summary when the page is left (route change) or
//                           hidden (tab switch / close): scroll reach,
//                           sections + CTAs seen, clicks, FAQ / demo use,
//                           active vs total time, login outcome, converted,
//                           how far the sign-in prompt got.
//                           A visitor who comes back after a hidden exit gets
//                           a second summary with `exit_index: 2`; the last
//                           one per visit is the complete picture.
//
// CTA clicks, FAQ opens, demo interactions and login outcomes are reported
// into the visit by their components via `lib/analytics/landing.ts`.

import { useEffect } from "react";
import { analytics, AnalyticsEvent } from "@/lib/analytics";
import { beginLandingVisit, endLandingVisit } from "@/lib/analytics/landing";

const SCROLL_MILESTONES = [25, 50, 75, 100] as const;
const SECTION_THRESHOLD = 0.35;
const CTA_THRESHOLD = 0.6;
const ACTIVE_WINDOW_MS = 10_000;
const ACTIVE_TICK_MS = 1_000;

function viewedPct(): number {
  const doc = document.documentElement;
  const total = Math.max(doc.scrollHeight, 1);
  const seen = (window.scrollY || doc.scrollTop || 0) + window.innerHeight;
  return Math.max(0, Math.min(100, Math.round((seen / total) * 100)));
}

function bucket(pct: number): 0 | 25 | 50 | 75 | 100 {
  if (pct >= 100) return 100;
  if (pct >= 75) return 75;
  if (pct >= 50) return 50;
  if (pct >= 25) return 25;
  return 0;
}

export function useLandingAnalytics(page: string): void {
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return undefined;
    }
    const visit = beginLandingVisit(page);
    const elapsedS = () =>
      Math.round((performance.now() - visit.enteredAt) / 1000);

    let authError: string | undefined;
    try {
      authError =
        new URLSearchParams(window.location.search).get("auth_error") ??
        undefined;
    } catch {
      /* ignore */
    }
    analytics.track(AnalyticsEvent.LANDING_VIEWED, {
      page,
      auth_error: authError,
      visit_number: analytics.getSession()?.number ?? 0,
    });

    /* ---------------------------- scroll depth --------------------------- */
    const fired = new Set<number>();
    let raf = 0;
    const measureScroll = () => {
      raf = 0;
      const pct = viewedPct();
      if (pct > visit.maxScrollPct) visit.maxScrollPct = pct;
      for (const m of SCROLL_MILESTONES) {
        if (pct >= m && !fired.has(m)) {
          fired.add(m);
          analytics.track(AnalyticsEvent.LANDING_SCROLL_DEPTH, {
            page,
            depth_pct: m,
            time_since_entry_s: elapsedS(),
          });
        }
      }
    };
    const onScroll = () => {
      if (!raf) raf = window.requestAnimationFrame(measureScroll);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    // Tall viewports may already show 25 %+ without scrolling.
    const initialMeasure = window.setTimeout(measureScroll, 500);

    /* ------------------------ sections + CTA impressions ------------------ */
    const observers: IntersectionObserver[] = [];
    if (typeof IntersectionObserver !== "undefined") {
      const sections = Array.from(
        document.querySelectorAll<HTMLElement>("[data-landing-section]"),
      );
      const sectionObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const name = (entry.target as HTMLElement).dataset.landingSection;
            if (!name || visit.sectionsViewed.includes(name)) continue;
            visit.sectionsViewed.push(name);
            analytics.track(AnalyticsEvent.LANDING_SECTION_VIEWED, {
              page,
              section: name,
              order: visit.sectionsViewed.length,
              time_since_entry_s: elapsedS(),
            });
            sectionObserver.unobserve(entry.target);
          }
        },
        { threshold: SECTION_THRESHOLD },
      );
      sections.forEach((el) => sectionObserver.observe(el));
      observers.push(sectionObserver);

      const ctas = Array.from(
        document.querySelectorAll<HTMLElement>("[data-cta-location]"),
      );
      const ctaObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const location = (entry.target as HTMLElement).dataset.ctaLocation;
            if (!location || visit.ctaViewed.includes(location)) continue;
            visit.ctaViewed.push(location);
            analytics.track(AnalyticsEvent.LANDING_CTA_VIEWED, {
              page,
              location,
              time_since_entry_s: elapsedS(),
            });
            ctaObserver.unobserve(entry.target);
          }
        },
        { threshold: CTA_THRESHOLD },
      );
      ctas.forEach((el) => ctaObserver.observe(el));
      observers.push(ctaObserver);
    }

    /* ----------------------------- exit intent --------------------------- */
    const onMouseOut = (e: MouseEvent) => {
      if (visit.exitIntent || e.relatedTarget || e.clientY > 0) return;
      visit.exitIntent = true;
      analytics.track(AnalyticsEvent.LANDING_EXIT_INTENT, {
        page,
        time_since_entry_s: elapsedS(),
        scroll_pct: visit.maxScrollPct,
      });
    };
    document.addEventListener("mouseout", onMouseOut);

    /* ------------------------------ active time -------------------------- */
    let lastActivity = performance.now();
    const onActivity = () => {
      lastActivity = performance.now();
    };
    const activityEvents = [
      "pointerdown",
      "pointermove",
      "keydown",
      "scroll",
      "touchstart",
      "wheel",
    ];
    activityEvents.forEach((ev) =>
      window.addEventListener(ev, onActivity, { passive: true }),
    );
    const activeTimer = window.setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        performance.now() - lastActivity < ACTIVE_WINDOW_MS
      ) {
        visit.activeMs += ACTIVE_TICK_MS;
      }
    }, ACTIVE_TICK_MS);

    /* -------------------------------- exit ------------------------------- */
    let armed = true;
    const emitExit = (exit_type: "navigation" | "hidden") => {
      if (!armed) return;
      armed = false;
      visit.exits += 1;
      const deepest = visit.sectionsViewed[visit.sectionsViewed.length - 1];
      analytics.track(AnalyticsEvent.LANDING_EXIT, {
        page,
        exit_type,
        exit_index: visit.exits,
        time_on_page_s: elapsedS(),
        active_time_s: Math.round(visit.activeMs / 1000),
        max_scroll_pct: visit.maxScrollPct,
        scroll_bucket: bucket(visit.maxScrollPct),
        sections_viewed: visit.sectionsViewed,
        sections_viewed_count: visit.sectionsViewed.length,
        deepest_section: deepest ?? "none",
        cta_viewed_count: visit.ctaViewed.length,
        cta_clicked_count: visit.ctaClicks,
        faq_opened_count: visit.faqOpens,
        demo_interactions: visit.demoInteractions,
        exit_intent: visit.exitIntent,
        login_outcome: visit.loginOutcome,
        converted: visit.loginOutcome === "succeeded",
        auth_prompt: visit.authPrompt,
      });
      if (exit_type === "hidden") analytics.flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") emitExit("hidden");
      else armed = true; // came back: a later leave gets a fresh summary
    };
    const onPageHide = () => emitExit("hidden");
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      window.clearTimeout(initialMeasure);
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      observers.forEach((o) => o.disconnect());
      document.removeEventListener("mouseout", onMouseOut);
      activityEvents.forEach((ev) =>
        window.removeEventListener(ev, onActivity),
      );
      window.clearInterval(activeTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      emitExit("navigation");
      endLandingVisit();
    };
  }, [page]);
}
