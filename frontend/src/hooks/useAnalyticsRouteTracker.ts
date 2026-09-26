// Automatic page lifecycle from the router: `page_exit` for the page being
// left (with time on page) then `page_entry` for the new one. Keyed on
// pathname only — query changes (e.g. switching chat sessions) are feature
// events, not page views. Works with the mobile keep-alive tabs because it
// watches location, not component mount/unmount.
//
// A hidden tab / pagehide also emits a single `page_exit` (exit_type
// "hidden"); coming back resets the timer without a new entry event.

import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import { analytics, AnalyticsEvent, routeName } from "@/lib/analytics";
import { pickSafeSearch } from "@/lib/analytics/routeName";

interface PageVisit {
  path: string;
  name: string;
  enteredAt: number;
  exited: boolean;
}

const MAX_TIME_ON_PAGE_S = 24 * 60 * 60;

function secondsSince(t: number): number {
  return Math.min(Math.max(0, Math.round((performance.now() - t) / 1000)), MAX_TIME_ON_PAGE_S);
}

function exitVisit(v: PageVisit, exit_type: "navigation" | "hidden"): void {
  v.exited = true;
  analytics.track(AnalyticsEvent.PAGE_EXIT, {
    page_path: v.path,
    page_name: v.name,
    time_on_page_s: secondsSince(v.enteredAt),
    exit_type,
  });
}

export function useAnalyticsRouteTracker(): void {
  const { pathname, search } = useLocation();
  const navType = useNavigationType();
  const current = useRef<PageVisit | null>(null);
  const first = useRef(true);
  // Latest search string for the entry event without re-running on change.
  const searchRef = useRef(search);
  searchRef.current = search;

  useEffect(() => {
    const prev = current.current;
    if (prev && !prev.exited) exitVisit(prev, "navigation");

    const visit: PageVisit = {
      path: pathname,
      name: routeName(pathname),
      enteredAt: performance.now(),
      exited: false,
    };
    current.current = visit;
    const entry_source = first.current
      ? "initial"
      : navType === "POP"
        ? "back_forward"
        : "navigation";
    first.current = false;

    // Defer one tick so Helmet has applied the new document title.
    const t = window.setTimeout(() => {
      analytics.track(AnalyticsEvent.PAGE_ENTRY, {
        page_path: pathname,
        page_name: visit.name,
        previous_path: prev?.path ?? null,
        entry_source,
        ...pickSafeSearch(searchRef.current),
      });
    }, 0);
    return () => window.clearTimeout(t);
    // navType is read at effect time; it changes together with pathname.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    const onHidden = () => {
      const v = current.current;
      if (v && !v.exited) {
        exitVisit(v, "hidden");
        analytics.flush();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        onHidden();
        return;
      }
      const v = current.current;
      if (v?.exited) {
        v.exited = false;
        v.enteredAt = performance.now();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHidden);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHidden);
    };
  }, []);
}
