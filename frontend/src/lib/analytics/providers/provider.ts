// Provider contract. Adding a destination (GA4, a custom DB, …) means
// implementing this and registering it in providers/index.ts — application
// code never changes.

import type {
  AnalyticsConfig,
  DeliveryHint,
  TrackPayload,
  UserTraits,
} from "../types";

export type ProviderName = "posthog" | "ga" | "custom";

export interface ProviderInitContext {
  anonymousId: string;
  /** Stable per-browser id; providers should expose it as their device id. */
  deviceId: string;
  /** Call once the provider can accept events; queued ops are replayed. */
  onReady: () => void;
}

export interface AnalyticsProvider {
  readonly name: ProviderName;
  /** May load an SDK asynchronously. A throw/rejection disables the provider. */
  init(config: AnalyticsConfig, ctx: ProviderInitContext): void | Promise<void>;
  identify(userId: string, traits: UserTraits): void;
  reset(newAnonymousId: string): void;
  /** `hint.urgent`: the page may be going away — send now via sendBeacon. */
  track(payload: TrackPayload, hint?: DeliveryHint): void;
  flush?(): void;
  isReady(): boolean;
}
