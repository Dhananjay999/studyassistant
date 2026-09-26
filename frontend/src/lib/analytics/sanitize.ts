// Central redaction layer. Runs on every event's properties before enrichment
// so a careless call site can't leak content, credentials or PII.
//
// Rules (in order):
//   1. Keys that collide with reserved context keys are dropped (context wins).
//   2. Keys that look sensitive are dropped unless their suffix marks them as
//      a safe derived value (`message_length`, `first_token_ms`, `has_query`…).
//   3. String values that look like tokens/emails are redacted; long strings
//      are truncated. Nesting is limited to one level; arrays to 50 scalars.
//   4. At most MAX_PROPS keys survive.

import type { Primitive, PropValue, Props } from "./types";

export const RESERVED_KEYS: ReadonlySet<string> = new Set([
  "event",
  "timestamp",
  "anonymous_id",
  "user_id",
  "session_id",
  "session_number",
  "session_started_at",
  "posthog_session_id",
  "page_path",
  "page_url",
  "page_title",
  "page_name",
  "referrer",
  "device_type",
  "os",
  "browser",
  "browser_version",
  "screen_width",
  "screen_height",
  "viewport_width",
  "viewport_height",
  "language",
  "timezone",
  "connection_type",
  "online",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "first_utm_source",
  "first_utm_medium",
  "first_utm_campaign",
  "referrer_domain",
  "landing_page",
  "app_env",
  "app_version",
  "build_id",
  "platform",
  "is_app_mode",
]);

// Core events legitimately set a few of these (page_path on page_entry,
// entry_page/referrer_domain on session_started). Whitelist them per event.
const CORE_KEY_EXCEPTIONS: Record<string, ReadonlySet<string>> = {
  PAGE_ENTRY: new Set(["page_path", "page_name"]),
  PAGE_EXIT: new Set(["page_path", "page_name"]),
  SESSION_STARTED: new Set([
    "referrer_domain",
    "utm_source",
    "utm_medium",
    "utm_campaign",
  ]),
};

const SENSITIVE_KEY =
  /token|password|passwd|secret|authorization|cookie|email|phone|address|transcript|content|message|text|query|prompt|answer|question|body|name$/i;
const SAFE_SUFFIX =
  /_(length|count|ms|s|id|index|kind|type|types|number|used|total|key|mode)$|^has_|^is_/;
// Keys ending in `_name` that are known-safe labels (not user content).
const SAFE_NAME_KEYS = new Set(["element_name", "page_name"]);

const MAX_STRING = 200;
const MAX_ARRAY = 50;
const MAX_PROPS = 40;

const LOOKS_LIKE_JWT = /^ey[\w-]{10,}\.[\w-]{10,}\./;
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOOKS_LIKE_BEARER = /^bearer\s+\S+/i;

function keyAllowed(key: string, event: string): boolean {
  if (RESERVED_KEYS.has(key) && !CORE_KEY_EXCEPTIONS[event]?.has(key)) {
    return false;
  }
  if (SAFE_NAME_KEYS.has(key)) return true;
  if (SENSITIVE_KEY.test(key) && !SAFE_SUFFIX.test(key)) return false;
  return true;
}

function scalar(value: unknown): Primitive {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean" || typeof value === "number") {
    return Number.isFinite(value) || typeof value === "boolean" ? value : null;
  }
  if (typeof value === "string") {
    if (
      LOOKS_LIKE_JWT.test(value) ||
      LOOKS_LIKE_EMAIL.test(value) ||
      LOOKS_LIKE_BEARER.test(value)
    ) {
      return "[redacted]";
    }
    return value.length > MAX_STRING ? value.slice(0, MAX_STRING) + "…" : value;
  }
  if (value instanceof Date) return value.toISOString();
  return null;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function sanitizeValue(value: unknown, event: string, depth: number): PropValue {
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((v) => scalar(v));
  }
  if (isPlainObject(value)) {
    if (depth >= 1) return null;
    const out: Record<string, Primitive> = {};
    for (const [k, v] of Object.entries(value)) {
      if (Array.isArray(v) || isPlainObject(v)) continue; // depth limit
      // Nested numeric/boolean values (e.g. `group_counts.messages`) are
      // never content; only strings get the sensitive-key check.
      if (typeof v === "string" && !keyAllowed(k, event)) continue;
      out[k] = scalar(v);
    }
    return out;
  }
  return scalar(value);
}

export interface SanitizeResult {
  props: Props;
  dropped: string[];
}

export function sanitizeProps(
  event: string,
  input: Record<string, unknown> | undefined | null,
): SanitizeResult {
  const props: Props = {};
  const dropped: string[] = [];
  if (!input || typeof input !== "object") return { props, dropped };

  let count = 0;
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    if (!keyAllowed(key, event)) {
      dropped.push(key);
      continue;
    }
    if (count >= MAX_PROPS) {
      dropped.push(key);
      continue;
    }
    props[key] = sanitizeValue(value, event, 0);
    count += 1;
  }
  return { props, dropped };
}

/** Event names must be short UPPER_SNAKE_CASE (≤ 40 chars). */
export const EVENT_NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,39}$/;
