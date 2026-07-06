import { SettingsModal } from "./SettingsModal";

/**
 * Global mount point for the DESKTOP Settings modal. On mobile there is no
 * overlay any more — Profile is a normal in-shell page (`/profile`), so the
 * only remaining settings surface is the desktop two-pane modal, driven by
 * SettingsContext. The modal renders nothing until opened, so mounting it on a
 * mobile viewport is harmless (mobile never calls `open()`).
 */
export function SettingsExperience() {
  return <SettingsModal />;
}
