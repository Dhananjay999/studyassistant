import { useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Bookmark,
  Layers,
  ListChecks,
  MessageSquarePlus,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/contexts/AuthContext";
import { useSettings } from "@/contexts/SettingsContext";
import { cn } from "@/lib/utils";

const TABS = [
  { label: "New Chat", icon: MessageSquarePlus, to: "/chat" },
  { label: "Quizzes", icon: ListChecks, to: "/quizzes" },
  { label: "Flashcards", icon: Layers, to: "/flashcards" },
  { label: "Bookmarks", icon: Bookmark, to: "/bookmarks" },
];

/**
 * App-style fixed bottom navigation. Mobile/tablet only (hidden on lg+ where
 * the sidebar takes over). Active tab gets an animated pill indicator; the
 * Profile tab opens the shared full-screen Settings experience.
 */
export function MobileNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { open: openSettings } = useSettings();

  const isActive = (to: string) =>
    to === "/chat"
      ? location.pathname === "/chat"
      : location.pathname.startsWith(to);

  return (
    <nav className="glass-strong fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-border/60 pb-safe lg:hidden">
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
        onClick={() => openSettings()}
        className="relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-muted-foreground"
        aria-label="Profile"
      >
        <Avatar className="h-5 w-5">
          <AvatarImage src={user?.avatar_url || undefined} />
          <AvatarFallback className="text-[9px]">
            {user?.full_name?.[0] || user?.email?.[0] || "?"}
          </AvatarFallback>
        </Avatar>
        <span className="text-[10px] font-medium">Profile</span>
      </button>
    </nav>
  );
}
