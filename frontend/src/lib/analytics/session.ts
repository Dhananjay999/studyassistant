// Analytics sessions (independent of the auth session and of PostHog's own
// `$session_id`, which is forwarded separately for replay linking).
//
// Rules:
//   • A session starts on the first event when none is stored, when the last
//     activity was > 30 min ago, or when the session is > 24 h old.
//   • `session_number` increments per new session on this browser profile.
//   • Activity is bumped on every tracked event and by a throttled listener on
//     user interaction; storage writes are throttled to 5 s.
//   • `session_ended` is emitted lazily — by whichever page load/tab next
//     starts a session and finds the previous one expired — with the old
//     session's duration, event count and last page. No timers, nothing on
//     unload. Logout ends the session immediately with `reason: "logout"`.
//   • Cross-tab: the `storage` event keeps tabs on the same session.

import { STORAGE_KEYS, readJSON, randomId, writeJSON, isBrowser } from "./storage";

export interface StoredSession {
  id: string;
  number: number;
  started_at: number; // epoch ms
  last_active_at: number;
  entry_path: string;
  last_path: string;
  event_count: number;
}

export interface SessionEvent {
  kind: "started" | "ended";
  session: StoredSession;
  reason?: "timeout" | "logout";
}

const WRITE_THROTTLE_MS = 5_000;
const ACTIVITY_THROTTLE_MS = 10_000;

export class SessionManager {
  private current: StoredSession | null = null;
  private lastWrite = 0;
  private lastActivityBump = 0;
  private endedIds = new Set<string>();
  private listenersInstalled = false;

  constructor(
    private readonly timeoutMs: number,
    private readonly maxAgeMs: number,
  ) {}

  /**
   * Ensure a live session exists; returns any lifecycle events the caller
   * must emit (ended for the stale one, started for the new one) in order.
   */
  ensure(now = Date.now()): SessionEvent[] {
    const events: SessionEvent[] = [];
    if (!this.current) this.current = readJSON<StoredSession>(STORAGE_KEYS.session);

    const s = this.current;
    const stale =
      !s ||
      now - s.last_active_at > this.timeoutMs ||
      now - s.started_at > this.maxAgeMs;

    if (!stale) return events;

    if (s && !this.endedIds.has(s.id)) {
      this.endedIds.add(s.id);
      events.push({ kind: "ended", session: s, reason: "timeout" });
    }
    const next = this.start(s ? s.number + 1 : 1, now);
    events.push({ kind: "started", session: next });
    return events;
  }

  private start(number: number, now: number): StoredSession {
    const path = isBrowser() ? window.location.pathname : "";
    this.current = {
      id: `sess_${randomId()}`,
      number,
      started_at: now,
      last_active_at: now,
      entry_path: path,
      last_path: path,
      event_count: 0,
    };
    this.persist(true);
    return this.current;
  }

  /** Called by the service for every tracked event. */
  recordEvent(path: string, now = Date.now()): void {
    if (!this.current) return;
    this.current.event_count += 1;
    this.current.last_active_at = now;
    if (path) this.current.last_path = path;
    this.persist(false, now);
  }

  /** Bump activity without an event (user interaction). */
  touch(now = Date.now()): void {
    if (!this.current) return;
    if (now - this.lastActivityBump < ACTIVITY_THROTTLE_MS) return;
    this.lastActivityBump = now;
    this.current.last_active_at = now;
    this.persist(false, now);
  }

  /** End the current session now (logout) and start a fresh one. */
  rotate(reason: "logout", now = Date.now()): SessionEvent[] {
    const events: SessionEvent[] = [];
    const s = this.current ?? readJSON<StoredSession>(STORAGE_KEYS.session);
    if (s && !this.endedIds.has(s.id)) {
      this.endedIds.add(s.id);
      events.push({ kind: "ended", session: s, reason });
    }
    const next = this.start(s ? s.number + 1 : 1, now);
    events.push({ kind: "started", session: next });
    return events;
  }

  get(): StoredSession | null {
    return this.current;
  }

  persist(force: boolean, now = Date.now()): void {
    if (!this.current) return;
    if (!force && now - this.lastWrite < WRITE_THROTTLE_MS) return;
    this.lastWrite = now;
    writeJSON(STORAGE_KEYS.session, this.current);
  }

  /** Interaction + lifecycle listeners (installed once, browser only). */
  installListeners(): void {
    if (this.listenersInstalled || !isBrowser()) return;
    this.listenersInstalled = true;

    const onActivity = () => this.touch();
    for (const evt of ["pointerdown", "keydown", "scroll", "touchstart"]) {
      window.addEventListener(evt, onActivity, { passive: true, capture: true });
    }

    const flush = () => this.persist(true);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
    window.addEventListener("pageshow", () => this.touch());

    // Another tab advanced the session: adopt it (never roll back).
    window.addEventListener("storage", (e) => {
      if (e.key !== STORAGE_KEYS.session || !e.newValue) return;
      try {
        const other = JSON.parse(e.newValue) as StoredSession;
        if (!this.current || other.number >= this.current.number) {
          this.current = other;
        }
      } catch {
        /* ignore */
      }
    });
  }
}
