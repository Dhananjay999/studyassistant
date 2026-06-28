import { AnimatePresence, motion } from "framer-motion";
import { LogOut } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useSettings } from "@/contexts/SettingsContext";
import { SETTINGS_SECTIONS, getSection } from "./sections";
import { DiscardGuardDialog } from "./DiscardGuardDialog";
import { useDiscardGuard } from "./useDiscardGuard";

/**
 * Desktop settings — a centered two-pane modal (left nav, right content) with
 * Radix open/close animation and animated section transitions.
 */
export function SettingsModal() {
  const { isOpen, section, close, setSection } = useSettings();
  const { logout } = useAuth();
  const { guard, isPrompting, confirm, cancel } = useDiscardGuard();

  const active = getSection(section);
  const ActiveComponent = active.Component;

  const signOut = () => {
    close();
    logout();
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) guard(close);
      }}
    >
      <DialogContent
        className="flex h-[85vh] max-h-[760px] w-[min(960px,95vw)] max-w-none gap-0 overflow-hidden p-0 sm:rounded-2xl"
        onInteractOutside={(e) => {
          // Don't let an outside click slam the modal shut over unsaved edits;
          // route it through the guard instead.
          e.preventDefault();
          guard(close);
        }}
      >
        {/* Left navigation */}
        <nav className="flex w-[15.5rem] shrink-0 flex-col border-r border-border/60 bg-muted/30">
          <div className="px-5 pb-3 pt-5">
            <DialogTitle className="text-base font-semibold">
              Settings
            </DialogTitle>
            <DialogDescription className="sr-only">
              Manage your account, learning profile, and app preferences.
            </DialogDescription>
          </div>
          <ul className="flex-1 space-y-0.5 overflow-y-auto px-2.5 py-1">
            {SETTINGS_SECTIONS.map((item) => {
              const Icon = item.icon;
              const isActive = item.id === section;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => guard(() => setSection(item.id))}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                      isActive
                        ? "bg-background font-medium text-foreground shadow-sm"
                        : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {item.label}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-border/60 p-2.5">
            <button
              type="button"
              onClick={signOut}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10"
            >
              <LogOut className="h-4 w-4 shrink-0" />
              Logout
            </button>
          </div>
        </nav>

        {/* Content panel */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 px-6 pr-14">
            <active.icon className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">{active.label}</h2>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={section}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.16, ease: "easeOut" }}
                className="mx-auto max-w-xl"
              >
                <ActiveComponent />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </DialogContent>

      <DiscardGuardDialog
        open={isPrompting}
        onConfirm={confirm}
        onCancel={cancel}
      />
    </Dialog>
  );
}
