import { useEffect } from "react";

/**
 * Pin the app shell to the *visual* viewport so the on-screen keyboard behaves
 * like a native app: the shell stays a fixed size equal to the visible area
 * (never scrolls as a whole), and only the inner scroll containers (chat
 * message list) and the composer rise above the keyboard.
 *
 * - Publishes `--app-height` = `visualViewport.height` for the shell to consume
 *   (falls back to `100dvh` before this runs / when unsupported).
 * - Marks `document.documentElement[data-kb-open]` while the keyboard is open,
 *   so chrome like the bottom nav can hide itself via CSS.
 * - Locks `body` scroll while mounted (in-app only) so the page can't scroll as
 *   a unit — inner `overflow-y-auto` regions still scroll normally.
 */
export function useMobileViewport(): void {
  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;

    const update = () => {
      const h = vv ? vv.height : window.innerHeight;
      root.style.setProperty("--app-height", `${Math.round(h)}px`);
      const kbOpen = vv ? window.innerHeight - vv.height > 120 : false;
      root.dataset.kbOpen = kbOpen ? "1" : "0";
    };
    update();

    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);

    const prevBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      document.body.style.overflow = prevBodyOverflow;
      root.style.removeProperty("--app-height");
      delete root.dataset.kbOpen;
    };
  }, []);
}
