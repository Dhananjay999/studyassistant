import { useEffect } from "react";

/**
 * Suppress browser pinch-to-zoom inside the app shell so it feels like a native
 * app (double-tap zoom is handled separately by `touch-action: manipulation`).
 * Scoped to wherever it's mounted — the public/marketing pages that don't use
 * it keep normal zoom for accessibility.
 *
 * Covers both engines: iOS Safari fires non-standard `gesture*` events for
 * pinch; Android/Chrome pinch shows up as a multi-touch `touchmove`.
 */
export function usePreventPinchZoom(): void {
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault();
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault();
    };

    document.addEventListener("gesturestart", stop);
    document.addEventListener("gesturechange", stop);
    document.addEventListener("gestureend", stop);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      document.removeEventListener("gesturestart", stop);
      document.removeEventListener("gesturechange", stop);
      document.removeEventListener("gestureend", stop);
      document.removeEventListener("touchmove", onTouchMove);
    };
  }, []);
}
