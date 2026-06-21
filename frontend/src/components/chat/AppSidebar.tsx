import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  BarChart3,
  Bookmark,
  FolderOpen,
  Layers,
  ListChecks,
  Loader2,
  MessageSquare,
  PanelLeft,
  PanelLeftClose,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { BrandLogo } from "@/components/common/BrandLogo";
import { cn } from "@/lib/utils";
import { formatShortcut } from "@/lib/platform";
import type { Session } from "@/types";

const NAV = [
  { label: "Chats", icon: MessageSquare, to: "/chat" },
  { label: "Quizzes", icon: ListChecks, to: "/quizzes" },
  { label: "Flashcards", icon: Layers, to: "/flashcards" },
  { label: "Bookmarks", icon: Bookmark, to: "/bookmarks" },
  { label: "Analytics", icon: BarChart3, to: "/analytics" },
  { label: "Files", icon: FolderOpen, to: "/files" },
];

const DAY = 86_400_000;

function groupSessions(sessions: Session[]) {
  const now = new Date();
  const startToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const groups: Record<string, Session[]> = {
    Today: [],
    Yesterday: [],
    "Previous 7 Days": [],
    Older: [],
  };
  for (const s of sessions) {
    const t = new Date(s.updated_at).getTime();
    if (t >= startToday) groups.Today.push(s);
    else if (t >= startToday - DAY) groups.Yesterday.push(s);
    else if (t >= startToday - 7 * DAY) groups["Previous 7 Days"].push(s);
    else groups.Older.push(s);
  }
  return Object.entries(groups).filter(([, list]) => list.length > 0);
}

export function AppSidebar({
  collapsed,
  canCollapse = true,
  onToggleCollapse,
  onNewChat,
  onSearch,
  sessions,
  activeId,
  onSelectSession,
  onDeleteSession,
}: {
  collapsed: boolean;
  /** Whether to show the collapse toggle (false in the mobile drawer). */
  canCollapse?: boolean;
  onToggleCollapse: () => void;
  onNewChat: () => void;
  onSearch: () => void;
  sessions: Session[];
  activeId: string | null;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void | Promise<void>;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const grouped = groupSessions(sessions);
  const onChats = location.pathname === "/chat";
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await onDeleteSession(id);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div
      className={cn(
        "flex h-full flex-col bg-background transition-[width] duration-300 ease-in-out",
        collapsed ? "w-16" : "w-64",
      )}
    >
      {/* Brand: mobile only (desktop shows it in the top header).
         The collapse toggle is the desktop-only control. */}
      <div className="flex items-center gap-2 px-3 pt-3">
        <BrandLogo withWordmark={!collapsed} className="lg:hidden" />
        {canCollapse && (
          <IconBtn
            label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={onToggleCollapse}
            className={cn(
              "hidden lg:inline-flex",
              collapsed ? "mx-auto" : "ml-auto",
            )}
          >
            {collapsed ? (
              <PanelLeft className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </IconBtn>
        )}
      </div>

      {/* Primary actions */}
      <div className="flex flex-col gap-1.5 p-3">
        <Button
          onClick={onNewChat}
          className={cn(
            "h-10 gap-2 rounded-xl",
            collapsed ? "w-10 self-center p-0" : "w-full justify-start",
          )}
          aria-label="New chat"
        >
          <Plus className="h-4 w-4 shrink-0" />
          {!collapsed && <span>New chat</span>}
        </Button>
        {collapsed ? (
          <IconBtn
            label="Search"
            onClick={onSearch}
            className="self-center"
          >
            <Search className="h-4 w-4" />
          </IconBtn>
        ) : (
          <Button
            variant="ghost"
            onClick={onSearch}
            className="h-10 w-full justify-start gap-2 rounded-xl text-muted-foreground"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">Search</span>
            <span className="text-[10px] text-muted-foreground/70">
              {formatShortcut(["mod", "F"])}
            </span>
          </Button>
        )}
      </div>

      {/* Main navigation */}
      <nav className="flex flex-col gap-1 px-3 pb-2">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active =
            item.to === "/chat"
              ? onChats
              : location.pathname.startsWith(item.to);
          const btn = (
            <button
              key={item.to}
              type="button"
              onClick={() => navigate(item.to)}
              className={cn(
                "group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                collapsed && "justify-center px-0",
                active
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
            >
              {active && (
                <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-brand-1" />
              )}
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && item.label}
            </button>
          );
          return collapsed ? (
            <Tooltip key={item.to}>
              <TooltipTrigger asChild>{btn}</TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          ) : (
            btn
          );
        })}
      </nav>

      {/* Chat history (hidden when collapsed) */}
      {!collapsed && (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {grouped.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              No chats yet.
            </p>
          )}
          {grouped.map(([label, list]) => (
            <div key={label} className="mb-2">
              <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {label}
              </p>
              {list.map((s) => (
                <div
                  key={s.id}
                  className={cn(
                    "group flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors",
                    activeId === s.id && onChats
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-accent/50",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelectSession(s.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-60" />
                    <span className="truncate">{s.title}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(s.id)}
                    disabled={deletingId === s.id}
                    className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 disabled:opacity-100"
                    aria-label="Delete chat"
                  >
                    {deletingId === s.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function IconBtn({
  children,
  label,
  onClick,
  className,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClick}
          aria-label={label}
          className={cn("h-9 w-9 shrink-0 rounded-xl", className)}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
