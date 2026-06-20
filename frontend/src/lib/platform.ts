// Platform helpers for keyboard-shortcut hints (mac vs Windows/Linux).

export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPod|iPhone|iPad/.test(navigator.platform);
}

/**
 * Render a shortcut for display. Use "mod" for the platform command key.
 * formatShortcut(["mod", "K"]) -> "⌘K" on mac, "Ctrl+K" elsewhere.
 */
export function formatShortcut(keys: string[]): string {
  const mac = isMac();
  const mod = mac ? "⌘" : "Ctrl";
  const parts = keys.map((k) => (k === "mod" ? mod : k));
  return parts.join(mac ? "" : "+");
}

/** True when the platform command key (⌘ on mac, Ctrl elsewhere) is held. */
export function isModifier(e: KeyboardEvent | React.KeyboardEvent): boolean {
  return isMac() ? e.metaKey : e.ctrlKey;
}
