import { Info, Keyboard, Palette, GraduationCap, User } from "lucide-react";
import type { SettingsSection, SettingsSectionId } from "./types";
import { AccountSection } from "./sections/AccountSection";
import { LearningProfileSection } from "./sections/LearningProfileSection";
import { AppearanceSection } from "./sections/AppearanceSection";
import { ShortcutsSection } from "./sections/ShortcutsSection";
import { AboutSection } from "./sections/AboutSection";

/**
 * The settings section registry — single source of truth for the left nav and
 * the content panel. Add a section by implementing it under ./sections and
 * appending an entry here (plus its id in ./types); both desktop and mobile
 * shells pick it up automatically.
 */
export const SETTINGS_SECTIONS: ReadonlyArray<SettingsSection> = [
  { id: "account", label: "Account", icon: User, Component: AccountSection },
  {
    id: "learning",
    label: "Learning Profile",
    icon: GraduationCap,
    Component: LearningProfileSection,
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: Palette,
    Component: AppearanceSection,
  },
  {
    id: "shortcuts",
    label: "Keyboard Shortcuts",
    icon: Keyboard,
    Component: ShortcutsSection,
  },
  { id: "about", label: "About", icon: Info, Component: AboutSection },
];

export function getSection(id: SettingsSectionId): SettingsSection {
  return (
    SETTINGS_SECTIONS.find((section) => section.id === id) ??
    SETTINGS_SECTIONS[0]
  );
}
