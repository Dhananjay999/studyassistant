import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Bookmark,
  Layers,
  ListChecks,
  LogOut,
  MessageSquarePlus,
  Moon,
  Sun,
} from "lucide-react";
import { useTheme } from "next-themes";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

const TABS = [
  { label: "New Chat", icon: MessageSquarePlus, to: "/chat" },
  { label: "Quizzes", icon: ListChecks, to: "/quizzes" },
  { label: "Flashcards", icon: Layers, to: "/flashcards" },
  { label: "Bookmarks", icon: Bookmark, to: "/bookmarks" },
];

/**
 * App-style fixed bottom navigation. Mobile/tablet only (hidden on lg+ where
 * the sidebar takes over). Active tab gets an animated pill indicator.
 */
export function MobileNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const { resolvedTheme, setTheme } = useTheme();
  const [profileOpen, setProfileOpen] = useState(false);
  const isDark = resolvedTheme !== "light";

  const isActive = (to: string) =>
    to === "/chat"
      ? location.pathname === "/chat"
      : location.pathname.startsWith(to);

  return (
    <>
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
          onClick={() => setProfileOpen(true)}
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

      <Drawer open={profileOpen} onOpenChange={setProfileOpen}>
        <DrawerContent className="pb-safe">
          <DrawerTitle className="sr-only">Account</DrawerTitle>
          <div className="px-4 pb-4 pt-2">
            <div className="flex items-center gap-3">
              <Avatar className="h-11 w-11">
                <AvatarImage src={user?.avatar_url || undefined} />
                <AvatarFallback>
                  {user?.full_name?.[0] || user?.email?.[0] || "?"}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {user?.full_name || "Student"}
                </p>
                <p className="truncate text-sm text-muted-foreground">
                  {user?.email}
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-1">
              <Button
                variant="ghost"
                className="h-12 w-full justify-start gap-3 text-base"
                onClick={() => setTheme(isDark ? "light" : "dark")}
              >
                {isDark ? (
                  <Sun className="h-5 w-5" />
                ) : (
                  <Moon className="h-5 w-5" />
                )}
                {isDark ? "Light mode" : "Dark mode"}
              </Button>
              <Button
                variant="ghost"
                className="h-12 w-full justify-start gap-3 text-base text-destructive hover:text-destructive"
                onClick={logout}
              >
                <LogOut className="h-5 w-5" /> Log out
              </Button>
            </div>
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}
