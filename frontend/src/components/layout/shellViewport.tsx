import { createContext, useContext, type ReactNode } from "react";

/**
 * Shell viewport facts shared by {@link AppLayout}, the keep-alive tab host,
 * and the tab route elements. Both the host and the router read this from ONE
 * value on the same render, so they can never disagree about whether the mobile
 * shell is active — which is exactly what prevents a tab page from mounting
 * twice (once in the host and once through the Outlet).
 */
export interface ShellViewport {
  /** The bottom-nav (mobile) shell is showing. */
  isMobileShell: boolean;
  /** The tab path matching the current route, or `null` on a non-tab route. */
  activeTab: string | null;
}

const ShellViewportContext = createContext<ShellViewport>({
  isMobileShell: false,
  activeTab: null,
});

export function ShellViewportProvider({
  value,
  children,
}: {
  value: ShellViewport;
  children: ReactNode;
}) {
  return (
    <ShellViewportContext.Provider value={value}>
      {children}
    </ShellViewportContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useShellViewport(): ShellViewport {
  return useContext(ShellViewportContext);
}
