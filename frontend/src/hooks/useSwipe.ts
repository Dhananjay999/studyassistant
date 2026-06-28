// Lightweight directional swipe detection for touch surfaces. Returns touch
// handlers to spread onto an element. Distinguishes horizontal vs vertical
// intent so it won't hijack normal scrolling.

import { useRef, type TouchEvent } from "react";

export interface SwipeHandlers {
  onTouchStart: (e: TouchEvent) => void;
  onTouchEnd: (e: TouchEvent) => void;
}

interface SwipeOptions {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
  /** Minimum primary-axis distance (px) to count as a swipe. */
  threshold?: number;
  /** Maximum off-axis drift (px) allowed for a clean directional swipe. */
  restraint?: number;
}

export function useSwipe(options: SwipeOptions): SwipeHandlers {
  const start = useRef<{ x: number; y: number } | null>(null);
  const { threshold = 56, restraint = 80 } = options;

  return {
    onTouchStart: (e) => {
      const t = e.touches[0];
      start.current = t ? { x: t.clientX, y: t.clientY } : null;
    },
    onTouchEnd: (e) => {
      const s = start.current;
      start.current = null;
      const t = e.changedTouches[0];
      if (!s || !t) return;
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      if (absX >= threshold && absY <= restraint) {
        (dx < 0 ? options.onSwipeLeft : options.onSwipeRight)?.();
      } else if (absY >= threshold && absX <= restraint) {
        (dy < 0 ? options.onSwipeUp : options.onSwipeDown)?.();
      }
    },
  };
}
