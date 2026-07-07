import { Suspense, useEffect, useState } from "react";
import { RouteSkeleton } from "@/components/layout/RouteSkeleton";
import { useShellViewport } from "@/components/layout/shellViewport";
import { TabPanelContext } from "@/components/layout/tabPanel";
import { TAB_PAGES, type TabPath } from "@/components/layout/tabPages";
import { cn } from "@/lib/utils";

/**
 * Mobile-only keep-alive host for the four bottom-nav tabs. Every tab the user
 * has visited stays MOUNTED; only its visibility toggles (`display`) with the
 * active tab. So each tab keeps its component state, native scroll position,
 * and — for chat — its in-flight SSE stream across tab switches.
 *
 * Renders nothing on desktop: there the router's `<Outlet/>` owns the pages and
 * unmounts them on navigation, exactly as before. A tab's lazy chunk loads only
 * on first visit (it's added to `visited` then), after which it never unmounts.
 */
export function MobileTabsHost() {
  const { isMobileShell, activeTab } = useShellViewport();
  const [visited, setVisited] = useState<TabPath[]>(() =>
    activeTab ? [activeTab as TabPath] : [],
  );

  useEffect(() => {
    if (activeTab && !visited.includes(activeTab as TabPath)) {
      setVisited((prev) => [...prev, activeTab as TabPath]);
    }
  }, [activeTab, visited]);

  if (!isMobileShell) return null;

  return (
    <>
      {visited.map((path) => {
        const Page = TAB_PAGES[path];
        const active = path === activeTab;
        return (
          <div
            key={path}
            className={cn("absolute inset-0", !active && "hidden")}
            aria-hidden={!active}
          >
            <TabPanelContext.Provider value={{ active }}>
              <Suspense fallback={<RouteSkeleton pathname={path} />}>
                <Page />
              </Suspense>
            </TabPanelContext.Provider>
          </div>
        );
      })}
    </>
  );
}
