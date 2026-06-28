// Static metadata + reference data for the Settings experience.

/** App identity shown in the About section. Version/build are env-overridable
 *  so CI can stamp real values; links fall back to "#" until wired. */
export const APP_META = {
  name: "StudyAssistant",
  tagline: "Your personalized AI study companion, powered by Aeva.",
  version: (import.meta.env.VITE_APP_VERSION as string) || "1.0.0",
  build: (import.meta.env.VITE_BUILD_ID as string) || "local",
  links: {
    privacy: (import.meta.env.VITE_PRIVACY_URL as string) || "#",
    terms: (import.meta.env.VITE_TERMS_URL as string) || "#",
    feedback:
      (import.meta.env.VITE_FEEDBACK_URL as string) ||
      "mailto:feedback@aeva.app",
  },
} as const;

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
