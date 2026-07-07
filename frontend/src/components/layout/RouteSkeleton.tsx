import { Skeleton } from "@/components/ui/skeleton";
import { CardGridSkeleton } from "@/components/common/CardGridSkeleton";

// Per-route loading skeletons that mirror each page's real content layout, so a
// navigation's chunk-load fallback looks like the page that's about to appear
// (a card grid, a chat thread, stat tiles…) instead of one generic block.

/** Search + sort/filter toolbar over a card grid — quizzes/flashcards/bookmarks/files. */
function ListPageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-4" aria-hidden>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Skeleton className="h-10 flex-1 rounded-xl" />
        <div className="flex gap-2">
          <Skeleton className="h-10 w-24 rounded-xl" />
          <Skeleton className="h-10 w-24 rounded-xl" />
        </div>
      </div>
      <CardGridSkeleton />
    </div>
  );
}

/** Alternating message bubbles + a composer bar — the chat page. */
function ChatPageSkeleton() {
  return (
    <div className="flex h-full flex-col" aria-hidden>
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-5 px-4 py-6">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={i % 2 === 0 ? "flex flex-row-reverse gap-3" : "flex gap-3"}
          >
            <Skeleton className="hidden h-8 w-8 shrink-0 rounded-full sm:block" />
            <div className="w-full max-w-[70%] space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              {i % 2 === 1 && <Skeleton className="h-4 w-2/3" />}
            </div>
          </div>
        ))}
      </div>
      <div className="mx-auto w-full max-w-4xl px-4 pb-4">
        <Skeleton className="h-12 w-full rounded-2xl" />
      </div>
    </div>
  );
}

/** Stat tiles over chart cards — the analytics page. */
function AnalyticsPageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-4" aria-hidden>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-72 w-full rounded-2xl" />
      <Skeleton className="h-64 w-full rounded-2xl" />
    </div>
  );
}

/** Profile header + grouped menu rows — the mobile profile page. */
function ProfilePageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 p-4" aria-hidden>
      <Skeleton className="h-20 w-full rounded-2xl" />
      {[0, 1, 2].map((g) => (
        <div key={g} className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <div className="space-y-2 rounded-2xl border border-border/60 p-2">
            {[0, 1].map((r) => (
              <Skeleton key={r} className="h-11 w-full rounded-lg" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Pick the skeleton whose shape matches the destination route. */
export function RouteSkeleton({ pathname }: { pathname: string }) {
  if (pathname.startsWith("/chat")) return <ChatPageSkeleton />;
  if (pathname.startsWith("/analytics")) return <AnalyticsPageSkeleton />;
  if (pathname.startsWith("/profile")) return <ProfilePageSkeleton />;
  // quizzes / flashcards / bookmarks / files (and a sensible default) are lists.
  return <ListPageSkeleton />;
}
