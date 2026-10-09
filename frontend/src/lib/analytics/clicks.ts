// Delegated click tracking. One capture-phase listener on `document` fires a
// per-element event for every interactive element the user presses: buttons,
// links, menu items, tabs, switches, checkboxes and anything carrying
// `data-analytics-id`. The event NAME is derived from the element —
// "New chat" → `NEW_CHAT_CLICK`, `sidebar.nav.chat` → `SIDEBAR_NAV_CHAT_CLICK`,
// a masked row in a private list → `BOOKMARKS_LIST_ITEM_CLICK` — and every
// click carries `event_group: "click"`. No per-button wiring is needed.
//
// Labelling, in priority order:
//   1. `data-analytics-name` (explicit, always wins)
//   2. masked as "[private]" when inside `[data-analytics-private]`,
//      `.ph-no-capture` or `[data-analytics-user-content]` — lists of user
//      content (chat titles, file names, quiz answers, chat messages…) must
//      be wrapped in one of these
//   3. `aria-label` / `aria-labelledby`
//   4. `title`
//   5. visible text (≤ 60 chars) or an image `alt` — but ONLY when it reads
//      like a static control label. Text that looks typed by a person (an
//      email address, a sentence, a date/score string, more than four
//      words) is masked too: the event is named `<location>_TEXT_CLICK`
//      and the label is replaced by a short hash (`text_hash`) so repeated
//      presses of the same button still group, without the text itself.
//      Static labels must stay short; give anything longer an aria-label
//      or `data-analytics-name`.
//
// `location` comes from `data-analytics-location`, else the nearest
// `data-analytics-section`, else the nearest landmark (nav/aside/main…).
// `popup` names the dialog / sheet / menu the element lives in.

import { clickEventName, type ClickProps } from "./events";

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
const PRIVATE =
  "[data-analytics-private], .ph-no-capture, [data-analytics-user-content]";
// Visible text is used as a label only when it looks like a fixed control
// caption. Anything that could have been typed by a person is masked.
const FREE_TEXT_MAX_CHARS = 32;
const FREE_TEXT_MAX_WORDS = 4;
// Emails, URLs, long numbers (years, scores), sentences and clock times.
// Short static captions with small numbers ("Class 11-12") stay as they are.
const FREE_TEXT_PATTERN = /@|https?:\/\/|\d{3,}|[?!]|\b\d{1,2}:\d{2}\b|\b(am|pm)\b/i;
const IGNORE = "[data-analytics-ignore]";
const POPUP =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [data-vaul-drawer]';
const LANDMARK = "nav, aside, header, footer, main, form";
const MAX_NAME = 60;

export interface ElementLabel {
  name?: string;
  source: ClickProps["label_source"];
  /** Short hash of a masked free-text label (see `looksLikeFreeText`). */
  textHash?: string;
}

/** True when a visible-text label could be user-typed rather than a caption. */
export function looksLikeFreeText(text: string): boolean {
  if (text.length > FREE_TEXT_MAX_CHARS) return true;
  if (text.split(" ").length > FREE_TEXT_MAX_WORDS) return true;
  return FREE_TEXT_PATTERN.test(text);
}

/** 32-bit FNV-1a as 8 hex chars: stable, cheap, not reversible to the text. */
export function hashLabel(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function textLabel(text: string): ElementLabel {
  return looksLikeFreeText(text)
    ? { source: "text_masked", textHash: hashLabel(text) }
    : { name: text, source: "text" };
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
      return textLabel(clean(el.value));
    }
    const label = clean(el.labels?.[0]?.textContent);
    if (label) return textLabel(label);
  }

  const text = clean(el.textContent);
  if (text) return textLabel(text);
  const alt = clean(el.querySelector("img[alt]")?.getAttribute("alt"));
  if (alt) return textLabel(alt);
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

  const masked = label.source === "private" || label.source === "text_masked";
  return {
    element_id:
      ds.analyticsId || (masked ? label.source : slug(label.name ?? "")),
    element_name: masked ? `[${label.source}]` : label.name,
    element_type: type,
    location: ds.analyticsLocation || section || landmark,
    href,
    explicit: !!ds.analyticsId,
    label_source: label.source,
    text_hash: label.textHash,
    popup: popupNameOf(el),
  };
}

/** Event name for a described click (see header for examples). */
export function clickNameFor(props: ClickProps): string {
  if (props.explicit) return clickEventName(props.element_id);
  if (props.label_source === "private") {
    return clickEventName(`${props.location ?? "private"}_item`);
  }
  if (props.label_source === "text_masked") {
    return clickEventName(`${props.location ?? "unlabeled"}_text`);
  }
  return clickEventName(props.element_name ?? "unlabeled");
}

export function installClickTracking(
  onClick: (name: string, props: ClickProps) => void,
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
      const props = describe(el);
      onClick(clickNameFor(props), props);
    } catch {
      /* never break the app over analytics */
    }
  };
  document.addEventListener("click", handler, { capture: true, passive: true });
  return () =>
    document.removeEventListener("click", handler, { capture: true });
}
