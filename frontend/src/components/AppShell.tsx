import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Menu } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { AppSidebar } from "@/components/chat/AppSidebar";
import { MobileNav } from "@/components/MobileNav";
import { GlobalCommandPalette } from "@/components/GlobalCommandPalette";
import { useDeleteSession, useSessions } from "@/hooks/api";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";

const KEY = "aeva_sidebar_collapsed";

/** Shell with the shared sidebar + palette for the non-chat pages. */
export function AppShell({
  title,
  children,
  hideDesktopSidebar = false,
  backTo,
}: {
  title: string;
  children: ReactNode;
  /** Hide the chat-session rail on desktop (the page becomes full-width). */
  hideDesktopSidebar?: boolean;
  /** When set, show a Back button (desktop) that navigates here. */
  backTo?: string;
}) {
  const navigate = useNavigate();
  const sessions = useSessions().data ?? [];
  const deleteSession = useDeleteSession();

  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(KEY) === "1",
  );
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const toggleCollapse = () => {
    setCollapsed((c) => {
      localStorage.setItem(KEY, c ? "0" : "1");
      return !c;
    });
  };

  // Land on a fresh, empty chat; the session is created lazily on first send.
  const newChat = () => navigate("/chat", { state: { newChat: true } });
  const selectSession = (id: string) => navigate(`/chat?sessionId=${id}`);

  useGlobalShortcuts({
    onCommandPalette: () => setPaletteOpen((o) => !o),
    onNewChat: newChat,
    onSlashMenu: () => setPaletteOpen(true),
  });

  const sidebar = (mobile: boolean) => (
    <AppSidebar
      collapsed={mobile ? false : collapsed}
      canCollapse={!mobile}
      onToggleCollapse={toggleCollapse}
      onNewChat={newChat}
      onSearch={() => setPaletteOpen(true)}
      sessions={sessions}
      activeId={null}
      onSelectSession={(id) => {
        selectSession(id);
        setMobileOpen(false);
      }}
      onDeleteSession={(id) => deleteSession.mutate(id)}
    />
  );

  return (
    <div className="flex h-dvh bg-background">
      {!hideDesktopSidebar && (
        <aside className="hidden shrink-0 border-r border-border/50 lg:block">
          {sidebar(false)}
        </aside>
      )}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 p-0">
          {sidebar(true)}
        </SheetContent>
      </Sheet>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-center gap-2 border-b border-border/50 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open sidebar"
          >
            <Menu className="h-5 w-5" />
          </Button>
          {backTo && (
            <Button
              variant="ghost"
              size="sm"
              className="hidden gap-1.5 lg:inline-flex"
              onClick={() => navigate(backTo)}
            >
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
          )}
          <h1 className="font-display text-lg font-bold">{title}</h1>
        </header>
        <div className="flex-1 overflow-y-auto pb-bottomnav lg:pb-0">
          {children}
        </div>
      </main>

      <MobileNav />

      <GlobalCommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onNewChat={newChat}
        onSelectSession={selectSession}
      />
    </div>
  );
}
