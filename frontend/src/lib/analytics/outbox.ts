// Batched, persistent delivery buffer between the service and the providers.
//
// Two promises to the user:
//   1. Tracking never adds latency to an interaction. `track()` only appends
//      to this buffer; the provider work (PostHog property calculation,
//      persistence, network) runs later in a browser idle slot.
//   2. Nothing is lost. Pending events are mirrored to localStorage as they
//      arrive, pushed out immediately over `sendBeacon` when the tab is
//      hidden or unloaded, and anything a dead tab left behind is replayed
//      by the next page load with the original timestamps and event ids.
//
// Drain triggers:
//   • BATCH_SIZE pending                       → next idle slot (≤ 250 ms)
//   • BATCH_INTERVAL_MS since the first pending → next idle slot (≤ 1 s)
//   • tab hidden / pagehide / freeze / flush() / identify / logout → now,
//     urgent (providers send with sendBeacon, no batching)
//   • an event tracked while the tab is already hidden → now, urgent
//
// Each page load owns one localStorage key (`aeva_analytics_outbox:<id>`).
// A live tab never holds pending events for more than a few seconds, so a
// key older than DEAD_TAB_AFTER_MS belongs to a tab that died before it could
// drain; `recover()` picks those up. Duplicates are preferred over losses:
// every payload carries a uuid, so PostHog can de-duplicate a rare replay.

import type { DeliveryHint, TrackPayload } from "./types";
import {
  OUTBOX_PREFIX,
  isBrowser,
  randomId,
  read,
  readKeys,
  write,
} from "./storage";

/**
 * Hands a batch to the providers. Returns false when nobody can take it yet
 * (every live provider is still loading); the outbox then keeps the batch,
 * persisted, and retries.
 */
export type DrainHandler = (batch: TrackPayload[], hint: DeliveryHint) => boolean;

export const BATCH_SIZE = 20;
export const BATCH_INTERVAL_MS = 5_000;
export const DEAD_TAB_AFTER_MS = 60_000;
const IDLE_TIMEOUT_MS = 1_000;
const SOON_TIMEOUT_MS = 250;
const MAX_PENDING = 200;

interface StoredOutbox {
  /** Last write time; a stale record means its tab is gone. */
  t: number;
  items: TrackPayload[];
}

function isPayload(x: unknown): x is TrackPayload {
  return (
    !!x &&
    typeof x === "object" &&
    typeof (x as TrackPayload).event === "string" &&
    typeof (x as TrackPayload).timestamp === "string" &&
    typeof (x as TrackPayload).props === "object"
  );
}

export class Outbox {
  private pending: TrackPayload[] = [];
  private timer: number | null = null;
  private idle: number | null = null;
  private idleIsTimeout = false;
  private persistQueued = false;
  private readonly key = OUTBOX_PREFIX + randomId();
  /** Events discarded because the buffer overflowed (debug only). */
  dropped = 0;

  constructor(private readonly deliver: DrainHandler) {}

  /** Lifecycle listeners: leave nothing behind when the page goes away. */
  install(): void {
    if (!isBrowser()) return;
    const urgent = () => this.drain(true);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") urgent();
    });
    window.addEventListener("pagehide", urgent);
    // Page Lifecycle API (Chrome): tab is about to be frozen in the background.
    document.addEventListener("freeze", urgent);
  }

  get size(): number {
    return this.pending.length;
  }

  push(payload: TrackPayload): void {
    if (this.pending.length >= MAX_PENDING) {
      this.pending.shift();
      this.dropped += 1;
    }
    this.pending.push(payload);
    this.persistSoon();

    // No interaction to protect while hidden — and background timers are
    // throttled — so send straight away.
    if (document.visibilityState === "hidden") {
      this.drain(true);
      return;
    }
    if (this.pending.length >= BATCH_SIZE) this.scheduleIdle(SOON_TIMEOUT_MS);
    else this.scheduleTimer();
  }

  /**
   * Hand everything pending to the providers now. `urgent` means the page
   * may be going away: providers should send immediately with sendBeacon.
   */
  drain(urgent = false): void {
    this.cancelScheduled();
    if (!this.pending.length) return;
    const batch = this.pending;
    this.pending = [];
    if (!this.deliver(batch, { urgent })) {
      // Providers still loading: keep the batch (persisted) and try again.
      this.pending = batch.concat(this.pending);
      this.persistNow();
      this.scheduleTimer();
      return;
    }
    this.persistNow();
  }

  /**
   * Take over the outboxes of tabs that died before draining and queue their
   * events here (persisted under this tab's key until delivered). Returns
   * how many were recovered.
   */
  recover(now = Date.now()): number {
    if (!isBrowser()) return 0;
    const found: TrackPayload[] = [];
    for (const key of readKeys(OUTBOX_PREFIX)) {
      if (key === this.key) continue;
      const raw = read(key);
      let record: StoredOutbox | null = null;
      try {
        record = raw ? (JSON.parse(raw) as StoredOutbox) : null;
      } catch {
        record = null;
      }
      if (!record || typeof record.t !== "number" || !Array.isArray(record.items)) {
        write(key, null);
        continue;
      }
      // Recently written: a live tab still owns it.
      if (now - record.t < DEAD_TAB_AFTER_MS) continue;
      write(key, null);
      for (const item of record.items) if (isPayload(item)) found.push(item);
    }
    if (!found.length) return 0;
    found.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
    for (const payload of found) this.push(payload);
    return found.length;
  }

  /* ----------------------------- scheduling ---------------------------- */

  private scheduleTimer(): void {
    if (this.timer !== null || this.idle !== null) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.scheduleIdle(IDLE_TIMEOUT_MS);
    }, BATCH_INTERVAL_MS);
  }

  /** Run the drain when the main thread is idle, but no later than `timeout`. */
  private scheduleIdle(timeout: number): void {
    if (this.idle !== null) return;
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    const run = () => {
      this.idle = null;
      this.drain(false);
    };
    if (typeof window.requestIdleCallback === "function") {
      this.idleIsTimeout = false;
      this.idle = window.requestIdleCallback(run, { timeout });
    } else {
      this.idleIsTimeout = true;
      this.idle = window.setTimeout(run, 0);
    }
  }

  private cancelScheduled(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.idle !== null) {
      if (this.idleIsTimeout) window.clearTimeout(this.idle);
      else if (typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(this.idle);
      }
      this.idle = null;
    }
  }

  /* ---------------------------- persistence ---------------------------- */

  /** One localStorage write per task, however many events it tracked. */
  private persistSoon(): void {
    if (this.persistQueued) return;
    this.persistQueued = true;
    queueMicrotask(() => {
      this.persistQueued = false;
      this.persistNow();
    });
  }

  private persistNow(): void {
    if (!this.pending.length) {
      write(this.key, null);
      return;
    }
    const record: StoredOutbox = { t: Date.now(), items: this.pending };
    try {
      write(this.key, JSON.stringify(record));
    } catch {
      /* unserialisable — memory copy still drains normally */
    }
  }
}
