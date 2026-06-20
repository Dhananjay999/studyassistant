import { cn } from "@/lib/utils";

/**
 * Infinite horizontal marquee. The track is duplicated so the -50% translate
 * loops seamlessly. Edges fade via `mask-fade-x`.
 */
export function Marquee({
  items,
  durationSec = 30,
  className,
}: {
  items: string[];
  durationSec?: number;
  className?: string;
}) {
  return (
    <div className={cn("mask-fade-x overflow-hidden", className)}>
      <div
        className="motion-loop flex w-max animate-marquee gap-3"
        style={{ ["--marquee-duration" as string]: `${durationSec}s` }}
      >
        {[0, 1].map((dup) => (
          <ul key={dup} className="flex shrink-0 gap-3" aria-hidden={dup === 1}>
            {items.map((item) => (
              <li
                key={`${dup}-${item}`}
                className="whitespace-nowrap rounded-full border border-border/60 bg-card/40 px-4 py-1.5 text-sm text-muted-foreground"
              >
                {item}
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}
