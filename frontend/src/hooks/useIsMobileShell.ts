import { useEffect, useState } from "react";

// The bottom-nav / mobile-shell breakpoint — mirrors the `lg:hidden` Tailwind
// class that shows the mobile nav and hides the desktop sidebar. This is
// deliberately NOT the 768px `useIsMobile`: the app shell switches at `lg`.
const QUERY = "(max-width: 1023px)";

/**
 * Whether the mobile app shell (bottom nav) is showing. Initialised
 * SYNCHRONOUSLY from `matchMedia` so the very first paint already knows the
 * form factor — this is what lets the keep-alive tab host and the tab route
 * elements agree on the same render and never double-mount a tab page.
 */
export function useIsMobileShell(): boolean {
  const [isMobileShell, setIsMobileShell] = useState(
    () =>
      typeof window !== "undefined" && window.matchMedia(QUERY).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const onChange = () => setIsMobileShell(mql.matches);
    mql.addEventListener("change", onChange);
    onChange();
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobileShell;
}
