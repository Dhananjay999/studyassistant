// Pro marks on the user's avatar wherever the profile icon appears (header,
// sidebar account button, mobile Profile tab, profile and account pages).
// Both render nothing on the free plan, so those controls look exactly as
// before until Pro is activated.
//
// `ProAvatarFrame` wraps an Avatar: a brand ring around it plus the ✨ badge
// in its corner. `ProAvatarBadge` is the badge alone, for a wrapper that
// already positions itself.

import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { hasProAccess } from "@/lib/plan";
import { cn } from "@/lib/utils";

type BadgeSize = "sm" | "md";

export function ProAvatarBadge({
  className,
  size = "md",
}: {
  className?: string;
  /** `sm` for the tight sidebar, header and bottom-nav avatars. */
  size?: BadgeSize;
}) {
  const { user } = useAuth();
  if (!hasProAccess(user)) return null;
  return (
    <span
      aria-hidden
      data-analytics-ignore
      className={cn(
        "pointer-events-none absolute -bottom-0.5 -right-0.5 grid place-items-center rounded-full bg-brand-gradient text-white ring-2 ring-background animate-in zoom-in-50 duration-200 motion-reduce:animate-none",
        size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4",
        className,
      )}
    >
      <Sparkles className={size === "sm" ? "h-2 w-2" : "h-2.5 w-2.5"} />
    </span>
  );
}

export function ProAvatarFrame({
  children,
  size = "md",
  className,
  badgeClassName,
}: {
  children: ReactNode;
  size?: BadgeSize;
  className?: string;
  badgeClassName?: string;
}) {
  const { user } = useAuth();
  const pro = hasProAccess(user);
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 rounded-full",
        // The ring sits outside the avatar with a thin gap in the page
        // background, so it reads as a frame rather than a thicker edge.
        pro &&
          (size === "sm"
            ? "ring-[1.5px] ring-brand-1 ring-offset-1 ring-offset-background"
            : "ring-2 ring-brand-1 ring-offset-2 ring-offset-background"),
        className,
      )}
    >
      {children}
      <ProAvatarBadge size={size} className={badgeClassName} />
    </span>
  );
}
