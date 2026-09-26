// The analytics service: the only path from application code to providers.
//
//   track(event, props)
//     → validate name → sanitize props → ensure session (emits lifecycle)
//     → enrich (identity, session, page, device, campaign, app) → debug log
//     → per-provider: deliver, or queue until that provider is ready.
//
// Every public method is wrapped so analytics can never throw into the app,
// and every provider call is isolated so one failing SDK can't affect others.

import type {
  AnalyticsConfig,
  AnalyticsUser,
  AppContext,
  CampaignContext,
  Props,
  TrackPayload,
  UserTraits,
} from "./types";
import { AnalyticsEvent, type EventPropsMap, type TrackArgs } from "./events";
import type { AnalyticsProvider } from "./providers/provider";
import { buildProviders } from "./providers";
import { resolveConfig } from "./config";
import { OpQueue, type QueuedOp } from "./queue";
import { IdentityManager } from "./identity";
import { SessionManager, type SessionEvent, type StoredSession } from "./session";
import { captureAttribution } from "./campaign";
import {
  buildAppContext,
  emptyDevice,
  getDeviceContext,
  getPageContext,
} from "./context";
import { EVENT_NAME_PATTERN, sanitizeProps } from "./sanitize";
import { installClickTracking } from "./clicks";
import { STORAGE_KEYS, isBrowser, write } from "./storage";
import { logIdentify, logInfo, logTrack, logWarn } from "./debug";
import { isAppMode } from "@/lib/appMode";

interface ProviderSlot {
  provider: AnalyticsProvider;
  pending: OpQueue;
  disabled: boolean;
}

export class AnalyticsService {
  private config: AnalyticsConfig | null = null;
  private app: AppContext | null = null;
  private campaign: CampaignContext = {};
  private slots: ProviderSlot[] = [];
  private readonly identity = new IdentityManager();
  private session: SessionManager | null = null;
  private initialized = false;
  private debugOn = false;

  /* ------------------------------- public ------------------------------- */

  init(): void {
    this.safe("init", () => this.doInit());
  }

  track<E extends AnalyticsEvent>(event: E, ...args: TrackArgs<E>): void {
    const props = (args[0] ?? {}) as Props;
    this.safe(`track ${event}`, () => this.doTrack(event, props));
  }

  /**
   * Track an SDK-generated event whose name is derived at runtime — per-element
   * clicks (`NEW_CHAT_CLICK`) and popup lifecycles
   * (`QUIZ_DASHBOARD_DIALOG_OPENED`). `group` lands on the event as
   * `event_group` so all clicks / popups can still be aggregated together.
   * Application code should use the typed `track()` instead.
   */
  trackNamed<P extends object>(
    event: string,
    props: P,
    group: "click" | "popup_opened" | "popup_closed",
  ): void {
    this.safe(`track ${event}`, () =>
      this.doTrack(event, { ...(props as Props), event_group: group }),
    );
  }

  identify(user: AnalyticsUser): void {
    this.safe("identify", () => this.doIdentify(user));
  }

  reset(): void {
    this.safe("reset", () => this.doReset());
  }

  flush(): void {
    this.safe("flush", () => {
      for (const s of this.slots) {
        if (!s.disabled && s.provider.isReady()) this.call(s, () => s.provider.flush?.());
      }
    });
  }

  get debug(): boolean {
    return this.debugOn;
  }

  setDebug(on: boolean): void {
    this.debugOn = on;
    write(STORAGE_KEYS.debug, on ? "1" : null);
  }

  isReady(): boolean {
    return this.slots.some((s) => !s.disabled && s.provider.isReady());
  }

  getAnonymousId(): string | null {
    return isBrowser() ? this.identity.getAnonymousId() : null;
  }

  getDeviceId(): string | null {
    return isBrowser() ? this.identity.getDeviceId() : null;
  }

  getSession(): StoredSession | null {
    return this.session?.get() ?? null;
  }

  /* ------------------------------ internals ----------------------------- */

  private safe(label: string, fn: () => void): void {
    if (!isBrowser()) return;
    try {
      fn();
    } catch (err) {
      if (this.debugOn) logWarn(`${label} failed`, err);
    }
  }

  private ensureInit(): void {
    if (!this.initialized) this.doInit();
  }

  private doInit(): void {
    if (this.initialized) return;
    this.initialized = true;

    const config = resolveConfig();
    this.config = config;
    this.debugOn = config.debug;
    this.app = buildAppContext(
      config.appEnv,
      config.appVersion,
      config.buildId,
      isAppMode(),
    );
    this.campaign = captureAttribution();
    this.session = new SessionManager(config.sessionTimeoutMs, config.sessionMaxAgeMs);
    this.session.installListeners();
    const anonymousId = this.identity.getAnonymousId();
    const deviceId = this.identity.getDeviceId();

    this.exposeDebugHandle();
    installClickTracking((name, props) => this.trackNamed(name, props, "click"));

    if (!config.enabled) {
      if (this.debugOn) logInfo("disabled (no provider key) — events log only");
      return;
    }

    for (const provider of buildProviders(config)) {
      const slot: ProviderSlot = { provider, pending: new OpQueue(), disabled: false };
      this.slots.push(slot);
      const onReady = () => this.drain(slot);
      let result: void | Promise<void>;
      try {
        result = provider.init(config, { anonymousId, deviceId, onReady });
      } catch (err) {
        this.disable(slot, err);
        continue;
      }
      if (result && typeof result.then === "function") {
        result.catch((err) => this.disable(slot, err));
      }
    }
  }

  private disable(slot: ProviderSlot, err: unknown): void {
    slot.disabled = true;
    slot.pending.drain();
    if (this.debugOn) logWarn(`provider ${slot.provider.name} disabled`, err);
  }

  private call(slot: ProviderSlot, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      if (this.debugOn) logWarn(`provider ${slot.provider.name} threw`, err);
    }
  }

  /** Deliver an op to every provider, queueing for those not ready yet. */
  private dispatch(op: QueuedOp): void {
    for (const slot of this.slots) {
      if (slot.disabled) continue;
      if (!slot.provider.isReady()) {
        slot.pending.push(op);
        continue;
      }
      this.apply(slot, op);
    }
  }

  private apply(slot: ProviderSlot, op: QueuedOp): void {
    this.call(slot, () => {
      if (op.kind === "track") slot.provider.track(op.payload);
      else if (op.kind === "identify") slot.provider.identify(op.userId, op.traits);
      else slot.provider.reset(op.newAnonymousId);
    });
  }

  private drain(slot: ProviderSlot): void {
    if (slot.disabled) return;
    const ops = slot.pending.drain();
    if (this.debugOn) {
      logInfo(
        `provider ${slot.provider.name} ready — replaying ${ops.length} queued op(s)` +
          (slot.pending.dropped ? ` (${slot.pending.dropped} dropped)` : ""),
      );
    }
    for (const op of ops) this.apply(slot, op);
  }

  private doTrack(event: string, rawProps: Props): void {
    this.ensureInit();
    if (!EVENT_NAME_PATTERN.test(event)) {
      if (this.debugOn) logWarn(`invalid event name "${event}" — dropped`);
      return;
    }
    const { props, dropped } = sanitizeProps(event, rawProps);
    if (dropped.length && this.debugOn) {
      logWarn(`${event}: dropped disallowed prop(s) ${dropped.join(", ")}`);
    }

    // Session lifecycle first so `SESSION_ENDED`/`SESSION_STARTED` precede
    // the event that woke the session up.
    for (const ev of this.session!.ensure()) this.emitSessionEvent(ev);

    const payload = this.build(event, props);
    this.session!.recordEvent(payload.page.path);
    this.emit(payload);
  }

  private emitSessionEvent(ev: SessionEvent): void {
    const s = ev.session;
    if (ev.kind === "started") {
      const last = this.campaign.last_touch;
      const payload = this.build(AnalyticsEvent.SESSION_STARTED, {
        entry_page: s.entry_path,
        referrer_domain: last?.referrer_domain,
        utm_source: last?.utm_source,
        utm_medium: last?.utm_medium,
        utm_campaign: last?.utm_campaign,
        is_new_visitor: s.number === 1,
      });
      // The started event belongs to the new session; build() already read it.
      this.emit(payload);
      return;
    }
    const endedAt = s.last_active_at;
    const payload = this.build(
      AnalyticsEvent.SESSION_ENDED,
      {
        duration_s: Math.max(0, Math.round((endedAt - s.started_at) / 1000)),
        event_count: s.event_count,
        exit_page: s.last_path || undefined,
        reason: ev.reason ?? "timeout",
      },
      s,
      new Date(endedAt).toISOString(),
    );
    this.emit(payload);
  }

  private build(
    event: string,
    props: Props,
    sessionOverride?: StoredSession,
    timestamp?: string,
  ): TrackPayload {
    const s = sessionOverride ?? this.session!.get();
    const userId = this.identity.getUserId();
    return {
      event,
      timestamp: timestamp ?? new Date().toISOString(),
      props,
      identity: {
        device_id: this.identity.getDeviceId(),
        anonymous_id: this.identity.getAnonymousId(),
        user_id: userId ?? undefined,
      },
      session: s
        ? { id: s.id, number: s.number, started_at: new Date(s.started_at).toISOString() }
        : { id: "", number: 0, started_at: "" },
      page: getPageContext(),
      device: isBrowser() ? getDeviceContext() : emptyDevice(),
      campaign: this.campaign,
      app: this.app!,
    };
  }

  private emit(payload: TrackPayload): void {
    if (this.debugOn) logTrack(payload);
    if (!this.config?.enabled) return;
    this.dispatch({ kind: "track", payload });
  }

  private doIdentify(user: AnalyticsUser): void {
    this.ensureInit();
    if (!user?.id) return;
    const extra: Partial<UserTraits> = {
      device_id: this.identity.getDeviceId(),
      is_app_mode: this.app?.is_app_mode,
      app_env: this.config?.appEnv,
    };
    const { userChanged, traitsChanged, traits } = this.identity.identify(user, extra);
    if (!userChanged && !traitsChanged) return;
    if (this.debugOn) logIdentify(user.id, traits);
    if (!this.config?.enabled) return;
    this.dispatch({ kind: "identify", userId: user.id, traits });
  }

  private doReset(): void {
    this.ensureInit();
    // End the session while it is still attributed to the user…
    const events = this.session!.rotate("logout");
    const ended = events.find((e) => e.kind === "ended");
    if (ended) this.emitSessionEvent(ended);
    // …then forget the user and start the new anonymous session.
    const newAnonymousId = this.identity.reset();
    if (this.debugOn) logInfo("reset → new anonymous id", newAnonymousId);
    if (this.config?.enabled) this.dispatch({ kind: "reset", newAnonymousId });
    const started = events.find((e) => e.kind === "started");
    if (started) this.emitSessionEvent(started);
  }

  private exposeDebugHandle(): void {
    try {
      const handle = {} as NonNullable<Window["__aeva_analytics"]>;
      Object.defineProperties(handle, {
        debug: {
          get: () => this.debugOn,
          set: (on: boolean) => this.setDebug(!!on),
          enumerable: true,
        },
        session: { get: () => this.getSession(), enumerable: true },
        anonymousId: { get: () => this.getAnonymousId(), enumerable: true },
        deviceId: { get: () => this.getDeviceId(), enumerable: true },
        ready: { get: () => this.isReady(), enumerable: true },
      });
      (window as Window & { __aeva_analytics?: unknown }).__aeva_analytics =
        handle;
    } catch {
      /* ignore */
    }
  }
}

export type { EventPropsMap };
