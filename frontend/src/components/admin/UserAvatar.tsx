// Profile picture for admin user rows: the Google avatar when there is one,
// initials on a tinted disc otherwise (or while the image loads / if it
// fails). Shared by the users table and the engagement drill-down.

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface Props {
  name: string | null | undefined;
  email: string | null | undefined;
  src: string | null | undefined;
  /** Tailwind size classes; defaults to 32px. */
  className?: string;
}

function userInitials(
  name: string | null | undefined,
  email: string | null | undefined,
): string {
  const source = name || email || "?";
  return source
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function UserAvatar({ name, email, src, className }: Props) {
  return (
    <Avatar className={cn("h-8 w-8 shrink-0", className)}>
      {src && (
        <AvatarImage
          src={src}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      )}
      <AvatarFallback className="bg-primary/10 text-[11px] font-semibold text-primary">
        {userInitials(name, email)}
      </AvatarFallback>
    </Avatar>
  );
}
