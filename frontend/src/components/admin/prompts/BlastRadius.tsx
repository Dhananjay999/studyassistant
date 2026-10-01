// The blast radius in words. This bar sits above the map and the detail,
// whichever is showing: it names the selection, says how far an edit to it
// reaches, lists the affected pipeline steps (each one jumps to that step
// on the map), and clears the selection.

import { useEffect, useRef, useState } from "react";
import { FileText, Route, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  plural,
  type BlastRadius,
  type PromptSelection,
} from "./promptMapModel";

/** Affected steps listed before "+N more". */
const MAX_STEP_CHIPS = 10;

/** One sentence: what changes if the selection is edited. */
function radiusSentence(
  selection: PromptSelection,
  radius: BlastRadius,
  live: boolean,
): string {
  const steps = radius.nodes.length;
  if (selection.kind === "block") {
    if (radius.templates.length === 0) {
      return "No template embeds this block: editing it changes nothing.";
    }
    return (
      `Editing it changes ${plural(radius.templates.length, "template")}` +
      (steps > 0
        ? `, rendered by ${plural(steps, "pipeline step")}.`
        : ", none of them rendered by a step on the map.")
    );
  }
  if (!live) {
    return "No code path renders this template: editing it changes nothing at runtime.";
  }
  return steps > 0
    ? `Editing it changes ${plural(steps, "pipeline step")}.`
    : "No step on the map renders it.";
}

export function SelectionStrip({
  selection,
  radius,
  live,
  known,
  downstream,
  view,
  onFocusNode,
  onShowMap,
  onShowDetail,
  onClear,
}: {
  selection: PromptSelection;
  radius: BlastRadius;
  /** For a template: whether any code path renders it. */
  live: boolean;
  /** False when the URL names something the catalog does not have. */
  known: boolean;
  /** For a template: how many later steps consume what it produces. */
  downstream: number;
  /** Which panel is showing under the bar. */
  view: "list" | "map" | "detail";
  /** Show one affected step on the map. */
  onFocusNode: (key: string) => void;
  onShowMap: () => void;
  onShowDetail: () => void;
  onClear: () => void;
}) {
  // From `sm` up the bar is sticky while the panel scrolls under it. The
  // page scroller has padding, so a stuck bar floats below the top edge
  // with content showing in the gap above it; once stuck, that gap is
  // painted over.
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      // Several changes can arrive in one batch; the last is current.
      const entry = entries[entries.length - 1];
      // Out of view upwards (scrolled past), not still below the fold.
      setStuck(
        !entry.isIntersecting &&
          entry.boundingClientRect.top < window.innerHeight / 2,
      );
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  const steps = known ? radius.nodes : [];
  const shown = steps.slice(0, MAX_STEP_CHIPS);

  return (
    <>
      {/* Marks where the bar sits when it is not stuck (takes no space). */}
      <div ref={sentinelRef} aria-hidden className="!mt-0 h-0" />
      <div
        className={cn(
          "z-10 space-y-2 rounded-lg border border-primary/50 bg-background px-3 py-2 sm:sticky sm:top-0",
          stuck
            ? "sm:shadow-[0_-1.5rem_0_0_hsl(var(--background)),0_6px_12px_-4px_rgb(0_0_0/0.35)]"
            : "shadow-sm",
        )}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Zap className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 flex-1 basis-56" role="status">
            <p className="flex flex-wrap items-center gap-x-1.5 text-sm font-medium">
              <span className="text-muted-foreground">
                {selection.kind === "block" ? "Shared block" : "Prompt"}
              </span>
              <span className="break-all font-mono">{selection.name}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {known
                ? radiusSentence(selection, radius, live)
                : "Not in the current catalog."}
              {known && live && downstream > 0 && (
                <>
                  {" "}
                  {plural(downstream, "later step")} build on its output
                  (tagged “runs after” on the map).
                </>
              )}
              {known && radius.offMap.length > 0 && selection.kind === "block" && (
                <>
                  {" "}
                  Not on the map:{" "}
                  <span className="font-mono">{radius.offMap.join(", ")}</span>.
                </>
              )}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {known && view !== "map" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-9 gap-1.5 text-xs sm:h-8"
                data-analytics-name="Show prompt on map"
                onClick={onShowMap}
              >
                <Route className="h-3 w-3" />
                Show on map
              </Button>
            )}
            {known && view !== "detail" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-9 gap-1.5 text-xs sm:h-8"
                data-analytics-name="Open prompt detail"
                onClick={onShowDetail}
              >
                <FileText className="h-3 w-3" />
                Details
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-9 gap-1.5 text-xs text-muted-foreground sm:h-8"
              data-analytics-name="Clear prompt selection"
              onClick={onClear}
            >
              <X className="h-3 w-3" />
              Clear
            </Button>
          </div>
        </div>

        {shown.length > 0 && (
          <ul
            aria-label="Affected pipeline steps"
            className="flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2"
          >
            {shown.map((ref) => (
              <li key={ref.key} className="max-w-full">
                <button
                  type="button"
                  onClick={() => onFocusNode(ref.key)}
                  title={`${ref.stage.title}: show this step on the map`}
                  data-analytics-name="Show affected step on map"
                  className="inline-flex max-w-full items-center gap-1 rounded-full border border-primary/50 bg-primary/10 px-2 py-0.5 text-[11px] font-medium hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="truncate">{ref.node.label}</span>
                  {selection.kind === "block" && ref.node.prompt && (
                    <span className="hidden truncate font-mono text-[10px] font-normal text-muted-foreground sm:inline">
                      {ref.node.prompt}
                    </span>
                  )}
                </button>
              </li>
            ))}
            {steps.length > shown.length && (
              <li className="text-[11px] text-muted-foreground">
                +{steps.length - shown.length} more on the map
              </li>
            )}
          </ul>
        )}
      </div>
    </>
  );
}
