// Delegated click tracking. One capture-phase listener on `document` fires a
// `CLICK` event for any element (or ancestor) carrying `data-analytics-id`.
// Nothing without the attribute is tracked, so arbitrary DOM text never
// leaks. Use `analyticsAttrs()` from index.ts to add the attributes in JSX.

import type { ClickProps } from "./events";

const MAX_NAME = 60;

function describe(el: HTMLElement): ClickProps {
  const ds = el.dataset;
  const text = (el.textContent || "").replace(/\s+/g, " ").trim();
  const section = el.closest<HTMLElement>("[data-analytics-section]");
  let href: string | undefined;
  const anchor = el.closest<HTMLAnchorElement>("a[href]");
  if (anchor) {
    try {
      const u = new URL(anchor.href, window.location.href);
      href = u.host + u.pathname; // no query/hash
    } catch {
      /* ignore */
    }
  }
  return {
    element_id: ds.analyticsId || "",
    element_name: ds.analyticsName || (text ? text.slice(0, MAX_NAME) : undefined),
    element_type: el.getAttribute("role") || el.tagName.toLowerCase(),
    location: ds.analyticsLocation || section?.dataset.analyticsSection || undefined,
    href,
  };
}

export function installClickTracking(
  onClick: (props: ClickProps) => void,
): () => void {
  const handler = (e: MouseEvent) => {
    try {
      const target = e.target as Element | null;
      const el = target?.closest?.<HTMLElement>("[data-analytics-id]");
      if (!el || !el.dataset.analyticsId) return;
      onClick(describe(el));
    } catch {
      /* never break the app over analytics */
    }
  };
  document.addEventListener("click", handler, { capture: true, passive: true });
  return () =>
    document.removeEventListener("click", handler, { capture: true });
}
