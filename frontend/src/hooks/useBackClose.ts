// Ties an overlay's open state to the browser/device back button so mobile back
// gestures feel native: opening a sheet/drawer/dialog pushes one history entry,
// and pressing Back (Android system back, browser back, or the iOS swipe-back
// gesture — all of which emit `popstate`) closes that overlay instead of
// navigating away from the app.
//
// A single shared listener + a stack (rather than one listener per overlay)
// guarantees that ONE Back press closes only the topmost overlay — stacked
// overlays pop most-recent-first, exactly like a native navigation stack.
// Closing an overlay programmatically (a button, Escape, tap-outside) removes
// its entry and consumes the history entry it pushed, suppressing the resulting
// popstate so it doesn't also close whatever is underneath.

import { useEffect, useRef } from "react";

interface Entry {
  close: () => void;
}

// Module-level singletons: one back-stack for the whole app/window.
const stack: Entry[] = [];
let suppressCount = 0;
let listening = false;

function onPopState() {
  if (suppressCount > 0) {
    // This popstate is the echo of our own history.back() during a
    // programmatic close — swallow it.
    suppressCount--;
    return;
  }
  // A real Back press: close only the topmost overlay.
  stack.pop()?.close();
}

function ensureListening() {
  if (!listening && typeof window !== "undefined") {
    window.addEventListener("popstate", onPopState);
    listening = true;
  }
}

export function useBackClose(isOpen: boolean, onClose: () => void): void {
  // Keep the latest onClose without re-subscribing.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    ensureListening();
    const entry: Entry = { close: () => onCloseRef.current() };
    window.history.pushState({ __overlay: true }, "");
    stack.push(entry);

    return () => {
      const idx = stack.indexOf(entry);
      if (idx === -1) {
        // Back already popped and closed us — nothing left to undo.
        return;
      }
      // Programmatic close (button / Escape / tap-outside): drop our entry and
      // consume the history entry we pushed, ignoring the popstate it triggers.
      stack.splice(idx, 1);
      suppressCount++;
      window.history.back();
    };
  }, [isOpen]);
}
