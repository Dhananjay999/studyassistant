import { useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Bookmark,
  Layers,
  ListChecks,
  MessageSquare,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

const TABS = [
  { label: "Chat", icon: MessageSquare, to: "/chat" },
  { label: "Quizzes", icon: ListChecks, to: "/quizzes" },
  { label: "Flashcards", icon: Layers, to: "/flashcards" },
  { label: "Bookmarks", icon: Bookmark, to: "/bookmarks" },
];

/**
 * App-style fixed bottom navigation. Mobile/tablet only (hidden on lg+ where
 * the sidebar takes over). Active tab gets an animated pill indicator. Tapping
 * a tab only navigates — the tab pages are kept alive by `MobileTabsHost`, so
 * returning to a tab restores it exactly as left (Chat never auto-creates a new
 * conversation; the New Chat action lives in the chat header). Profile is a
 * normal in-shell page (`/profile`), not a fullscreen overlay.
 */
export function MobileNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  const isActive = (to: string) =>
    to === "/chat"
      ? location.pathname === "/chat"
      : location.pathname.startsWith(to);

  const profileActive = location.pathname.startsWith("/profile");

  return (
    <nav
      data-bottom-nav
      className="glass-strong fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-border/60 pb-safe lg:hidden"
    >
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const active = isActive(tab.to);
        return (
          <button
            key={tab.to}
            type="button"
            onClick={() => navigate(tab.to)}
            className="relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2"
            aria-label={tab.label}
            aria-current={active ? "page" : undefined}
          >
            {active && (
              <motion.span
                layoutId="mobilenav-active"
                transition={{ type: "spring", stiffness: 500, damping: 34 }}
                className="absolute inset-x-3 top-1 h-8 rounded-full bg-brand-1/12"
              />
            )}
            <motion.span
              whileTap={{ scale: 0.82 }}
              className={cn(
                "relative z-10",
                active ? "text-brand-1" : "text-muted-foreground",
              )}
            >
              <Icon className="h-5 w-5" />
            </motion.span>
            <span
              className={cn(
                "relative z-10 text-[10px] font-medium",
                active ? "text-brand-1" : "text-muted-foreground",
              )}
            >
              {tab.label}
            </span>
          </button>
        );
      })}

      <button
        type="button"
        onClick={() => navigate("/profile")}
        className="relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2"
        aria-label="Profile"
        aria-current={profileActive ? "page" : undefined}
      >
        {profileActive && (
          <motion.span
            layoutId="mobilenav-active"
            transition={{ type: "spring", stiffness: 500, damping: 34 }}
            className="absolute inset-x-3 top-1 h-8 rounded-full bg-brand-1/12"
          />
        )}
        <motion.span
          whileTap={{ scale: 0.82 }}
          className={cn("relative z-10", profileActive && "text-brand-1")}
        >
          <Avatar className="h-5 w-5">
            <AvatarImage src={user?.avatar_url || undefined} />
            <AvatarFallback className="text-[9px]">
              {user?.full_name?.[0] || user?.email?.[0] || "?"}
            </AvatarFallback>
          </Avatar>
        </motion.span>
        <span
          className={cn(
            "relative z-10 text-[10px] font-medium",
            profileActive ? "text-brand-1" : "text-muted-foreground",
          )}
        >
          Profile
        </span>
      </button>
    </nav>
  );
}
