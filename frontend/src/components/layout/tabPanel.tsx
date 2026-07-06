import { createContext, useContext } from "react";

/**
 * Present (with `active`) only while a page renders inside a mobile keep-alive
 * tab panel. `null` means the page is rendered normally (desktop, or a non-tab
 * Outlet route), so shared hooks keep their pre-keep-alive behavior.
 */
export const TabPanelContext = createContext<{ active: boolean } | null>(null);

/** True when the calling page is rendered inside a keep-alive tab panel. */
export function useTabHosted(): boolean {
  return useContext(TabPanelContext) !== null;
}
