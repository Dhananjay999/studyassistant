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

    // Tallest viewport seen at the current width = the keyboard-closed
    // height. The keyboard is detected against THIS, not `window.innerHeight`:
    // with `interactive-widget=resizes-content` (our viewport meta) Android
    // Chrome shrinks the layout viewport together with the visual one, so
    // `innerHeight - vv.height` stays ~0 there and the bottom nav never hid.
    // iOS keeps `innerHeight` at full height, which the baseline also covers.
    let baseline = 0;
    let baselineWidth = 0;
    // Only touch devices have an on-screen keyboard.
    const touch = window.matchMedia("(hover: none), (pointer: coarse)");

    const isEditing = () => {
      const el = document.activeElement as HTMLElement | null;
      return (
        !!el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      );
    };

    const update = () => {
      const h = vv ? vv.height : window.innerHeight;
      root.style.setProperty("--app-height", `${Math.round(h)}px`);
      // A width change is a rotation / window resize: start a new baseline.
      if (window.innerWidth !== baselineWidth) {
        baselineWidth = window.innerWidth;
        baseline = 0;
      }
      baseline = Math.max(baseline, h, window.innerHeight);
      // Require a focused field so a plain window resize (split-screen,
      // browser chrome collapsing) is never mistaken for the keyboard.
      const kbOpen = touch.matches && baseline - h > 120 && isEditing();
      root.dataset.kbOpen = kbOpen ? "1" : "0";
    };
    update();

    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    // Focus moves without a resize when the keyboard is dismissed with the
    // field still focused and re-opened, or focus jumps between fields.
    document.addEventListener("focusin", update);
    document.addEventListener("focusout", update);

    const prevBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      document.removeEventListener("focusin", update);
      document.removeEventListener("focusout", update);
      document.body.style.overflow = prevBodyOverflow;
      root.style.removeProperty("--app-height");
      delete root.dataset.kbOpen;
    };
  }, []);
}
