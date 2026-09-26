// localStorage access that never throws and is a no-op on the server
// (public pages are prerendered). Mirrors the private helpers in appMode.ts.

export const STORAGE_KEYS = {
  anonymousId: "aeva_anonymous_id",
  deviceId: "aeva_device_id",
  session: "aeva_analytics_session",
  attribution: "aeva_attribution",
  debug: "aeva_analytics_debug",
} as const;

/** One key per page load: `aeva_analytics_outbox:<id>` (see outbox.ts). */
export const OUTBOX_PREFIX = "aeva_analytics_outbox:";

export function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

export function read(key: string): string | null {
  if (!isBrowser()) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function write(key: string, value: string | null): void {
  if (!isBrowser()) return;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Private mode / quota / disabled storage — analytics simply won't persist.
  }
}

/** Cookie name for the device id backup (survives a localStorage wipe). */
export const DEVICE_COOKIE = "aeva_did";

export function readCookie(name: string): string | null {
  if (!isBrowser()) return null;
  try {
    const m = document.cookie.match(
      new RegExp("(?:^|; )" + name.replace(/[$()*+.?[\\\]^{|}]/g, "\\$&") + "=([^;]*)"),
    );
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

export function writeCookie(name: string, value: string, days: number): void {
  if (!isBrowser()) return;
  try {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie =
      `${name}=${encodeURIComponent(value)}; Max-Age=${days * 86400}` +
      `; Path=/; SameSite=Lax${secure}`;
  } catch {
    /* cookies blocked — localStorage still holds the value */
  }
}

/** All localStorage keys starting with `prefix` (empty when unavailable). */
export function readKeys(prefix: string): string[] {
  if (!isBrowser()) return [];
  try {
    const out: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(prefix)) out.push(k);
    }
    return out;
  } catch {
    return [];
  }
}

export function readJSON<T>(key: string): T | null {
  const raw = read(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeJSON(key: string, value: unknown): void {
  try {
    write(key, JSON.stringify(value));
  } catch {
    /* unserialisable — skip */
  }
}

/** RFC4122-ish id with a fallback for WebViews lacking crypto.randomUUID. */
export function randomId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
