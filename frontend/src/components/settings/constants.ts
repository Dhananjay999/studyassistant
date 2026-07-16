// Static metadata + reference data for the Settings experience.

import { isAppMode } from "@/lib/appMode";

/** App identity shown in the About section. Version, build id, and
 *  environment are stamped by the build (vite.config.ts `define`) from
 *  package.json, CI/git metadata, and the deploy target — never hardcoded. */
export const APP_META = {
  name: "StudyAssistant",
  tagline: "Your personalized AI study companion, powered by Aeva.",
  version: __APP_VERSION__,
  build: __BUILD_ID__,
  environment: __BUILD_ENV__,
  links: {
    privacy: "/privacy",
    terms: "/terms",
  },
} as const;

/** Where bug reports and feature requests go. */
export const SUPPORT_EMAIL = "support@studyassistant.in";

/**
 * "Send Feedback" mailto: pre-filled recipient/subject plus the app version
 * and platform details, so reports arrive self-describing. Built at render
 * time (needs `navigator`), never at module scope — this module is also
 * bundled for the SSR prerender.
 */
export function feedbackMailto(): string {
  const platform =
    typeof navigator === "undefined" ? "unknown" : navigator.userAgent;
  const subject = `${APP_META.name} feedback`;
  const body = [
    "",
    "",
    "---- App info (please keep) ----",
    `Version: ${APP_META.version} (build ${APP_META.build}, ${APP_META.environment})`,
    `Shell: ${isAppMode() ? "mobile app" : "web"}`,
    `Platform: ${platform}`,
  ].join("\n");
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
    subject,
  )}&body=${encodeURIComponent(body)}`;
}

/** Keyboard shortcuts surfaced in the Shortcuts section. `keys` is passed to
 *  `formatShortcut` (use "mod" for the platform command key). Keep in sync with
 *  `useGlobalShortcuts` and the chat composer. */
export const SHORTCUTS: ReadonlyArray<{
  keys: string[];
  label: string;
}> = [
  { keys: ["mod", "F"], label: "Search" },
  { keys: ["mod", "N"], label: "New chat" },
  { keys: ["mod", "/"], label: "Open commands" },
  { keys: ["mod", "Enter"], label: "Send message" },
  { keys: ["Esc"], label: "Close dialog / dismiss" },
];
