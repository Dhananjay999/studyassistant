// Admin overview drill-down: the users behind an engagement figure
// ("6 returning", "4 new", "10 active"). A bottom sheet on phones and a side
// sheet on desktop; rows open the user's detail view. Data comes from
// GET /admin/overview/engagement/users (migration 034), one keyset page at a
// time.

import { motion, useReducedMotion } from "framer-motion";
import { ChevronRight, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/admin/UserAvatar";
import { useAdminEngagementUsers } from "@/hooks/adminApi";
import { useIsMobileShell } from "@/hooks/useIsMobileShell";
import { formatDate, formatDateTime, formatNumber, zoneLabel } from "@/lib/adminFormat";
import { cn } from "@/lib/utils";
import type { AdminEngagementUserKind } from "@/types/admin";

const KIND_LABEL: Record<AdminEngagementUserKind, string> = {
  returning: "Returning users",
  new: "New users",
  active: "Active users",
};

const KIND_DETAIL: Record<AdminEngagementUserKind, string> = {
  returning: "signed up before the window and came back",
  new: "signed up inside the window",
  active: "anyone who used the app",
};

interface Props {
  kind: AdminEngagementUserKind | null;
  days: number;
  timezone: string;
  /** Count from the engagement summary, shown in the header. */
  total: number;
  onClose: () => void;
  onSelectUser?: (id: string) => void;
}

export function EngagementUsersSheet({
  kind,
  days,
  timezone,
  total,
  onClose,
  onSelectUser,
}: Props) {
  const isMobileShell = useIsMobileShell();
  const reduceMotion = useReducedMotion();
  const open = kind !== null;
  const query = useAdminEngagementUsers(days, kind ?? "returning", open);
  const pages = query.data?.pages ?? [];
  const unavailable = pages.length > 0 && !pages[0].available;
  const rows = pages.flatMap((p) => p.users);

  const pick = (id: string) => {
    onClose();
    onSelectUser?.(id);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      analyticsName="ENGAGEMENT_USERS"
    >
      <SheetContent
        side={isMobileShell ? "bottom" : "right"}
        className={cn(
          "flex flex-col gap-0 p-0",
          isMobileShell
            ? "max-h-[85dvh] rounded-t-2xl pb-safe"
            : "w-full sm:max-w-lg",
        )}
      >
        <SheetHeader className="space-y-1 border-b px-4 pb-3 pt-5 text-left sm:px-5">
          <SheetTitle className="text-base">
            {kind ? KIND_LABEL[kind] : "Users"}
            {total > 0 && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {formatNumber(total)}
              </span>
            )}
          </SheetTitle>
          <SheetDescription className="text-xs">
            Last {days} days ({zoneLabel(timezone)}) ·{" "}
            {kind ? KIND_DETAIL[kind] : ""}. Tap a user to open their profile.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2 sm:px-3">
          {query.isError ? (
            <p className="px-2 py-6 text-sm text-destructive">
              {query.error instanceof Error
                ? query.error.message
                : "Failed to load users."}
            </p>
          ) : unavailable ? (
            <p className="m-2 rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              This list needs database migration 034 (admin_engagement_users).
              Apply it and reload.
            </p>
          ) : query.isLoading ? (
            <ul className="space-y-1" aria-busy="true">
              {Array.from({ length: 6 }).map((_, i) => (
                <li key={i}>
                  <Skeleton className="h-14 w-full rounded-lg" />
                </li>
              ))}
            </ul>
          ) : rows.length === 0 ? (
            <p className="px-2 py-10 text-center text-sm text-muted-foreground">
              Nobody in this group for the last {days} days.
            </p>
          ) : (
            <ul
              className="divide-y"
              data-analytics-private
              data-analytics-section="admin_engagement_users"
            >
              {rows.map((row, i) => (
                <motion.li
                  key={row.id}
                  initial={
                    reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6 }
                  }
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.18,
                    ease: "easeOut",
                    // Stagger only the first screenful; later pages just appear.
                    delay: i < 8 ? i * 0.025 : 0,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => pick(row.id)}
                    data-analytics-name="Open user"
                    className="flex min-h-[56px] w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors active:bg-muted/70 mouse:hover:bg-muted/50"
                  >
                    <UserAvatar
                      name={row.full_name}
                      email={row.email}
                      src={row.avatar_url}
                      className="h-9 w-9"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium">
                          {row.full_name || row.email || "Unknown user"}
                        </span>
                        {kind === "active" && row.is_new && (
                          <Badge
                            variant="secondary"
                            className="h-5 shrink-0 px-1.5 text-[10px]"
                          >
                            New
                          </Badge>
                        )}
                      </span>
                      {row.full_name && row.email && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {row.email}
                        </span>
                      )}
                      <span className="block truncate text-[11px] text-muted-foreground">
                        Joined {formatDate(row.joined_at)} · last active{" "}
                        {formatDateTime(row.last_active)}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-sm font-semibold tabular-nums">
                        {row.active_days}
                      </span>
                      <span className="block text-[10px] text-muted-foreground">
                        {row.active_days === 1 ? "day" : "days"}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                </motion.li>
              ))}
            </ul>
          )}
        </div>

        {query.hasNextPage && !unavailable && (
          <div className="border-t p-3">
            <Button
              variant="outline"
              className="h-11 w-full sm:h-10"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              Load more
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
