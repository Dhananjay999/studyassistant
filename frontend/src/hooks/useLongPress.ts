// Long-press detection with an optional tap fallback, built on pointer events
// (covers touch + mouse). Movement beyond a small tolerance cancels the press,
// so it never fires during a scroll or drag.

import { useCallback, useRef, type PointerEvent } from "react";

interface LongPressOptions {
  onLongPress: () => void;
  onTap?: () => void;
  delay?: number;
  moveTolerance?: number;
}

export interface LongPressHandlers {
  onPointerDown: (e: PointerEvent) => void;
  onPointerMove: (e: PointerEvent) => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onContextMenu: (e: { preventDefault: () => void }) => void;
}

export function useLongPress({
  onLongPress,
  onTap,
  delay = 450,
  moveTolerance = 10,
}: LongPressOptions): LongPressHandlers {
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const onPointerDown = useCallback(
    (e: PointerEvent) => {
      origin.current = { x: e.clientX, y: e.clientY };
      fired.current = false;
      timer.current = window.setTimeout(() => {
        fired.current = true;
        onLongPress();
      }, delay);
    },
    [onLongPress, delay],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!origin.current) return;
      const dx = Math.abs(e.clientX - origin.current.x);
      const dy = Math.abs(e.clientY - origin.current.y);
      if (dx > moveTolerance || dy > moveTolerance) clear();
    },
    [clear, moveTolerance],
  );

  const onPointerUp = useCallback(() => {
    clear();
    if (!fired.current) onTap?.();
  }, [clear, onTap]);

  const onPointerLeave = useCallback(() => clear(), [clear]);

  // Suppress the OS context menu so a long-press feels like an app gesture.
  const onContextMenu = useCallback(
    (e: { preventDefault: () => void }) => e.preventDefault(),
    [],
  );

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave,
    onContextMenu,
  };
}
