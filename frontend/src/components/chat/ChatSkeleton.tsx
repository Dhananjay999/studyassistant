import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder shown while a session's history loads (no New Chat flicker). */
export function ChatSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-6">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={i % 2 === 0 ? "flex flex-row-reverse gap-3" : "flex gap-3"}
        >
          <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
          <div className="w-full max-w-[70%] space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            {i % 2 === 1 && <Skeleton className="h-4 w-2/3" />}
          </div>
        </div>
      ))}
    </div>
  );
}
