import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Outlet,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { AppSidebar } from "@/components/chat/AppSidebar";
import { MobileNav } from "@/components/MobileNav";
import { GlobalCommandPalette } from "@/components/GlobalCommandPalette";
import { AppHeader } from "@/components/layout/AppHeader";
import { HeaderSlotProvider } from "@/components/layout/HeaderSlot";
import { RouteTransition } from "@/components/layout/RouteTransition";
import { MobileTabsHost } from "@/components/layout/MobileTabsHost";
import { ShellViewportProvider } from "@/components/layout/shellViewport";
import { isTabPath } from "@/components/layout/tabPages";
import { useIsMobileShell } from "@/hooks/useIsMobileShell";
import { usePreventPinchZoom } from "@/hooks/usePreventPinchZoom";
import { useMobileViewport } from "@/hooks/useMobileViewport";
import { useDeleteSession, useSessions } from "@/hooks/api";
import { useBackClose } from "@/hooks/useBackClose";
import { useSwipe } from "@/hooks/useSwipe";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";

const COLLAPSE_KEY = "aeva_sidebar_collapsed";

/**
 * Shell controls a routed page may need to reach: the sidebar collapse state
 * (so the chat document viewer can auto-collapse the nav while a doc is docked),
 * and a slash-menu handler the chat composer registers.
 */
interface ShellValue {
  collapsed: boolean;
  /** Force the nav rail collapsed (chat sets this while a PDF is docked). */
  setDocked: (docked: boolean) => void;
  /** Open the mobile nav drawer (chat's swipe-right gesture). */
  openMobileNav: () => void;
  /** Let a page own Cmd/Ctrl+/ (chat opens its composer command menu). */
  registerSlashHandler: (fn: (() => void) | null) => void;
}

const ShellContext = createContext<ShellValue | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useShell(): ShellValue {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used within AppLayout");
  return ctx;
}

/**
 * The persistent application shell. Mounted ONCE under the protected layout
 * route: the header, left sidebar, mobile nav, and command palette never
 * re-mount on navigation — only the routed `<Outlet/>` swaps (with a crossfade),
 * so internal navigation never flashes the global loader.
 */
export function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  // Mobile keep-alive: the shell tracks the active tab and whether the mobile
  // (bottom-nav) shell is showing, shared with MobileTabsHost and the tab route
  // elements via ShellViewportProvider so they never double-mount a tab page.
  const isMobileShell = useIsMobileShell();
  const activeTab = isTabPath(location.pathname) ? location.pathname : null;
  // Native app-feel: no pinch-zoom (and, via touch-manipulation below, no
  // double-tap zoom) inside the app shell. Public pages keep normal zoom.
  usePreventPinchZoom();
  // Keyboard-safe layout: pin the shell to the visual viewport so only the
  // message list + composer move when the keyboard opens (not the whole page).
  useMobileViewport();
  const sessionsQuery = useSessions();
  const sessions = useMemo(
    () => sessionsQuery.data ?? [],
    [sessionsQuery.data],
  );
  const deleteSession = useDeleteSession();

  const [userCollapsed, setUserCollapsed] = useState(
    () => localStorage.getItem(COLLAPSE_KEY) === "1",
  );
  const [docked, setDocked] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const slashHandler = useRef<(() => void) | null>(null);

  // Effective collapse: a docked document forces it; otherwise the user's pref.
  const collapsed = docked || userCollapsed;

  const toggleCollapse = useCallback(() => {
    setUserCollapsed((c) => {
      localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      return !c;
    });
  }, []);

  // Land on a fresh, empty chat; the session is created lazily on first send.
  const newChat = useCallback(() => {
    setMobileOpen(false);
    navigate("/chat", { state: { newChat: true } });
  }, [navigate]);

  const selectSession = useCallback(
    (id: string) => {
      setMobileOpen(false);
      navigate(`/chat?sessionId=${id}`);
    },
    [navigate],
  );

  const handleDeleteSession = useCallback(
    async (id: string) => {
      await deleteSession.mutateAsync(id);
      if (id === searchParams.get("sessionId")) {
        const rest = sessions.filter((s) => s.id !== id);
        navigate(rest.length ? `/chat?sessionId=${rest[0].id}` : "/chat");
      }
    },
    [deleteSession, navigate, searchParams, sessions],
  );

  const registerSlashHandler = useCallback(
    (fn: (() => void) | null) => {
      slashHandler.current = fn;
    },
    [],
  );

  useGlobalShortcuts({
    onCommandPalette: () => setPaletteOpen((o) => !o),
    onNewChat: newChat,
    onSlashMenu: () =>
      slashHandler.current ? slashHandler.current() : setPaletteOpen(true),
  });

  const openMobileNav = useCallback(() => setMobileOpen(true), []);
  const navCloseSwipe = useSwipe({ onSwipeLeft: () => setMobileOpen(false) });

  // Native back gesture/button closes the mobile nav drawer and the command
  // palette instead of navigating away from the app.
  useBackClose(mobileOpen, () => setMobileOpen(false));
  // NOTE: the search palette deliberately does NOT use useBackClose. Selecting a
  // result closes the palette AND navigates in the same tick; useBackClose's
  // programmatic-close `history.back()` would pop the entry we just pushed,
  // reverting the navigation (result loads, but the route snaps back). Radix
  // still closes it on Escape / tap-outside / the ✕.

  const shell = useMemo<ShellValue>(
    () => ({ collapsed, setDocked, openMobileNav, registerSlashHandler }),
    [collapsed, openMobileNav, registerSlashHandler],
  );

  const sidebar = (mobile: boolean) => (
    <AppSidebar
      collapsed={mobile ? false : collapsed}
      canCollapse={!mobile}
      onToggleCollapse={toggleCollapse}
      onNewChat={newChat}
      onSearch={() => setPaletteOpen(true)}
      onNavigate={mobile ? () => setMobileOpen(false) : undefined}
      sessions={sessions}
      loading={sessionsQuery.isLoading}
      activeId={searchParams.get("sessionId")}
      onSelectSession={selectSession}
      onDeleteSession={handleDeleteSession}
    />
  );

  return (
    <ShellViewportProvider value={{ isMobileShell, activeTab }}>
    <ShellContext.Provider value={shell}>
      <HeaderSlotProvider>
        <div
          className="flex touch-manipulation bg-background"
          style={{ height: "var(--app-height, 100dvh)" }}
        >
          <aside className="hidden shrink-0 border-r border-border/50 lg:block">
            {sidebar(false)}
          </aside>
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            {/* Swipe right→left anywhere on the open sidebar closes it. */}
            <SheetContent side="left" className="w-72 p-0" {...navCloseSwipe}>
              {sidebar(true)}
            </SheetContent>
          </Sheet>

          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <AppHeader
              onOpenMobileNav={() => setMobileOpen(true)}
              onOpenSearch={() => setPaletteOpen(true)}
            />
            <main className="relative min-h-0 flex-1 overflow-hidden">
              {/* Mobile keep-alive tab pages (mounted, visibility-toggled).
                  Renders nothing on desktop, where the Outlet owns the pages. */}
              <MobileTabsHost />
              <RouteTransition>
                <Outlet />
              </RouteTransition>
            </main>
          </div>

          <MobileNav />

          <GlobalCommandPalette
            open={paletteOpen}
            onOpenChange={setPaletteOpen}
            onNewChat={newChat}
            onSelectSession={selectSession}
          />
        </div>
      </HeaderSlotProvider>
    </ShellContext.Provider>
    </ShellViewportProvider>
  );
}
