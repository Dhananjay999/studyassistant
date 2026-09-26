// PostHog adapter. The SDK is imported dynamically so it stays out of the
// initial bundle and the prerender build. Our anonymous id bootstraps
// PostHog's distinct id, which makes `identify(user_id)` merge the pre-login
// trail into the person.
//
// Mapping: page_entry → `$pageview`, page_exit → `$pageleave` (so Web
// Analytics and session replay keep working with autocapture pageviews off);
// everything else is captured under its own snake_case name.

import type { PostHog } from "posthog-js";
import type { AnalyticsConfig, TrackPayload, UserTraits } from "../types";
import type { AnalyticsProvider, ProviderInitContext } from "./provider";
import { flatten } from "../flatten";
import { AnalyticsEvent } from "../events";

export class PostHogProvider implements AnalyticsProvider {
  readonly name = "posthog" as const;
  private ph: PostHog | null = null;
  private ready = false;

  async init(config: AnalyticsConfig, ctx: ProviderInitContext): Promise<void> {
    if (!config.posthogKey) throw new Error("posthog key missing");
    const { default: posthog } = await import("posthog-js");
    posthog.init(config.posthogKey, {
      api_host: config.posthogHost,
      defaults: "2026-05-30",
      bootstrap: { distinctID: ctx.anonymousId },
      // We emit page lifecycle ourselves (route tracker) and map it below.
      capture_pageview: false,
      capture_pageleave: false,
      // Explicit `data-analytics-id` clicks only; rage clicks stay useful.
      autocapture: false,
      rageclick: true,
      capture_exceptions: true,
      persistence: "localStorage+cookie",
      // Anonymous visitors get person profiles so pre-login journeys can be
      // reconstructed. Billable per person — switch to "identified_only" to
      // trade that for cost.
      person_profiles: "always",
      request_batching: true,
      debug: false,
    });
    posthog.register({
      app_env: config.appEnv,
      app_version: config.appVersion,
      build_id: config.buildId,
      anonymous_id: ctx.anonymousId,
    });
    this.ph = posthog;
    this.ready = true;
    ctx.onReady();
  }

  isReady(): boolean {
    return this.ready && !!this.ph;
  }

  identify(userId: string, traits: UserTraits): void {
    // identify() with the same id and new props just updates the person —
    // no need to special-case setPersonProperties.
    this.ph?.identify(userId, traits as Record<string, unknown>);
  }

  reset(newAnonymousId: string): void {
    if (!this.ph) return;
    this.ph.reset();
    this.ph.register({ anonymous_id: newAnonymousId });
  }

  track(payload: TrackPayload): void {
    if (!this.ph) return;
    const flat = flatten(payload);
    const sessionId = this.ph.get_session_id?.();
    if (sessionId) flat.posthog_session_id = sessionId;
    // Events may be replayed from the pre-init queue after navigation, so pin
    // URL-derived properties to the page the event happened on.
    const common = {
      ...flat,
      $current_url: payload.page.url,
      $pathname: payload.page.path,
    };
    const options = { timestamp: new Date(payload.timestamp) };

    switch (payload.event) {
      case AnalyticsEvent.PAGE_ENTRY:
        this.ph.capture(
          "$pageview",
          { ...common, $referrer: payload.page.referrer, $title: payload.page.title },
          options,
        );
        return;
      case AnalyticsEvent.PAGE_EXIT:
        this.ph.capture("$pageleave", common, options);
        return;
      default:
        this.ph.capture(payload.event, common, options);
    }
  }

  // posthog-js already flushes its batch via sendBeacon on pagehide.
  flush(): void {}
}
