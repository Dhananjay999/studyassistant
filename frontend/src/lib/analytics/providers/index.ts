// Provider registry. To add a destination: implement AnalyticsProvider, add
// its config to config.ts, and push it here when configured.

import type { AnalyticsConfig } from "../types";
import type { AnalyticsProvider } from "./provider";
import { PostHogProvider } from "./posthog";

export function buildProviders(config: AnalyticsConfig): AnalyticsProvider[] {
  const providers: AnalyticsProvider[] = [];
  if (config.posthogKey) providers.push(new PostHogProvider());
  // Later: GA4 (`VITE_GA_MEASUREMENT_ID`), custom DB (`/analytics/events`).
  return providers;
}

export type { AnalyticsProvider, ProviderName } from "./provider";
