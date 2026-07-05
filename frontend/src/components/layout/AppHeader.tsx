import { useNavigate } from "react-router-dom";
import { Bell, Bookmark, LogOut, Menu, MoreHorizontal, Search } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/contexts/AuthContext";
import { useConfirmLogout } from "@/hooks/useConfirmLogout";
import { useSettings } from "@/contexts/SettingsContext";
import { useHeaderSlotContent } from "@/components/layout/HeaderSlot";

/**
 * The single persistent header. Mounted once by `AppLayout` and never rebuilt on
 * navigation. The left/center is a page-owned slot (title, chat Files/Tools);
 * the right cluster (Search, Theme, Notifications, Avatar, More) is identical on
 * every page.
 */
export function AppHeader({
  onOpenMobileNav,
  onOpenSearch,
}: {
  onOpenMobileNav: () => void;
  onOpenSearch: () => void;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const confirmLogout = useConfirmLogout();
  const { open: openSettings } = useSettings();
  const { start, end } = useHeaderSlotContent();

  const initial = user?.full_name?.[0] || user?.email?.[0] || "?";

  return (
    <header className="z-10 flex items-center gap-2 border-b border-border/50 px-3 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        onClick={onOpenMobileNav}
        aria-label="Open sidebar"
      >
        <Menu className="h-5 w-5" />
      </Button>

      {/* Page-owned slot: title / breadcrumb / context actions. */}
      <div className="flex min-w-0 flex-1 items-center gap-2 truncate">
        {start}
      </div>

      {/* Page-owned trailing actions (e.g. chat Files/Tools), before the fixed
         controls so the shared cluster keeps a stable position. */}
      {end}

      {/* Fixed controls — identical across the whole app. */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onOpenSearch}
        aria-label="Search"
      >
        <Search className="h-4 w-4" />
      </Button>
      <div className="hidden lg:block">
        <ThemeToggle />
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="hidden lg:inline-flex"
            disabled
            aria-label="Notifications"
          >
            <Bell className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Notifications — coming soon</TooltipContent>
      </Tooltip>
      <button
        type="button"
        onClick={() => openSettings()}
        className="hidden rounded-full transition-opacity hover:opacity-80 lg:inline-flex"
        aria-label="Account & settings"
      >
        <Avatar className="h-8 w-8">
          <AvatarImage src={user?.avatar_url || undefined} />
          <AvatarFallback>{initial}</AvatarFallback>
        </Avatar>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="hidden lg:inline-flex"
            aria-label="More"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={() => navigate("/bookmarks")}>
            <Bookmark className="mr-2 h-4 w-4" /> Bookmarks
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => confirmLogout()}>
            <LogOut className="mr-2 h-4 w-4" /> Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
