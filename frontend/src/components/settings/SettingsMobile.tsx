import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, LogOut } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useSettings } from "@/contexts/SettingsContext";
import { SETTINGS_SECTIONS, getSection } from "./sections";
import type { SettingsSection, SettingsSectionId } from "./types";
import { DiscardGuardDialog } from "./DiscardGuardDialog";
import { useDiscardGuard } from "./useDiscardGuard";

// Grouped cards on the menu screen (ChatGPT/iOS-style grouping).
const MENU_GROUPS: ReadonlyArray<{
  title: string;
  ids: SettingsSectionId[];
}> = [
  { title: "Account", ids: ["account", "learning"] },
  { title: "Preferences", ids: ["appearance", "shortcuts"] },
  { title: "Support", ids: ["about"] },
];

/**
 * Mobile settings — a native-style full-screen page that drills into one
 * section at a time (menu ⇄ section), instead of the desktop modal.
 */
export function SettingsMobile() {
  const { section, close, setSection } = useSettings();
  const { user, logout } = useAuth();
  const { guard, isPrompting, confirm, cancel } = useDiscardGuard();

  // `null` = the grouped menu; otherwise a section sub-screen.
  const [view, setView] = useState<SettingsSectionId | null>(null);
  const active = view ? getSection(view) : null;

  const openSection = (id: SettingsSectionId) => {
    setSection(id);
    setView(id);
  };

  const back = () =>
    guard(() => {
      if (view) setView(null);
      else close();
    });

  const signOut = () => {
    close();
    logout();
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 24 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="fixed inset-0 z-50 flex flex-col bg-background"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <header className="flex h-14 shrink-0 items-center gap-1 border-b border-border/60 px-2 pt-[env(safe-area-inset-top)]">
        <button
          type="button"
          onClick={back}
          className="flex items-center gap-1 rounded-lg px-2 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent/50"
          aria-label={view ? "Back" : "Close settings"}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h1 className="text-base font-semibold">
          {active ? active.label : "Settings"}
        </h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-safe">
        <AnimatePresence mode="wait" initial={false}>
          {view === null ? (
            <motion.div
              key="menu"
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="space-y-6 p-4"
            >
              <ProfileHeader
                name={user?.full_name || "Student"}
                email={user?.email}
                avatarUrl={user?.avatar_url}
                onClick={() => openSection("account")}
              />

              {MENU_GROUPS.map((group) => (
                <div key={group.title} className="space-y-2">
                  <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.title}
                  </h2>
                  <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/40 divide-y divide-border/50">
                    {group.ids.map((id) => (
                      <MenuRow
                        key={id}
                        section={getSection(id)}
                        onClick={() => openSection(id)}
                      />
                    ))}
                  </div>
                </div>
              ))}

              <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/40">
                <button
                  type="button"
                  onClick={signOut}
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
                >
                  <LogOut className="h-4 w-4" />
                  Logout
                </button>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key={view}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 16 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="p-4"
            >
              {active && <active.Component />}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <DiscardGuardDialog
        open={isPrompting}
        onConfirm={confirm}
        onCancel={cancel}
      />
    </motion.div>
  );
}

function ProfileHeader({
  name,
  email,
  avatarUrl,
  onClick,
}: {
  name: string;
  email?: string;
  avatarUrl?: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl border border-border/60 bg-card/40 p-4 text-left transition-colors hover:bg-accent/40"
    >
      <Avatar className="h-12 w-12">
        <AvatarImage src={avatarUrl || undefined} alt={name} />
        <AvatarFallback>{name[0] || email?.[0] || "?"}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{name}</p>
        <p className="truncate text-sm text-muted-foreground">{email}</p>
      </div>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
    </button>
  );
}

function MenuRow({
  section,
  onClick,
}: {
  section: SettingsSection;
  onClick: () => void;
}) {
  const Icon = section.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 px-4 py-3.5 text-left text-sm transition-colors hover:bg-accent/50",
      )}
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="h-4 w-4" />
      </span>
      <span className="flex-1 font-medium">{section.label}</span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
