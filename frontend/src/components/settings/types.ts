import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";

/** Stable ids for each settings section. Adding a section = add an id here. */
export type SettingsSectionId =
  | "account"
  | "learning"
  | "appearance"
  | "shortcuts"
  | "about";

/** A registered settings section, rendered in the left nav and content panel. */
export interface SettingsSection {
  id: SettingsSectionId;
  label: string;
  icon: LucideIcon;
  /** Right-hand content panel. Receives nothing — sections read their own data. */
  Component: ComponentType;
}
