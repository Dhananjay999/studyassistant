// Maps horizontal swipes to tab changes: swipe-left advances to the next tab,
// swipe-right goes to the previous one, clamped at the ends. Spread the returned
// handlers onto the tab content container. Built on `useSwipe`, so it ignores
// vertical scrolling and only reacts to decisive horizontal gestures.

import { DRAWER_EDGE_SIZE } from "@/components/layout/MobileNavDrawer";
import { useSwipe, type SwipeHandlers } from "@/hooks/useSwipe";

export function useTabSwipe(
  values: readonly string[],
  value: string,
  onChange: (value: string) => void,
): SwipeHandlers {
  const move = (delta: number) => {
    const i = values.indexOf(value);
    if (i < 0) return;
    const next = i + delta;
    if (next < 0 || next >= values.length) return;
    onChange(values[next]);
  };

  return useSwipe({
    onSwipeLeft: () => move(1),
    onSwipeRight: () => move(-1),
    // The nav drawer's finger-tracked edge-drag owns gestures starting there.
    deadZoneLeft: DRAWER_EDGE_SIZE,
  });
}
