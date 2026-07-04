import { Suspense, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { usePreferences } from "@/contexts/PreferencesContext";
import { PageSkeleton } from "@/components/layout/PageSkeleton";
import { cn } from "@/lib/utils";

/**
 * Fades the routed page in (~200ms) whenever the section changes. Keyed on
 * `pathname` ONLY, so switching chat sessions (`?sessionId=`) never re-animates.
 *
 * This is a single mount-only fade — deliberately NOT an `AnimatePresence`
 * crossfade with `mode="wait"`. That earlier approach animated the outgoing
 * page out and the incoming one in as separate steps; combined with the inner
 * Suspense boundary it made a freshly-navigated page flash in, fade out, then
 * fade in again. A plain keyed remount with a CSS keyframe has no exit step and
 * applies its start opacity before first paint, so the page fades in exactly
 * once. Respects the user's reduce-motion preference.
 */
export function RouteTransition({ children }: { children: ReactNode }) {
  const location = useLocation();
  const { reduceMotion } = usePreferences();

  return (
    <div
      key={location.pathname}
      className={cn(
        "h-full min-h-0",
        !reduceMotion && "animate-in fade-in-0 duration-200 ease-out",
      )}
    >
      <Suspense fallback={<PageSkeleton />}>{children}</Suspense>
    </div>
  );
}
