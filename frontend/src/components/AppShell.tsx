import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Menu } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { AppSidebar } from "@/components/chat/AppSidebar";
import { GlobalCommandPalette } from "@/components/GlobalCommandPalette";
import {
  useCreateSession,
  useDeleteSession,
  useSessions,
} from "@/hooks/api";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";

const KEY = "aeva_sidebar_collapsed";

/** Shell with the shared sidebar + palette for the non-chat pages. */
export function AppShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const sessions = useSessions().data ?? [];
  const createSession = useCreateSession();
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

  const newChat = async () => {
    const s = await createSession.mutateAsync({});
    navigate(`/chat?sessionId=${s.id}`);
  };
  const selectSession = (id: string) => navigate(`/chat?sessionId=${id}`);

  useGlobalShortcuts({
    onCommandPalette: () => setPaletteOpen((o) => !o),
    onNewChat: newChat,
    onSlashMenu: () => setPaletteOpen(true),
  });

  const sidebar = (mobile: boolean) => (
    <AppSidebar
      collapsed={mobile ? false : collapsed}
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
      <aside className="hidden shrink-0 border-r border-border/50 lg:block">
        {sidebar(false)}
      </aside>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 p-0">
          {sidebar(true)}
        </SheetContent>
      </Sheet>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-center gap-2 border-b border-border/50 px-4 py-3">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="Open sidebar"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <h1 className="font-display text-lg font-bold">{title}</h1>
        </header>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </main>

      <GlobalCommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onNewChat={newChat}
        onSelectSession={selectSession}
      />
    </div>
  );
}
