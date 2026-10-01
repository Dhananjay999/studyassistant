import { useCallback, useEffect, useState } from "react";

const isSupported = () =>
  typeof document !== "undefined" && Boolean(document.fullscreenEnabled);

/**
 * Browser Fullscreen API for the whole page (not one element), so portaled UI
 * — confirm dialogs, toasts, popovers — keeps rendering on top. State follows
 * `fullscreenchange`, so leaving via Esc or the browser's own controls stays in
 * sync.
 */
export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(
    () => isSupported() && document.fullscreenElement !== null,
  );

  useEffect(() => {
    if (!isSupported()) return;
    const sync = () => setIsFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  // Both calls can reject (no user gesture, permissions policy); the page
  // simply stays as it is, so failures are swallowed.
  const enter = useCallback(() => {
    if (!isSupported() || document.fullscreenElement) return;
    document.documentElement.requestFullscreen().catch(() => {});
  }, []);

  const exit = useCallback(() => {
    if (!isSupported() || !document.fullscreenElement) return;
    document.exitFullscreen().catch(() => {});
  }, []);

  return { supported: isSupported(), isFullscreen, enter, exit };
}
