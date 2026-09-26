// localStorage access that never throws and is a no-op on the server
// (public pages are prerendered). Mirrors the private helpers in appMode.ts.

export const STORAGE_KEYS = {
  anonymousId: "aeva_anonymous_id",
  session: "aeva_analytics_session",
  attribution: "aeva_attribution",
  debug: "aeva_analytics_debug",
} as const;

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
