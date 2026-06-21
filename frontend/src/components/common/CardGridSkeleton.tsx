import { Skeleton } from "@/components/ui/skeleton";

/** Shimmering placeholder grid for list pages (quizzes, flashcards, files). */
export function CardGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-2xl border border-border/60 bg-card/50 p-4"
        >
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="mt-2 h-3 w-1/2" />
          <Skeleton className="mt-5 h-3 w-1/3" />
          <Skeleton className="mt-4 h-9 w-full rounded-lg" />
        </div>
      ))}
    </div>
  );
}
