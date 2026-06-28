import { AnimatePresence } from "framer-motion";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSettings } from "@/contexts/SettingsContext";
import { SettingsModal } from "./SettingsModal";
import { SettingsMobile } from "./SettingsMobile";

/**
 * Single global mount point for the Settings/Profile experience. Renders the
 * desktop two-pane modal or the mobile full-screen page depending on viewport,
 * both driven by the same SettingsContext so every entry point is consistent.
 */
export function SettingsExperience() {
  const isMobile = useIsMobile();
  const { isOpen } = useSettings();

  if (isMobile) {
    return (
      <AnimatePresence>{isOpen && <SettingsMobile />}</AnimatePresence>
    );
  }

  return <SettingsModal />;
}
