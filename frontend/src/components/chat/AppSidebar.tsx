import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  BarChart3,
  Bookmark,
  BrainCircuit,
  FolderOpen,
  Layers,
  LibraryBig,
  ListChecks,
  Loader2,
  MessageSquare,
  NotebookPen,
  PanelLeft,
  PanelLeftClose,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { BrandLogo } from "@/components/common/BrandLogo";
import { useAuth } from "@/contexts/AuthContext";
import { useSettings } from "@/contexts/SettingsContext";
import { usePinnedSessions } from "@/hooks/usePinnedSessions";
import { useAppConfig, useConvertToSpace, useSpaces } from "@/hooks/api";
import { realSpaces, spaceColor, spaceIcon } from "@/lib/spaces";
import { cn } from "@/lib/utils";
import { formatShortcut } from "@/lib/platform";
import type { FeatureKey, Session } from "@/types";

// `feature` marks entries hidden when the admin disables that flag.
const NAV: Array<{
  label: string;
  icon: LucideIcon;
  to: string;
  feature?: FeatureKey;
}> = [
  { label: "Chats", icon: MessageSquare, to: "/chat" },
  { label: "Revision", icon: BrainCircuit, to: "/revision", feature: "revision_mode" },
  { label: "Study Spaces", icon: LibraryBig, to: "/spaces", feature: "study_spaces" },
  { label: "Notes", icon: NotebookPen, to: "/notes", feature: "notes" },
  { label: "Quizzes", icon: ListChecks, to: "/quizzes" },
  { label: "Flashcards", icon: Layers, to: "/flashcards" },
  { label: "Bookmarks", icon: Bookmark, to: "/bookmarks" },
  { label: "Analytics", icon: BarChart3, to: "/analytics", feature: "analytics" },
  { label: "Study Material", icon: FolderOpen, to: "/files" },
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
  onNavigate,
  sessions,
  loading = false,
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
  /** Fired after any navigation/section change — used to close the mobile
   *  drawer so tapping an item feels native (close, then navigate). */
  onNavigate?: () => void;
  sessions: Session[];
  /** True on first load, before chat history has arrived. */
  loading?: boolean;
  activeId: string | null;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void | Promise<void>;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { open: openSettings } = useSettings();
  const { pinnedIds, isPinned, togglePin } = usePinnedSessions();
  const onChats = location.pathname === "/chat";
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Admin-managed feature flags hide their nav entries entirely.
  const features = useAppConfig().data?.features;
  const nav = NAV.filter(
    (item) => !item.feature || features?.[item.feature] !== false,
  );
  const spacesEnabled = features?.study_spaces !== false;
  // Study Spaces are opt-in: the mini-list below renders only when the user
  // has created at least one real space, so non-adopters see no change.
  const { data: allSpaces } = useSpaces();
  const spaces = spacesEnabled ? realSpaces(allSpaces).slice(0, 4) : [];
  const convertToSpace = useConvertToSpace();
  const [convertingId, setConvertingId] = useState<string | null>(null);

  // Pinned sessions float to the top in most-recently-pinned order; everything
  // else falls through to the normal recency grouping.
  const pinned = pinnedIds
    .map((id) => sessions.find((s) => s.id === id))
    .filter((s): s is Session => Boolean(s));
  const grouped = groupSessions(sessions.filter((s) => !isPinned(s.id)));

  const accountName = user?.full_name || "Student";
  const accountInitial = user?.full_name?.[0] || user?.email?.[0] || "?";

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await onDeleteSession(id);
    } finally {
      setDeletingId(null);
    }
  };

  // Close the mobile drawer (if any) first, then navigate — native feel.
  const go = (to: string) => {
    onNavigate?.();
    navigate(to);
  };

  // Promote a chat into its own Study Space (name defaults to the title;
  // the user can restyle it from the space page afterwards).
  const handleConvert = (s: Session) => {
    setConvertingId(s.id);
    convertToSpace.mutate(
      { session_id: s.id },
      {
        onSuccess: (space) => {
          toast.success(`“${space.name}” is now a Study Space`);
          go(`/spaces/${space.id}`);
        },
        onError: () => toast.error("Couldn't create the space"),
        onSettled: () => setConvertingId(null),
      },
    );
  };

  // `onNavigate` is provided only for the mobile drawer instance. On mobile,
  // Profile is a normal in-shell page; on the desktop rail it stays the modal.
  const openSettingsPanel = () => {
    if (onNavigate) {
      onNavigate();
      navigate("/profile");
    } else {
      openSettings();
    }
  };

  const runSearch = () => {
    onNavigate?.();
    onSearch();
  };

  const renderRow = (s: Session) => {
    const pinnedRow = isPinned(s.id);
    return (
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
          {pinnedRow ? (
            <Pin className="h-3.5 w-3.5 shrink-0 fill-current text-brand-1" />
          ) : (
            <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-60" />
          )}
          <span className="truncate">{s.title}</span>
        </button>
        <button
          type="button"
          onClick={() => togglePin(s.id)}
          className={cn(
            "shrink-0 text-muted-foreground transition-opacity hover:text-brand-1",
            pinnedRow
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100",
          )}
          aria-label={pinnedRow ? "Unpin chat" : "Pin chat"}
          title={pinnedRow ? "Unpin chat" : "Pin chat"}
        >
          {pinnedRow ? (
            <PinOff className="h-3.5 w-3.5" />
          ) : (
            <Pin className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          type="button"
          onClick={() => handleConvert(s)}
          disabled={convertingId === s.id}
          className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-brand-1 group-hover:opacity-100 disabled:opacity-100"
          aria-label="Turn into Study Space"
          title="Turn into Study Space"
        >
          {convertingId === s.id ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <LibraryBig className="h-3.5 w-3.5" />
          )}
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
    );
  };

  return (
    <div
      className={cn(
        "flex h-full flex-col bg-background transition-[width] duration-300 ease-in-out",
        collapsed ? "w-16" : "w-64",
      )}
    >
      {/* Brand: app icon + name, always shown at the top of the sidebar.
         Collapsed to just the icon on the desktop rail. The collapse toggle
         is the desktop-only control (stacked under the icon when collapsed). */}
      <div
        className={cn(
          "flex px-3 pt-3 pb-3",
          collapsed ? "flex-col items-center gap-2" : "items-center gap-2",
        )}
      >
        <BrandLogo withWordmark={!collapsed} />
        {canCollapse && (
          <IconBtn
            label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={onToggleCollapse}
            className={cn(
              "hidden lg:inline-flex",
              collapsed ? "" : "ml-auto",
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
            onClick={runSearch}
            className="self-center"
          >
            <Search className="h-4 w-4" />
          </IconBtn>
        ) : (
          <Button
            variant="ghost"
            onClick={runSearch}
            className="h-10 w-full justify-start gap-2 rounded-xl text-muted-foreground"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="flex-1 text-left">Search</span>
            <span className="text-[10px] text-muted-foreground">
              {formatShortcut(["mod", "F"])}
            </span>
          </Button>
        )}
      </div>

      {/* Main navigation */}
      <nav className="flex flex-col gap-1 px-3 pb-2">
        {nav.map((item) => {
          const Icon = item.icon;
          const active =
            item.to === "/chat"
              ? onChats
              : location.pathname.startsWith(item.to);
          const btn = (
            <button
              key={item.to}
              type="button"
              onClick={() => go(item.to)}
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

      {/* Study Spaces mini-list — appears only once the user has created a
         real space (opt-in: non-adopters see the sidebar exactly as before). */}
      {!collapsed && spaces.length > 0 && (
        <div className="px-3 pb-2">
          <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Study Spaces
          </p>
          {spaces.map((space) => {
            const color = spaceColor(space.color);
            const Icon = spaceIcon(space.icon);
            const active = location.pathname === `/spaces/${space.id}`;
            return (
              <button
                key={space.id}
                type="button"
                onClick={() => go(`/spaces/${space.id}`)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors",
                  active
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-accent/50",
                )}
              >
                <span className={cn("grid h-4 w-4 shrink-0 place-items-center", color.text)}>
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="truncate">{space.name}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Chat history (hidden when collapsed) */}
      {!collapsed && (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {loading && sessions.length === 0 && (
            <div className="space-y-1.5 px-1 pt-1">
              {[92, 76, 84, 68, 88].map((w, i) => (
                <div
                  key={i}
                  style={{ width: `${w}%` }}
                  className="h-8 animate-pulse rounded-lg bg-muted/60"
                />
              ))}
            </div>
          )}
          {!loading && grouped.length === 0 && pinned.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              No chats yet.
            </p>
          )}
          {pinned.length > 0 && (
            <div className="mb-2">
              <p className="flex items-center gap-1 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                <Pin className="h-3 w-3 fill-current text-brand-1" />
                Pinned
              </p>
              {pinned.map(renderRow)}
            </div>
          )}
          {grouped.map(([label, list]) => (
            <div key={label} className="mb-2">
              <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {label}
              </p>
              {list.map(renderRow)}
            </div>
          ))}
        </div>
      )}

      {/* Account entry — always pinned to the bottom-left; opens Settings. */}
      <div className="mt-auto border-t border-border/50 p-2">
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={openSettingsPanel}
                aria-label="Account & settings"
                className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl transition-colors hover:bg-accent/60"
              >
                <Avatar className="h-7 w-7">
                  <AvatarImage src={user?.avatar_url || undefined} />
                  <AvatarFallback className="text-[10px]">
                    {accountInitial}
                  </AvatarFallback>
                </Avatar>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Account &amp; settings</TooltipContent>
          </Tooltip>
        ) : (
          <button
            type="button"
            onClick={openSettingsPanel}
            className="flex w-full items-center gap-2.5 rounded-xl p-2 text-left transition-colors hover:bg-accent/60"
          >
            <Avatar className="h-8 w-8 shrink-0">
              <AvatarImage src={user?.avatar_url || undefined} />
              <AvatarFallback className="text-xs">
                {accountInitial}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{accountName}</p>
              <p className="truncate text-xs text-muted-foreground">
                {user?.email}
              </p>
            </div>
            <Settings className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        )}
      </div>
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
