// Shared types for the analytics SDK. Nothing here touches the browser, so
// the file is safe to import from the SSR/prerender bundle.

/** Scalar values allowed on events. */
export type Primitive = string | number | boolean | null | undefined;
/** Event properties: scalars, small arrays of scalars, or one level of nesting. */
export type PropValue = Primitive | Primitive[] | Record<string, Primitive>;
export type Props = Record<string, PropValue>;

/** What `identify()` accepts — the `/auth/me` shape works directly. */
export interface AnalyticsUser {
  id: string;
  email: string;
  full_name?: string | null;
  personalization_status?: string;
  is_debug_user?: boolean;
}

/** Person-level traits sent to providers on identify (never on events). */
export interface UserTraits {
  email?: string;
  name?: string;
  device_id?: string;
  personalization_status?: string;
  is_debug_user?: boolean;
  is_app_mode?: boolean;
  app_env?: string;
}

export interface AnalyticsConfig {
  /** Master switch: false disables every provider and turns track() into a no-op. */
  enabled: boolean;
  /** Console logging of every event (see config.ts for the rules). */
  debug: boolean;
  posthogKey: string | null;
  posthogHost: string;
  appEnv: string;
  appVersion: string;
  buildId: string;
  /** Inactivity after which a new analytics session starts. */
  sessionTimeoutMs: number;
  /** Absolute session length cap. */
  sessionMaxAgeMs: number;
}

export interface SessionContext {
  id: string;
  number: number;
  started_at: string;
}

export interface IdentityContext {
  /** Never rotates for a browser profile (localStorage + cookie backup). */
  device_id: string;
  /** Rotates on logout; bootstraps PostHog's distinct id. */
  anonymous_id: string;
  user_id?: string;
}

export interface PageContext {
  path: string;
  url: string;
  title: string;
  name: string;
  referrer: string;
}

export interface DeviceContext {
  device_type: "mobile" | "tablet" | "desktop";
  os: string;
  browser: string;
  browser_version: string;
  screen_width: number;
  screen_height: number;
  viewport_width: number;
  viewport_height: number;
  language: string;
  timezone: string;
  connection_type?: string;
  online?: boolean;
}

export interface CampaignTouch {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  referrer_domain?: string;
  landing_page?: string;
  at: string;
}

export interface CampaignContext {
  first_touch?: CampaignTouch;
  last_touch?: CampaignTouch;
}

export interface AppContext {
  env: string;
  version: string;
  build_id: string;
  platform: "web";
  is_app_mode: boolean;
}

/**
 * How a batch should be delivered. `urgent` means the page may be going away
 * (hidden, unloading, logging out): send now, with sendBeacon, no batching.
 */
export interface DeliveryHint {
  urgent: boolean;
}

/** The fully enriched event handed to every provider. */
export interface TrackPayload {
  /** UUID minted at track time; survives replay so providers can de-duplicate. */
  id: string;
  event: string;
  timestamp: string;
  props: Props;
  identity: IdentityContext;
  session: SessionContext;
  page: PageContext;
  device: DeviceContext;
  campaign: CampaignContext;
  app: AppContext;
}

/** Provider-facing flat property bag (what PostHog/GA actually receive). */
export type FlatProps = Record<string, Primitive | Primitive[]>;
