// Admin layout. Desktop (lg and up): a fixed sidebar beside the content.
// Below lg: a fixed header with a hamburger that opens the same navigation
// in a drawer (edge-swipe, scrim tap, Escape or the X button close it), so
// thirteen sections stay one tap away instead of a sideways-scrolling strip.
//
// The shell is a fixed-height frame (`h-dvh`) whose only scroll container is
// <main>: the header never scrolls away, and the dynamic viewport unit keeps
// it correct while mobile browser chrome shows and hides. Safe-area insets
// pad the header (notch) and the content's end (home indicator).
//
// The breakpoint matches the main app shell (`useIsMobileShell`, 1024px) —
// a 240px sidebar plus a data table does not fit a tablet in portrait.

import { useState, type ReactNode } from "react";
import { LogOut, Menu, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AdminNavPanel,
  type AdminNavItem,
} from "@/components/admin/AdminNavPanel";
import { MobileNavDrawer } from "@/components/layout/MobileNavDrawer";

export type { AdminNavItem };

interface AdminShellProps {
  nav: AdminNavItem[];
  active: string;
  onNavigate: (key: string) => void;
  username: string | null;
  onLogout: () => void;
  children: ReactNode;
}

export function AdminShell({
  nav,
  active,
  onNavigate,
  username,
  onLogout,
  children,
}: AdminShellProps) {
  const [navOpen, setNavOpen] = useState(false);
  const activeLabel = nav.find((item) => item.key === active)?.label;

  return (
    <div
      className="flex h-dvh overflow-hidden bg-muted/20"
      data-analytics-section="admin"
    >
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 border-r bg-background lg:flex lg:flex-col">
        <AdminNavPanel
          nav={nav}
          active={active}
          onNavigate={onNavigate}
          username={username}
          onLogout={onLogout}
        />
      </aside>

      {/* Mobile / tablet drawer (renders nothing at lg and up) */}
      <MobileNavDrawer open={navOpen} onOpenChange={setNavOpen}>
        <AdminNavPanel
          nav={nav}
          active={active}
          onNavigate={(key) => {
            setNavOpen(false);
            onNavigate(key);
          }}
          username={username}
          onLogout={onLogout}
          onClose={() => setNavOpen(false)}
        />
      </MobileNavDrawer>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-1 border-b bg-background px-2 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] lg:hidden">
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11"
            aria-label="Open admin navigation"
            data-analytics-name="Open admin navigation"
            onClick={() => setNavOpen(true)}
          >
            <Menu className="h-5 w-5" aria-hidden />
          </Button>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <ShieldAlert className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            <span className="truncate font-semibold">
              {activeLabel ?? "Admin"}
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-11 w-11"
            aria-label="Log out"
            data-analytics-name="Admin log out"
            onClick={onLogout}
          >
            <LogOut className="h-4 w-4" aria-hidden />
          </Button>
        </header>

        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:p-6 sm:pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
