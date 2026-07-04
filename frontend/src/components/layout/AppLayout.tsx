import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { Outlet, useNavigate, useSearchParams } from "react-router-dom";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { AppSidebar } from "@/components/chat/AppSidebar";
import { MobileNav } from "@/components/MobileNav";
import { GlobalCommandPalette } from "@/components/GlobalCommandPalette";
import { AppHeader } from "@/components/layout/AppHeader";
import { HeaderSlotProvider } from "@/components/layout/HeaderSlot";
import { RouteTransition } from "@/components/layout/RouteTransition";
import { useDeleteSession, useSessions } from "@/hooks/api";
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
  const [searchParams] = useSearchParams();
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
    <ShellContext.Provider value={shell}>
      <HeaderSlotProvider>
        <div className="flex h-dvh bg-background">
          <aside className="hidden shrink-0 border-r border-border/50 lg:block">
            {sidebar(false)}
          </aside>
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetContent side="left" className="w-72 p-0">
              {sidebar(true)}
            </SheetContent>
          </Sheet>

          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <AppHeader
              onOpenMobileNav={() => setMobileOpen(true)}
              onOpenSearch={() => setPaletteOpen(true)}
            />
            <main className="relative min-h-0 flex-1 overflow-hidden">
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
  );
}
