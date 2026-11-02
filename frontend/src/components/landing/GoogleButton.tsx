import { Loader2 } from "lucide-react";
import { GoogleIcon } from "@/components/icons/BrandIcons";
import {
  landingElapsedS,
  landingScrollPct,
  noteLandingCtaClick,
} from "@/lib/analytics/landing";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { analytics, AnalyticsEvent, type CtaLocation } from "@/lib/analytics";

/** Primary CTA with an animated gradient border that runs continuously.
 *  `location` names where on the public site the button sits (analytics).
 *  `fullWidth` stretches the pill to its container (sheets, modals);
 *  `onClick` runs just before the sign-in flow starts. */
export function GoogleButton({
  label = "Continue with Google",
  className,
  location,
  fullWidth = false,
  onClick: onBeforeSignIn,
}: {
  label?: string;
  className?: string;
  location: CtaLocation;
  fullWidth?: boolean;
  onClick?: () => void;
}) {
  const { signInWithGoogle, signingIn } = useAuth();
  const onClick = () => {
    noteLandingCtaClick();
    analytics.track(AnalyticsEvent.LANDING_CTA_CLICKED, {
      location,
      time_since_entry_s: landingElapsedS(),
      scroll_pct: landingScrollPct(),
    });
    onBeforeSignIn?.();
    signInWithGoogle();
  };
  return (
    <button
      type="button"
      data-cta-location={location}
      onClick={onClick}
      disabled={signingIn}
      className={cn(
        "group relative inline-flex items-center justify-center rounded-full p-[1.5px]",
        "bg-[length:200%_200%] bg-brand-gradient motion-loop mouse:animate-gradient-pan shadow-glow",
        "transition-transform hover:scale-[1.02] active:scale-95",
        "disabled:cursor-not-allowed disabled:opacity-80",
        fullWidth && "w-full",
        className,
      )}
    >
      <span
        className={cn(
          "inline-flex items-center gap-2.5 rounded-full bg-background px-5 py-2.5 text-sm font-semibold text-foreground transition-colors group-hover:bg-background/85",
          fullWidth && "w-full justify-center",
        )}
      >
        {/* Both states stay mounted and toggle by class. Swapping the icon
            and the text node on click crashed the page for visitors using
            browser page translation (Chrome wraps text nodes in <font>, so
            React's insertBefore/removeChild could not find them: Sentry
            CLIENT-4, 4 of 14 non-English landers in one week). */}
        <span aria-hidden className="relative grid h-5 w-5 place-items-center">
          <GoogleIcon className={cn("h-5 w-5", signingIn && "invisible")} />
          <Loader2
            className={cn(
              "absolute h-5 w-5 animate-spin text-brand-1",
              !signingIn && "hidden",
            )}
          />
        </span>
        <span className={cn(signingIn && "hidden")}>{label}</span>
        <span className={cn(!signingIn && "hidden")}>Signing you in…</span>
      </span>
    </button>
  );
}
