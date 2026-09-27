// The admin navigation list, shared by the desktop sidebar and the mobile
// drawer so both always offer the same sections, signed-in admin and logout.

import { LogOut, ShieldAlert, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface AdminNavItem {
  key: string;
  label: string;
  icon: LucideIcon;
}

export function AdminNavPanel({
  nav,
  active,
  onNavigate,
  username,
  onLogout,
  onClose,
}: {
  nav: AdminNavItem[];
  active: string;
  onNavigate: (key: string) => void;
  username: string | null;
  onLogout: () => void;
  /** Present in the mobile drawer: renders a visible close button. */
  onClose?: () => void;
}) {
  return (
    <div className="flex h-full flex-col pt-safe">
      <div className="flex items-center gap-2 px-5 py-4">
        <ShieldAlert className="h-5 w-5 text-primary" aria-hidden />
        <span className="font-semibold tracking-tight">Admin</span>
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto h-10 w-10"
            aria-label="Close navigation"
            data-analytics-name="Close admin navigation"
            onClick={onClose}
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        )}
      </div>
      <nav
        aria-label="Admin sections"
        className="flex-1 space-y-1 overflow-y-auto px-3 pb-2"
      >
        {nav.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onNavigate(item.key)}
              aria-current={isActive ? "page" : undefined}
              data-analytics-id={`admin.nav.${item.key}`}
              data-analytics-name={item.label}
              className={cn(
                "flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors active:bg-accent",
                isActive
                  ? "bg-primary/10 font-medium text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              {item.label}
            </button>
          );
        })}
      </nav>
      <div className="border-t p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
        <p
          className="truncate px-2 pb-2 text-xs text-muted-foreground"
          data-analytics-private
        >
          {username ? `Signed in as ${username}` : "Admin session"}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="h-10 w-full justify-start gap-2"
          data-analytics-name="Admin log out"
          onClick={onLogout}
        >
          <LogOut className="h-4 w-4" aria-hidden />
          Log out
        </Button>
      </div>
    </div>
  );
}
