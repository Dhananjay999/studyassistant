// Popup lifecycle analytics for the shared shadcn primitives (Dialog,
// AlertDialog, Sheet, Drawer, Popover, DropdownMenu, ResponsiveModal).
//
// Each primitive's Root calls `usePopupAnalytics(kind, props)` once, which
// watches the open state (controlled or uncontrolled) and emits a per-popup
// pair of events — `<NAME>_<KIND>_OPENED` / `<NAME>_<KIND>_CLOSED`, e.g.
// `QUIZ_DASHBOARD_DIALOG_OPENED`, `LOG_OUT_MODAL_CLOSED` — with the popup's
// name, how long it stayed open and how it was closed. The name comes from, in order: an explicit
// `analyticsName` prop on the Root, the popup's Title text (registered by
// the Title component), or the trigger's label for title-less popovers and
// menus. Call sites need no changes.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ForwardedRef,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  analytics,
  popupEventName,
  type PopupCloseVia,
  type PopupKind,
} from "@/lib/analytics";
import { describeElementLabel } from "@/lib/analytics/clicks";

export interface PopupAnalyticsHandle {
  kind: PopupKind;
  /** Register a name; an explicit `analyticsName` always wins. */
  setName: (name: string | null | undefined) => void;
  noteClose: (via: PopupCloseVia) => void;
}

export const PopupAnalyticsContext =
  createContext<PopupAnalyticsHandle | null>(null);

interface OpenStateProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const MAX_NAME = 60;
// Let Title / Trigger register a name before the opened event is sent.
const NAME_SETTLE_MS = 60;

function clean(s: string | null | undefined): string {
  return (s ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
}

/**
 * Wrap a primitive Root's props. Returns the props to spread on the real
 * Root (with `onOpenChange` intercepted) and the context handle for the
 * Title / Content / Trigger wrappers.
 */
export function usePopupAnalytics<P extends OpenStateProps>(
  kind: PopupKind,
  props: P & { analyticsName?: string },
): { rootProps: P; handle: PopupAnalyticsHandle } {
  const { analyticsName, open, defaultOpen, onOpenChange, ...rest } = props;
  const isControlled = open !== undefined;
  const [innerOpen, setInnerOpen] = useState(!!defaultOpen);
  const effectiveOpen = isControlled ? !!open : innerOpen;

  const explicitRef = useRef(clean(analyticsName));
  explicitRef.current = clean(analyticsName);
  const nameRef = useRef("");
  const viaRef = useRef<PopupCloseVia>("dismiss");
  const openedAtRef = useRef(0);
  const reportedRef = useRef(false);
  const openRef = useRef(effectiveOpen);
  openRef.current = effectiveOpen;

  const handleRef = useRef<PopupAnalyticsHandle>({
    kind,
    setName: (n) => {
      const c = clean(n);
      if (c) nameRef.current = c;
    },
    noteClose: (via) => {
      viaRef.current = via;
    },
  });

  const popupName = useCallback(
    () => explicitRef.current || nameRef.current || "unnamed",
    [kind],
  );

  const trackClosed = useCallback(
    (via: PopupCloseVia) => {
      if (!openedAtRef.current) return;
      const name = popupName();
      if (!reportedRef.current) {
        analytics.trackNamed(
          popupEventName(name, kind, "OPENED"),
          { popup: name, kind },
          "popup_opened",
        );
        reportedRef.current = true;
      }
      analytics.trackNamed(
        popupEventName(name, kind, "CLOSED"),
        {
          popup: name,
          kind,
          duration_ms: Math.round(performance.now() - openedAtRef.current),
          via,
        },
        "popup_closed",
      );
      openedAtRef.current = 0;
    },
    [kind, popupName],
  );

  useEffect(() => {
    if (effectiveOpen) {
      openedAtRef.current = performance.now();
      reportedRef.current = false;
      viaRef.current = "dismiss";
      const t = window.setTimeout(() => {
        reportedRef.current = true;
        const name = popupName();
        analytics.trackNamed(
          popupEventName(name, kind, "OPENED"),
          { popup: name, kind },
          "popup_opened",
        );
      }, NAME_SETTLE_MS);
      return () => window.clearTimeout(t);
    }
    trackClosed(viaRef.current);
    return undefined;
  }, [effectiveOpen, kind, popupName, trackClosed]);

  // Removed from the tree while open (route change, parent unmount).
  useEffect(
    () => () => {
      if (openRef.current) trackClosed("unmount");
    },
    [trackClosed],
  );

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!isControlled) setInnerOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );

  const rootProps = {
    ...rest,
    ...(isControlled ? { open } : { defaultOpen }),
    onOpenChange: handleOpenChange,
  } as unknown as P;

  return { rootProps, handle: handleRef.current };
}

function assignRef<T>(ref: ForwardedRef<T>, node: T | null): void {
  if (typeof ref === "function") ref(node);
  else if (ref) ref.current = node;
}

/** For Title components: registers the title text as the popup name. */
export function usePopupTitle<T extends HTMLElement>(
  forwardedRef: ForwardedRef<T>,
): (node: T | null) => void {
  const ctx = useContext(PopupAnalyticsContext);
  const local = useRef<T | null>(null);
  useEffect(() => {
    ctx?.setName(local.current?.textContent);
  });
  return useCallback(
    (node: T | null) => {
      local.current = node;
      assignRef(forwardedRef, node);
    },
    [forwardedRef],
  );
}

interface ContentHandlers {
  onEscapeKeyDown?: (event: KeyboardEvent | Event) => void;
  onPointerDownOutside?: (event: PointerEvent | Event) => void;
}

/** For Content components: records how the popup was dismissed. */
export function usePopupContentProps<P extends object>(
  props: P,
): P & ContentHandlers {
  const ctx = useContext(PopupAnalyticsContext);
  const p = props as P & ContentHandlers;
  return {
    ...props,
    onEscapeKeyDown: (e: KeyboardEvent | Event) => {
      ctx?.noteClose("escape");
      p.onEscapeKeyDown?.(e);
    },
    onPointerDownOutside: (e: PointerEvent | Event) => {
      ctx?.noteClose("outside");
      p.onPointerDownOutside?.(e);
    },
  };
}

interface TriggerHandlers {
  onPointerDown?: (event: PointerEvent<HTMLElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
}

/** For title-less popups (popover, menu): name them after their trigger. */
export function usePopupTriggerProps<P extends object>(
  props: P,
): P & TriggerHandlers {
  const ctx = useContext(PopupAnalyticsContext);
  const p = props as P & TriggerHandlers;
  const note = (el: HTMLElement) => {
    if (!ctx) return;
    ctx.setName(describeElementLabel(el).name);
  };
  return {
    ...props,
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      note(e.currentTarget);
      p.onPointerDown?.(e);
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        note(e.currentTarget);
      }
      p.onKeyDown?.(e);
    },
  };
}
