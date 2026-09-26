// Turns raw request/stream errors into calm, student-facing copy. Users should
// never see a stack trace or an HTTP status — just a friendly note and a way to
// try again. Keep the messages short and reassuring.

const HIGH_DEMAND =
  "⚠️ We're experiencing unusually high demand right now. Please try again in a few moments.";
const GENERIC =
  "⚠️ I couldn't complete your request due to a temporary issue. Please try again shortly.";
const OFFLINE =
  "⚠️ You appear to be offline. Check your connection and try again.";

export type ErrorKind = "offline" | "high_demand" | "generic";

/**
 * Bucket an error (or error message) for analytics and copy selection.
 * Never returns the raw message, so it is safe to send anywhere.
 */
export function errorKind(error: unknown): ErrorKind {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const text = raw.toLowerCase();

  if (
    typeof navigator !== "undefined" &&
    "onLine" in navigator &&
    !navigator.onLine
  ) {
    return "offline";
  }
  // Overloaded / rate-limited / temporarily unavailable → "high demand".
  if (
    /\b(429|503|502|overload|rate.?limit|quota|capacity|unavailable|too many)\b/.test(
      text,
    )
  ) {
    return "high_demand";
  }
  if (/\b(network|timeout|timed out|failed to fetch|connection)\b/.test(text)) {
    return "offline";
  }
  return "generic";
}

const COPY: Record<ErrorKind, string> = {
  offline: OFFLINE,
  high_demand: HIGH_DEMAND,
  generic: GENERIC,
};

/** Map an error (or error message) to friendly, non-technical copy. */
export function friendlyErrorMessage(error: unknown): string {
  return COPY[errorKind(error)];
}
