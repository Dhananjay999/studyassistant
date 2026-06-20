import { useEffect, useRef } from "react";
import { isMac } from "@/lib/platform";

export interface ShortcutHandlers {
  /** Cmd/Ctrl + F — global search */
  onCommandPalette: () => void;
  /** Cmd/Ctrl + N — new chat */
  onNewChat: () => void;
  /** Cmd/Ctrl + / — command menu */
  onSlashMenu: () => void;
}

/**
 * Global productivity shortcuts. Modifier combos work even inside inputs;
 * plain Esc/Enter handling stays with the focused component (Radix dialogs,
 * the composer), so normal typing is never intercepted.
 */
export function useGlobalShortcuts(handlers: ShortcutHandlers): void {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = isMac() ? e.metaKey : e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "f") {
        e.preventDefault();
        ref.current.onCommandPalette();
      } else if (key === "n") {
        e.preventDefault();
        ref.current.onNewChat();
      } else if (key === "/") {
        e.preventDefault();
        ref.current.onSlashMenu();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
