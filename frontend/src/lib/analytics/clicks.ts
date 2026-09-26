// Delegated click tracking. One capture-phase listener on `document` fires a
// `CLICK` event for every interactive element the user presses: buttons,
// links, menu items, tabs, switches, checkboxes and anything carrying
// `data-analytics-id`. No per-button wiring is needed.
//
// Labelling, in priority order:
//   1. `data-analytics-name` (explicit, always wins)
//   2. masked as "[private]" when inside `[data-analytics-private]` or
//      `.ph-no-capture` — lists of user content (chat titles, file names,
//      quiz answers…) must be wrapped in one of these
//   3. `aria-label` / `aria-labelledby`
//   4. `title`
//   5. visible text (≤ 60 chars) or an image `alt`
//
// `location` comes from `data-analytics-location`, else the nearest
// `data-analytics-section`, else the nearest landmark (nav/aside/main…).
// `popup` names the dialog / sheet / menu the element lives in.

import type { ClickProps } from "./events";

const INTERACTIVE = [
  "button",
  "a[href]",
  "summary",
  'input[type="button"]',
  'input[type="submit"]',
  'input[type="reset"]',
  'input[type="checkbox"]',
  'input[type="radio"]',
  '[role="button"]',
  '[role="link"]',
  '[role="menuitem"]',
  '[role="menuitemcheckbox"]',
  '[role="menuitemradio"]',
  '[role="tab"]',
  '[role="switch"]',
  '[role="checkbox"]',
  '[role="radio"]',
  "[data-analytics-id]",
].join(", ");
const PRIVATE = "[data-analytics-private], .ph-no-capture";
const IGNORE = "[data-analytics-ignore]";
const POPUP =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [data-vaul-drawer]';
const LANDMARK = "nav, aside, header, footer, main, form";
const MAX_NAME = 60;

export interface ElementLabel {
  name?: string;
  source: ClickProps["label_source"];
}

function clean(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
}

function textOfIds(ids: string | null): string {
  if (!ids) return "";
  return clean(
    ids
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" "),
  );
}

/** Human label for an interactive element, following the priority above. */
export function describeElementLabel(el: HTMLElement): ElementLabel {
  const explicit = clean(el.dataset.analyticsName);
  if (explicit) return { name: explicit, source: "attr" };
  if (el.closest(PRIVATE)) return { source: "private" };

  const aria = clean(el.getAttribute("aria-label"));
  if (aria) return { name: aria, source: "aria" };
  const labelledBy = textOfIds(el.getAttribute("aria-labelledby"));
  if (labelledBy) return { name: labelledBy, source: "aria" };

  const title = clean(el.getAttribute("title"));
  if (title) return { name: title, source: "title" };

  if (el instanceof HTMLInputElement) {
    if (/^(button|submit|reset)$/.test(el.type) && clean(el.value)) {
      return { name: clean(el.value), source: "text" };
    }
    const label = clean(el.labels?.[0]?.textContent);
    if (label) return { name: label, source: "text" };
  }

  const text = clean(el.textContent);
  if (text) return { name: text, source: "text" };
  const alt = clean(el.querySelector("img[alt]")?.getAttribute("alt"));
  if (alt) return { name: alt, source: "text" };
  return { source: "none" };
}

/** Name of the open dialog / sheet / menu that contains `el`, if any. */
export function popupNameOf(el: Element): string | undefined {
  const popup = el.closest<HTMLElement>(POPUP);
  if (!popup) return undefined;
  const byTitle = textOfIds(popup.getAttribute("aria-labelledby"));
  if (byTitle) return byTitle;
  const aria = clean(popup.getAttribute("aria-label"));
  if (aria) return aria;
  return popup.getAttribute("role") === "menu" ? "menu" : "popup";
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "unlabeled"
  );
}

function describe(el: HTMLElement): ClickProps {
  const ds = el.dataset;
  const label = describeElementLabel(el);
  const section = el.closest<HTMLElement>("[data-analytics-section]")?.dataset
    .analyticsSection;
  const landmark = el.closest(LANDMARK)?.tagName.toLowerCase();

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

  const role = el.getAttribute("role");
  const type =
    role ||
    (el instanceof HTMLInputElement
      ? `input_${el.type}`
      : el.tagName === "A"
        ? "link"
        : el.tagName.toLowerCase());

  return {
    element_id:
      ds.analyticsId ||
      (label.source === "private" ? "private" : slug(label.name ?? "")),
    element_name: label.source === "private" ? "[private]" : label.name,
    element_type: type,
    location: ds.analyticsLocation || section || landmark,
    href,
    explicit: !!ds.analyticsId,
    label_source: label.source,
    popup: popupNameOf(el),
  };
}

export function installClickTracking(
  onClick: (props: ClickProps) => void,
): () => void {
  const handler = (e: MouseEvent) => {
    try {
      // Only real user input; programmatic `.click()` calls are skipped.
      if (!e.isTrusted) return;
      const target = e.target as Element | null;
      if (!target || typeof target.closest !== "function") return;
      if (target.closest(IGNORE)) return;
      const el = target.closest<HTMLElement>(INTERACTIVE);
      if (!el) return;
      onClick(describe(el));
    } catch {
      /* never break the app over analytics */
    }
  };
  document.addEventListener("click", handler, { capture: true, passive: true });
  return () =>
    document.removeEventListener("click", handler, { capture: true });
}
