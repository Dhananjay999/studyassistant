// Finger-tracking mobile navigation drawer (Gmail/Drive-style). The panel
// follows the touch in real time: dragging from the left screen edge pulls it
// open, dragging left anywhere on the open drawer (or its scrim) pushes it
// closed. On release the gesture completes on velocity first, position second;
// below both thresholds it smoothly settles back. Programmatic open/close
// (hamburger button, chat's mid-screen swipe) animates normally.
//
// Touch handling lives on `document` so the closed drawer needs no
// tap-blocking edge element, and drag positions are written straight to the
// DOM so the 60Hz move stream never re-renders the sidebar subtree.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Touches starting within this many px of the left edge can pull it open. */
export const DRAWER_EDGE_SIZE = 24;
/** Movement (px) before the gesture commits to horizontal or vertical. */
const INTENT_SLOP = 10;
/** px/ms — releases faster than this complete in the flick's direction. */
const FLICK_VELOCITY = 0.35;
/** Post-release settle animation. */
const SETTLE_MS = 320;
const SETTLE_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
/** Tailwind `lg` — at or above this the static sidebar owns navigation. */
const DESKTOP_MIN_WIDTH = 1024;

interface DragState {
  startX: number;
  startY: number;
  /** Panel translateX when the touch began (0 = open, -width = closed). */
  originX: number;
  width: number;
  intent: "pending" | "horizontal";
  /** Trailing move samples for release-velocity estimation. */
  samples: { t: number; x: number }[];
  lastX: number;
}

interface MobileNavDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

export function MobileNavDrawer({
  open,
  onOpenChange,
  children,
}: MobileNavDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);
  // Live values for the document-level listeners (registered once).
  const openRef = useRef(open);
  openRef.current = open;
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  // Rest position. Also the release animation: when `dragging` flips off this
  // re-runs and transitions from the drag's last inline transform.
  useEffect(() => {
    const panel = panelRef.current;
    const overlay = overlayRef.current;
    if (dragging || !panel || !overlay) return;
    panel.style.transition = `transform ${SETTLE_MS}ms ${SETTLE_EASE}`;
    overlay.style.transition = `opacity ${SETTLE_MS}ms ${SETTLE_EASE}`;
    panel.style.transform = open ? "translateX(0px)" : "translateX(-100%)";
    overlay.style.opacity = open ? "1" : "0";
    if (open) {
      panel.style.visibility = "visible";
      return;
    }
    // Hide the offscreen panel once the close settle finishes so its
    // focusables drop out of tab order (the Sheet used to unmount instead).
    const timer = window.setTimeout(() => {
      panel.style.visibility = "hidden";
    }, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [open, dragging]);

  useEffect(() => {
    const onStart = (e: TouchEvent) => {
      if (dragRef.current || e.touches.length !== 1) return;
      if (window.innerWidth >= DESKTOP_MIN_WIDTH) return;
      const t = e.touches[0];
      const isOpen = openRef.current;
      if (!isOpen) {
        if (t.clientX > DRAWER_EDGE_SIZE) return;
        // Overlays (sheets, dialogs, the quiz drawer) own their surface — an
        // edge drag must not pull the nav out from under them.
        if ((t.target as Element | null)?.closest?.('[role="dialog"]')) return;
      }
      const width = panelRef.current?.offsetWidth ?? 288;
      dragRef.current = {
        startX: t.clientX,
        startY: t.clientY,
        originX: isOpen ? 0 : -width,
        width,
        intent: "pending",
        samples: [],
        lastX: isOpen ? 0 : -width,
      };
      // touchmove must be non-passive: once the gesture commits to the drawer
      // we preventDefault so the page under the finger stops scrolling.
      document.addEventListener("touchmove", onMove, { passive: false });
      document.addEventListener("touchend", onEnd);
      document.addEventListener("touchcancel", onCancel);
    };

    const stopTracking = () => {
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onCancel);
      dragRef.current = null;
    };

    const onMove = (e: TouchEvent) => {
      const d = dragRef.current;
      const panel = panelRef.current;
      const overlay = overlayRef.current;
      if (!d || !panel || !overlay) return;
      const t = e.touches[0];
      const dx = t.clientX - d.startX;
      const dy = t.clientY - d.startY;

      if (d.intent === "pending") {
        if (Math.abs(dx) < INTENT_SLOP && Math.abs(dy) < INTENT_SLOP) return;
        // Vertical wins → it's a scroll. Opening also requires moving right.
        if (Math.abs(dy) > Math.abs(dx) || (!openRef.current && dx <= 0)) {
          stopTracking();
          return;
        }
        d.intent = "horizontal";
        setDragging(true);
        panel.style.visibility = "visible";
        panel.style.transition = "none";
        overlay.style.transition = "none";
      }

      if (e.cancelable) e.preventDefault();
      const x = Math.min(0, Math.max(-d.width, d.originX + dx));
      d.lastX = x;
      d.samples.push({ t: e.timeStamp, x });
      if (d.samples.length > 8) d.samples.shift();
      panel.style.transform = `translateX(${x}px)`;
      overlay.style.opacity = String((x + d.width) / d.width);
    };

    const onEnd = () => {
      const d = dragRef.current;
      stopTracking();
      if (!d || d.intent !== "horizontal") return;

      // Velocity over the trailing ~100ms of movement.
      const s = d.samples;
      const last = s[s.length - 1];
      let vx = 0;
      if (last) {
        const anchor = s.find((p) => last.t - p.t <= 100) ?? s[0];
        if (anchor !== last && last.t > anchor.t) {
          vx = (last.x - anchor.x) / (last.t - anchor.t);
        }
      }
      const openness = (d.lastX + d.width) / d.width;
      const target =
        Math.abs(vx) >= FLICK_VELOCITY ? vx > 0 : openness >= 0.5;
      setDragging(false);
      onOpenChangeRef.current(target);
    };

    const onCancel = () => {
      const wasDrag = dragRef.current?.intent === "horizontal";
      stopTracking();
      // Settle back to wherever `open` says we belong.
      if (wasDrag) setDragging(false);
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      stopTracking();
    };
  }, []);

  // Escape closes; focus moves into the drawer on open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    panelRef.current?.focus({ preventScroll: true });
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const active = open || dragging;

  return (
    <div className="lg:hidden">
      <div
        ref={overlayRef}
        onClick={() => onOpenChange(false)}
        className={cn(
          "fixed inset-0 z-50 bg-black/60",
          !active && "pointer-events-none",
        )}
        style={{ opacity: 0 }}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        aria-hidden={!open}
        tabIndex={-1}
        // touch-pan-y: the browser keeps vertical scrolling inside the drawer
        // while horizontal moves stay ours to track.
        className="fixed inset-y-0 left-0 z-50 w-72 touch-pan-y border-r border-border/50 bg-background shadow-lg outline-none will-change-transform"
        style={{ transform: "translateX(-100%)", visibility: "hidden" }}
      >
        {children}
      </div>
    </div>
  );
}
