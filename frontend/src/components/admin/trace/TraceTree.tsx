// The execution tree of one trace: a row per recorded step, nested by
// parent, read top to bottom. Each row names the step, says what kind it is,
// gives the facts worth knowing without opening it, flags anything that did
// not end cleanly, and draws when it ran under the row on a time axis shared
// by every row — so work that overlapped (generator tools in worker threads)
// lines up visibly.
//
// Only rows are rendered here. A step's payload is rendered by the caller,
// for the selected step alone (prompts run to tens of thousands of chars).

import {
  Fragment,
  useMemo,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { SpanStatusBadge } from "./TraceBlocks";
import { kindMeta, spanStatusMeta } from "./traceKinds";
import {
  formatMs,
  isProblemStatus,
  spanFacts,
  visibleRows,
  type TraceNode,
  type TraceTree as TraceTreeData,
} from "./traceModel";

interface TraceTreeProps {
  tree: TraceTreeData;
  expanded: Set<string>;
  selectedId: string | null;
  onToggle: (spanId: string) => void;
  onSelect: (spanId: string) => void;
  /** Narrow layouts: the selected step's details, right under its row. */
  renderInline?: (node: TraceNode) => ReactNode;
}

function countDescendants(node: TraceNode): number {
  let total = 0;
  for (const child of node.children) total += 1 + countDescendants(child);
  return total;
}

function TimingBar({ node, totalMs }: { node: TraceNode; totalMs: number }) {
  const { span } = node;
  const left = Math.min(Math.max((span.start_ms / totalMs) * 100, 0), 99.5);
  const width = Math.min(
    Math.max(((span.duration_ms ?? 0) / totalMs) * 100, 0),
    100 - left,
  );
  const status = spanStatusMeta(span.status);
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-muted/70"
    >
      <span
        className={cn(
          "absolute inset-y-0 rounded-full",
          status ? status.bar : kindMeta(span.kind).bar,
        )}
        style={{ left: `${left}%`, width: `max(${width}%, 2px)` }}
      />
    </span>
  );
}

function TreeRow({
  node,
  totalMs,
  open,
  selected,
  onToggle,
  onSelect,
}: {
  node: TraceNode;
  totalMs: number;
  open: boolean;
  selected: boolean;
  onToggle: (spanId: string) => void;
  onSelect: (spanId: string) => void;
}) {
  const { span } = node;
  const kind = kindMeta(span.kind);
  const Icon = kind.icon;
  const hasChildren = node.children.length > 0;
  const facts = spanFacts(span);
  // A closed row must not hide a failure somewhere below it.
  const hiddenProblem =
    hasChildren && !open && node.problem && !isProblemStatus(span.status);

  return (
    <div
      className={cn(
        "relative flex items-stretch border-b border-border/60",
        selected ? "bg-primary/10" : "hover:bg-accent/40",
      )}
    >
      {selected && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-[3px] bg-primary"
        />
      )}
      {Array.from({ length: node.depth }).map((_, level) => (
        <span
          key={level}
          aria-hidden
          className="ml-2 w-1.5 shrink-0 border-l border-border/70"
        />
      ))}
      {hasChildren ? (
        <button
          type="button"
          onClick={() => onToggle(span.id)}
          aria-expanded={open}
          aria-label={open ? `Collapse ${span.name}` : `Expand ${span.name}`}
          data-analytics-name="Toggle trace step"
          className="grid w-7 shrink-0 place-items-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <ChevronRight
            className={cn("h-4 w-4 transition-transform", open && "rotate-90")}
          />
        </button>
      ) : (
        <span aria-hidden className="w-7 shrink-0" />
      )}
      <button
        type="button"
        data-span-row={span.id}
        aria-current={selected ? "true" : undefined}
        onClick={() => onSelect(span.id)}
        data-analytics-name="Select trace step"
        title={`Started +${formatMs(span.start_ms)} · took ${formatMs(span.duration_ms)}`}
        className={cn(
          "flex min-h-11 min-w-0 flex-1 items-start gap-2 pb-2 pr-2.5 pt-1.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          span.status === "skipped" && "opacity-60",
        )}
      >
        <span
          className={cn(
            "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded",
            kind.chip,
          )}
        >
          <Icon className="h-3 w-3" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate font-mono text-[13px] font-medium leading-5">
              {span.name}
            </span>
            <SpanStatusBadge status={span.status} />
            {hiddenProblem && (
              <span
                title="A step inside did not finish cleanly"
                className="inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-red-600 dark:text-red-400"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                problem inside
              </span>
            )}
            {node.orphan && (
              <span
                title="The step this ran under was not stored, so it is shown at the top level"
                className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
              >
                parent missing
              </span>
            )}
            <span className="ml-auto shrink-0 pl-2 font-mono text-[11px] tabular-nums text-muted-foreground">
              {formatMs(span.duration_ms)}
            </span>
          </span>
          <span className="block truncate text-[11px] leading-4 text-muted-foreground">
            <span className="text-[10px] font-semibold uppercase tracking-wide">
              {kind.label}
            </span>
            {facts.map((fact, index) => (
              <Fragment key={index}> · {fact}</Fragment>
            ))}
            {hasChildren && !open && (
              <> · {countDescendants(node)} steps inside</>
            )}
          </span>
        </span>
      </button>
      <TimingBar node={node} totalMs={totalMs} />
    </div>
  );
}

export function TraceTree({
  tree,
  expanded,
  selectedId,
  onToggle,
  onSelect,
  renderInline,
}: TraceTreeProps) {
  const container = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => visibleRows(tree, expanded), [tree, expanded]);

  // Arrow keys walk the tree like a file explorer: up / down between rows,
  // right opens (then enters), left closes (then goes to the parent).
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const origin = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-span-row]",
    );
    const index = rows.findIndex(
      (node) => node.span.id === origin?.dataset.spanRow,
    );
    if (index < 0) return;
    const node = rows[index];
    const open = expanded.has(node.span.id);
    const go = (target: TraceNode | undefined | null) => {
      if (!target) return;
      onSelect(target.span.id);
      container.current
        ?.querySelector<HTMLElement>(
          `[data-span-row=${JSON.stringify(target.span.id)}]`,
        )
        ?.focus();
    };
    switch (event.key) {
      case "ArrowDown":
        go(rows[index + 1]);
        break;
      case "ArrowUp":
        go(rows[index - 1]);
        break;
      case "ArrowRight":
        if (node.children.length === 0) return;
        if (open) go(node.children[0]);
        else onToggle(node.span.id);
        break;
      case "ArrowLeft":
        if (node.children.length > 0 && open) onToggle(node.span.id);
        else go(node.parent);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  if (rows.length === 0) {
    return (
      <p className="px-4 py-10 text-center text-sm text-muted-foreground">
        No steps were stored for this trace.
      </p>
    );
  }

  return (
    <div>
      <div
        aria-hidden
        className="flex items-center justify-between gap-3 border-b bg-muted/40 px-2.5 py-1 font-mono text-[10px] text-muted-foreground"
      >
        <span>0 ms</span>
        <span className="truncate font-sans">
          the bar under each step shows when it ran
        </span>
        <span>{formatMs(tree.totalMs)}</span>
      </div>
      <div
        ref={container}
        role="group"
        aria-label="Execution steps"
        onKeyDown={onKeyDown}
        className="[&>*:last-child]:border-b-0"
      >
        {rows.map((node) => {
          const selected = node.span.id === selectedId;
          return (
            <Fragment key={node.span.id}>
              <TreeRow
                node={node}
                totalMs={tree.totalMs}
                open={expanded.has(node.span.id)}
                selected={selected}
                onToggle={onToggle}
                onSelect={onSelect}
              />
              {selected && renderInline && (
                <div className="border-b bg-muted/20 p-3 sm:p-4">
                  {renderInline(node)}
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
