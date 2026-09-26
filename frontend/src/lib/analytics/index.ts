/**
 * Centralized analytics SDK — the only module application code imports.
 *
 *   import { analytics, AnalyticsEvent, analyticsAttrs } from "@/lib/analytics";
 *
 *   analytics.track(AnalyticsEvent.CHAT_MESSAGE_SENT, { message_length: 42, … });
 *   analytics.identify(user);      // after login / boot restore
 *   analytics.reset();             // on logout
 *   <Button {...analyticsAttrs("sidebar.new_chat", "New chat", "sidebar")} />
 *
 * Every event is enriched with identity (anonymous_id / user_id), session,
 * page, device, campaign and app context, sanitized, logged in debug mode,
 * and fanned out to the configured providers (PostHog today). Calls never
 * throw and never block rendering; the SDK is safe to import during SSR.
 *
 * See README.md (how it works) and EVENTS.md (every event) in this folder.
 */

import { AnalyticsService } from "./service";

export const analytics = new AnalyticsService();

/** Called once from main.tsx after the first render. Safe to re-call. */
export function initAnalytics(): void {
  analytics.init();
}

/**
 * Data attributes for delegated click tracking. Spread onto any element;
 * works through shadcn `asChild` (Radix Slot forwards props).
 */
export function analyticsAttrs(
  id: string,
  name?: string,
  location?: string,
): {
  "data-analytics-id": string;
  "data-analytics-name"?: string;
  "data-analytics-location"?: string;
} {
  const attrs: ReturnType<typeof analyticsAttrs> = { "data-analytics-id": id };
  if (name) attrs["data-analytics-name"] = name;
  if (location) attrs["data-analytics-location"] = location;
  return attrs;
}

export { AnalyticsEvent, clickEventName, popupEventName } from "./events";
export type {
  EventPropsMap,
  ErrorKind,
  CtaLocation,
  AuthPromptTrigger,
  AuthPromptDismissVia,
  AuthPromptCta,
  LandingAuthPromptOutcome,
  ChatSource,
  ChatIntent,
  ItemType,
  PopupKind,
  PopupCloseVia,
  ClickProps,
  PopupOpenedProps,
  PopupClosedProps,
} from "./events";
export type { AnalyticsUser, TrackPayload } from "./types";
export { routeName } from "./routeName";
