// Admin layout: a fixed sidebar on desktop, a scrollable tab strip on mobile,
// and a header with the signed-in admin and a logout button.

import type { LucideIcon } from "lucide-react";
import { LogOut, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export interface AdminNavItem {
  key: string;
  label: string;
  icon: LucideIcon;
}

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
  return (
    <div className="flex min-h-screen bg-muted/20">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 border-r bg-background md:flex md:flex-col">
        <div className="flex items-center gap-2 px-5 py-4">
          <ShieldAlert className="h-5 w-5 text-primary" />
          <span className="font-semibold tracking-tight">Admin</span>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {nav.map((item) => (
            <NavButton
              key={item.key}
              item={item}
              active={active === item.key}
              onClick={() => onNavigate(item.key)}
            />
          ))}
        </nav>
        <div className="border-t p-3">
          <p className="truncate px-2 pb-2 text-xs text-muted-foreground">
            {username ? `Signed in as ${username}` : "Admin session"}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={onLogout}
          >
            <LogOut className="h-4 w-4" />
            Log out
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile header + tab strip */}
        <header className="flex items-center justify-between gap-2 border-b bg-background px-4 py-3 md:hidden">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-primary" />
            <span className="font-semibold">Admin</span>
          </div>
          <Button variant="ghost" size="icon" onClick={onLogout}>
            <LogOut className="h-4 w-4" />
          </Button>
        </header>
        <div className="flex gap-1 overflow-x-auto border-b bg-background px-3 py-2 md:hidden">
          {nav.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => onNavigate(item.key)}
              className={cn(
                "shrink-0 rounded-md px-3 py-1.5 text-sm",
                active === item.key
                  ? "bg-primary/10 font-medium text-primary"
                  : "text-muted-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        <main className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

function NavButton({
  item,
  active,
  onClick,
}: {
  item: AdminNavItem;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
        active
          ? "bg-primary/10 font-medium text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4" />
      {item.label}
    </button>
  );
}
