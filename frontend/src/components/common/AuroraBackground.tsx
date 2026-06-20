import { cn } from "@/lib/utils";

/**
 * Ambient, always-moving aurora blobs behind hero content. Pure CSS animations
 * (transform-only) for cheap continuous motion; `motion-loop` lets the global
 * reduced-motion rule freeze them.
 */
export function AuroraBackground({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 -z-10 overflow-hidden",
        className,
      )}
    >
      <div className="motion-loop absolute -left-24 -top-24 h-[28rem] w-[28rem] animate-aurora-drift rounded-full bg-brand-1/30 blur-3xl" />
      <div className="motion-loop absolute right-[-10%] top-[10%] h-[26rem] w-[26rem] animate-float-slow rounded-full bg-brand-3/25 blur-3xl" />
      <div className="motion-loop absolute bottom-[-15%] left-[20%] h-[30rem] w-[30rem] animate-aurora-drift rounded-full bg-brand-4/20 blur-3xl [animation-delay:-6s]" />
      <div className="absolute inset-0 bg-background/10" />
    </div>
  );
}
