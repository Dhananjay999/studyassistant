// The passive trigger for the sign-in prompt: a visitor who has been
// genuinely engaged with a public page for a while (tab visible, input in
// the last 10 s — the same definition of "active" as the landing analytics)
// gets the prompt once, at a quiet moment. It never fires on page load, never
// mid-scroll or mid-gesture, and defers (rather than gives up) while another
// overlay is open or the visitor is busy. Every attempt goes through the
// central gate in `lib/authPrompt.ts`, so a dismissal or an earlier prompt
// stops it for good.
//
// Active time carries across public-page navigations within the SPA, so
// landing → features doesn't restart the clock.

import { useEffect } from "react";
import {
  AUTH_PROMPT_DELAY_ACTIVE_MS,
  AUTH_PROMPT_PERMANENT_BLOCKS,
  requestAuthPrompt,
  shouldShowAuthPrompt,
} from "@/lib/authPrompt";

// Input within this window counts as "active" (matches useLandingAnalytics).
const ACTIVE_WINDOW_MS = 10_000;
const TICK_MS = 1_000;
// A pause this long after the last input reads as "settled" (not mid-scroll,
// not mid-tap) — the prompt appears in that pause.
const SETTLE_MS = 1_200;
const ACTIVITY_EVENTS = [
  "pointerdown",
  "pointermove",
  "keydown",
  "scroll",
  "touchstart",
  "wheel",
] as const;

// Module-level so the accumulated engagement survives route changes.
let activeMs = 0;

export function useDelayedAuthPrompt(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return undefined;

    // Nothing to wait for when a permanent block is already in place
    // (dismissed earlier, already shown this session, wrong page…).
    const initial = shouldShowAuthPrompt("delayed");
    if (
      initial.ok === false &&
      AUTH_PROMPT_PERMANENT_BLOCKS.has(initial.reason)
    ) {
      return undefined;
    }

    let lastInput = performance.now();
    const onActivity = () => {
      lastInput = performance.now();
    };
    ACTIVITY_EVENTS.forEach((ev) =>
      window.addEventListener(ev, onActivity, { passive: true }),
    );

    let timer: number | undefined = window.setInterval(() => {
      const now = performance.now();
      const sinceInput = now - lastInput;
      const active =
        document.visibilityState === "visible" && sinceInput < ACTIVE_WINDOW_MS;
      if (active) activeMs += TICK_MS;
      if (activeMs < AUTH_PROMPT_DELAY_ACTIVE_MS) return;

      // Engaged enough. Fire only in a pause: still around (input in the
      // last 10 s) but not in the middle of a scroll or tap.
      if (sinceInput < SETTLE_MS || sinceInput >= ACTIVE_WINDOW_MS) return;

      if (requestAuthPrompt("delayed")) {
        stop();
        return;
      }
      const decision = shouldShowAuthPrompt("delayed");
      if (
        decision.ok === false &&
        AUTH_PROMPT_PERMANENT_BLOCKS.has(decision.reason)
      ) {
        stop();
      }
      // Otherwise (another overlay open, tab hidden, typing…) try again on
      // the next tick.
    }, TICK_MS);

    function stop() {
      if (timer !== undefined) {
        window.clearInterval(timer);
        timer = undefined;
      }
      ACTIVITY_EVENTS.forEach((ev) =>
        window.removeEventListener(ev, onActivity),
      );
    }

    return stop;
  }, [enabled]);
}
