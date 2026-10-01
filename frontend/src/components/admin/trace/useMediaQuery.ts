import { useEffect, useState } from "react";

/**
 * Whether a CSS media query matches, initialised synchronously from
 * `matchMedia` (like `useIsMobileShell`) so the first paint already has the
 * right layout.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    onChange();
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
