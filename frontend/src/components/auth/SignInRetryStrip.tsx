// "Sign-in didn't finish — try again": shown on the landing page when a
// same-tab Google sign-in came back to the site without a session (back
// button, bounce; `LOGIN_ABANDONED via=returned`). A fixed strip at the
// bottom of the screen, above the safe area, so it is reachable with one
// thumb on a phone and never covers the hero.

import { useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { analytics, AnalyticsEvent } from "@/lib/analytics";
import {
  landingElapsedS,
  landingScrollPct,
  noteLandingCtaClick,
} from "@/lib/analytics/landing";

export function SignInRetryStrip() {
  const {
    signInReturned,
    dismissSignInReturned,
    signInWithRedirect,
    isAuthenticated,
    signingIn,
  } = useAuth();
  const reduce = useReducedMotion();
  const show = signInReturned !== null && !isAuthenticated;

  useEffect(() => {
    if (!show) return;
    analytics.track(AnalyticsEvent.LOGIN_RETRY_SHOWN, {
      elapsed_ms: signInReturned ?? 0,
    });
  }, [show, signInReturned]);

  const retry = () => {
    noteLandingCtaClick();
    analytics.track(AnalyticsEvent.LANDING_CTA_CLICKED, {
      location: "retry_strip",
      time_since_entry_s: landingElapsedS(),
      scroll_pct: landingScrollPct(),
    });
    signInWithRedirect();
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          role="status"
          initial={{ opacity: 0, y: reduce ? 0 : 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reduce ? 0 : 12 }}
          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          className="fixed inset-x-0 bottom-0 z-40 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
        >
          <div className="glass-strong mx-auto flex max-w-xl items-center gap-2 rounded-2xl py-2 pl-4 pr-1 shadow-glow sm:gap-3">
            <AlertCircle
              className="h-5 w-5 shrink-0 text-amber-500"
              aria-hidden="true"
            />
            <p className="min-w-0 flex-1 text-sm leading-snug">
              <span className="font-semibold">Sign-in didn't finish.</span>{" "}
              <span className="text-muted-foreground">
                You're not signed in yet.
              </span>
            </p>
            <Button
              variant="brand"
              size="sm"
              className="min-h-11 shrink-0 rounded-full px-4"
              disabled={signingIn}
              data-analytics-name="Sign in retry strip"
              onClick={retry}
            >
              Try again
            </Button>
            <button
              type="button"
              aria-label="Dismiss"
              data-analytics-name="Sign in retry dismiss"
              onClick={dismissSignInReturned}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
