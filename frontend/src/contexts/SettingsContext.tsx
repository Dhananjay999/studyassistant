import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { SettingsSectionId } from "@/components/settings/types";

/**
 * Controls the global Settings/Profile overlay. A single source of truth so any
 * entry point (desktop sidebar avatar, mobile profile tab, a future deep link)
 * opens the exact same experience.
 *
 * `dirty` lets a section flag unsaved edits; the shell reads it to warn before
 * closing or switching sections. Keeping it here (rather than per-section) makes
 * the discard-guard work uniformly as new editable sections are added.
 */
interface SettingsContextValue {
  isOpen: boolean;
  section: SettingsSectionId;
  dirty: boolean;
  open: (section?: SettingsSectionId) => void;
  close: () => void;
  setSection: (section: SettingsSectionId) => void;
  setDirty: (dirty: boolean) => void;
}

const DEFAULT_SECTION: SettingsSectionId = "account";

const SettingsContext = createContext<SettingsContextValue | undefined>(
  undefined,
);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [section, setSectionState] = useState<SettingsSectionId>(
    DEFAULT_SECTION,
  );
  const [dirty, setDirty] = useState(false);

  const open = useCallback((next?: SettingsSectionId) => {
    if (next) setSectionState(next);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setDirty(false);
  }, []);

  const setSection = useCallback((next: SettingsSectionId) => {
    setSectionState(next);
    setDirty(false);
  }, []);

  const value = useMemo<SettingsContextValue>(
    () => ({ isOpen, section, dirty, open, close, setSection, setDirty }),
    [isOpen, section, dirty, open, close, setSection],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
