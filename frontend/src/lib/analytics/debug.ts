// Console output for debug mode. Never logs raw PII: emails are masked.

import type { TrackPayload, UserTraits } from "./types";

const PREFIX = "[analytics]";

export function maskEmail(email: string | undefined): string | undefined {
  if (!email) return email;
  const [local, domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain.slice(0, 1)}***`;
}

function group(title: string, body: () => void): void {
  try {
    if (typeof console.groupCollapsed === "function") {
      console.groupCollapsed(title);
      body();
      console.groupEnd();
    } else {
      console.log(title);
      body();
    }
  } catch {
    /* logging must never throw */
  }
}

export function logTrack(payload: TrackPayload): void {
  group(`${PREFIX} ${payload.event}`, () => {
    console.log("session", payload.session.id, "#" + payload.session.number);
    console.log(
      "identity",
      payload.identity.user_id ?? "(anonymous)",
      payload.identity.anonymous_id,
    );
    console.log("page", payload.page.name, payload.page.path);
    console.log("props", payload.props);
    console.log("context", {
      device: payload.device,
      campaign: payload.campaign,
      app: payload.app,
      timestamp: payload.timestamp,
    });
  });
}

export function logIdentify(userId: string, traits: UserTraits): void {
  group(`${PREFIX} identify ${userId}`, () => {
    console.log("traits", { ...traits, email: maskEmail(traits.email) });
  });
}

export function logInfo(message: string, ...rest: unknown[]): void {
  try {
    console.log(`${PREFIX} ${message}`, ...rest);
  } catch {
    /* ignore */
  }
}

export function logWarn(message: string, ...rest: unknown[]): void {
  try {
    console.warn(`${PREFIX} ${message}`, ...rest);
  } catch {
    /* ignore */
  }
}
