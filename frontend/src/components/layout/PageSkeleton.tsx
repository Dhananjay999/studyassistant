/**
 * Lightweight content-area skeleton used as the inner Suspense fallback while a
 * page chunk loads. Never full-screen — the persistent header + sidebar frame
 * it — so navigation never flashes the global {@link AppLoader}.
 */
export function PageSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 p-4" aria-hidden>
      <div className="h-24 animate-pulse rounded-2xl bg-muted/50" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl bg-muted/50" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-2xl bg-muted/50" />
    </div>
  );
}
