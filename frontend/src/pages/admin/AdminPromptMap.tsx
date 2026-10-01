// Prompt Map: what a prompt edit would touch, seen before making it.
//
// Three views of one selection. The pick lists name every prompt template
// and shared block. The pipeline map shows where each prompt runs; with a
// prompt or a block selected, every step that would change is lit and the
// rest is dimmed (the blast radius). The detail shows the text, the model,
// what runs before and after, and the versions that have been live.
//
// On wide screens the lists are a rail beside the map / detail; below that
// they are a third tab. The map and the text come from the code, so they
// work without the trace tables; usage counts and version history need
// migration 024.

import { useMemo, useRef, useState } from "react";
import {
  Blocks,
  FileText,
  ListChecks,
  Route,
  TriangleAlert,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { BlockDetail } from "@/components/admin/prompts/BlockDetail";
import { SelectionStrip } from "@/components/admin/prompts/BlastRadius";
import { PipelineMap } from "@/components/admin/prompts/PipelineMap";
import { PromptDetail } from "@/components/admin/prompts/PromptDetail";
import {
  BlockList,
  TemplateList,
} from "@/components/admin/prompts/PromptLists";
import { ScrollPane } from "@/components/admin/prompts/parts";
import {
  blastRadius,
  blockSelectionKey,
  buildCatalogIndex,
  parseSelection,
  plural,
  relatedNodes,
  type FlowRelation,
  type PromptSelection,
} from "@/components/admin/prompts/promptMapModel";
import { NoTraceAccess } from "@/components/admin/trace/TraceAccess";
import { useAdminPromptCatalog } from "@/hooks/adminTraceApi";
import { AdminForbiddenError } from "@/lib/adminTraceApi";
import { cn } from "@/lib/utils";

const DAY_OPTIONS = [7, 30] as const;

/** `list` exists as a tab only below `xl`, where the rail is not shown. */
type View = "list" | "map" | "detail";

function scrollBehavior(): ScrollBehavior {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
}

function isOnScreen(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  // The sticky selection bar covers the top of the pane.
  return rect.top >= 140 && rect.bottom <= window.innerHeight;
}

function DaysSelector({
  days,
  onChange,
}: {
  days: number;
  onChange: (days: number) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Usage window"
      className="inline-flex items-center gap-1 rounded-md bg-muted p-1 text-sm"
    >
      {DAY_OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={days === option}
          data-analytics-name={`Prompt usage last ${option} days`}
          onClick={() => onChange(option)}
          className={cn(
            "h-9 rounded-sm px-3 font-medium text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-7",
            days === option && "bg-background text-foreground shadow-sm",
          )}
        >
          {option} days
        </button>
      ))}
    </div>
  );
}

const TAB_BASE =
  "inline-flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-sm px-3 text-sm font-medium text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8";
const TAB_ACTIVE = "bg-background text-foreground shadow-sm";
// The map tab stands in for the list tab where the list is a rail.
const TAB_ACTIVE_XL = "xl:bg-background xl:text-foreground xl:shadow-sm";

function ViewTab({
  id,
  view,
  icon: Icon,
  label,
  badge = null,
  className,
  onSelect,
}: {
  id: View;
  view: View;
  icon: LucideIcon;
  label: string;
  /** Number of affected pipeline steps to flag on the tab. */
  badge?: number | null;
  className?: string;
  onSelect: (view: View) => void;
}) {
  const active = view === id;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      data-analytics-name={`Prompt map ${id} tab`}
      onClick={() => onSelect(id)}
      className={cn(
        TAB_BASE,
        active && TAB_ACTIVE,
        id === "map" && view === "list" && TAB_ACTIVE_XL,
        className,
      )}
    >
      <Icon className="hidden h-3.5 w-3.5 shrink-0 sm:block" aria-hidden />
      <span className="truncate">{label}</span>
      {badge !== null && (
        <span
          title={`${badge} pipeline ${badge === 1 ? "step" : "steps"} affected`}
          className="shrink-0 rounded-full bg-primary px-1.5 py-px text-[10px] font-semibold text-primary-foreground"
        >
          {badge}
          <span className="hidden sm:inline"> affected</span>
        </span>
      )}
    </button>
  );
}

function ListHeading({
  icon: Icon,
  title,
  count,
  hint,
}: {
  icon: LucideIcon;
  title: string;
  count: number;
  hint: string;
}) {
  return (
    <div className="border-b bg-muted/30 px-3 py-2">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
        {title}
        <span className="font-normal text-muted-foreground">({count})</span>
      </p>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="grid gap-4 xl:grid-cols-[20rem_minmax(0,1fr)]">
      <Skeleton className="hidden h-96 w-full xl:block" />
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  );
}

export function AdminPromptMap(props: {
  selected: string | null;
  onSelect: (name: string | null) => void;
  onOpenTraces: (filter: { prompt?: string; tool?: string }) => void;
}): JSX.Element {
  const { selected, onSelect, onOpenTraces } = props;
  const [days, setDays] = useState<number>(DAY_OPTIONS[0]);
  const [showDetails, setShowDetails] = useState(false);
  // A link that names a prompt opens on its detail; otherwise the map.
  const [view, setView] = useState<View>(selected ? "detail" : "map");
  // Changing the usage window refetches under a new key; the hook keeps the
  // catalog already on screen meanwhile (only the counts differ).
  const query = useAdminPromptCatalog(days);
  const catalog = query.data;
  const updating = query.isPlaceholderData && query.isFetching;
  const forbidden = query.error instanceof AdminForbiddenError;

  const index = useMemo(
    () => (catalog ? buildCatalogIndex(catalog) : null),
    [catalog],
  );
  const selection = useMemo(() => parseSelection(selected), [selected]);
  const radius = useMemo(
    () => (index ? blastRadius(index, selection) : null),
    [index, selection],
  );
  const template =
    selection?.kind === "template"
      ? (index?.templateByName.get(selection.name) ?? null)
      : null;
  const block =
    selection?.kind === "block"
      ? (index?.blockByName.get(selection.name) ?? null)
      : null;
  const related = useMemo(
    () =>
      index ? relatedNodes(index, template) : new Map<string, FlowRelation>(),
    [index, template],
  );
  const affectedTemplates = useMemo(
    () => new Set(radius?.templates ?? []),
    [radius],
  );

  const paneRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLElement>(null);

  /** Bring the top of the map / detail pane back if it scrolled away. */
  const revealPane = () => {
    const el = paneRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight * 0.6) {
      el.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
    }
  };
  /** Scroll one step of the map into view (after the map is showing). */
  const revealNode = (key: string | undefined) => {
    // Keys are `stage/node` ids; compare as data rather than build a
    // selector out of them.
    const node = key
      ? Array.from(
          mapRef.current?.querySelectorAll<HTMLElement>("[data-flow-node]") ??
            [],
        ).find((el) => el.dataset.flowNode === key)
      : null;
    if (!node) revealPane();
    else if (!isOnScreen(node)) {
      node.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
    }
  };
  // Panels are toggled with CSS, so wait a frame for the new one to lay out.
  const afterPaint = (run: () => void) =>
    window.requestAnimationFrame(() => window.requestAnimationFrame(run));

  const showView = (next: View) => {
    setView(next);
    afterPaint(revealPane);
  };
  const showOnMap = (key?: string) => {
    setView("map");
    afterPaint(() => revealNode(key ?? radius?.nodes[0]?.key));
  };

  // A click on the map keeps the view where it is: the lit steps are the
  // answer. A pick from the lists (or a chip in the detail) keeps the
  // current view and brings its result on screen: the first lit step on the
  // map, or the top of the detail. From the list tab it opens the detail.
  const selectOnMap = (name: string) => onSelect(name);
  const pick = (next: PromptSelection) => {
    onSelect(
      next.kind === "block" ? blockSelectionKey(next.name) : next.name,
    );
    if (view === "map") {
      const first = index ? blastRadius(index, next).nodes[0]?.key : undefined;
      afterPaint(() => revealNode(first));
    } else {
      if (view === "list") setView("detail");
      afterPaint(revealPane);
    }
  };
  const selectTemplate = (name: string) => pick({ kind: "template", name });
  const selectBlock = (name: string) => pick({ kind: "block", name });
  const clear = () => onSelect(null);

  const statsAvailable = catalog?.stats_available !== false;
  const known = !!template || !!block;
  const affectedCount = known ? (radius?.nodes.length ?? 0) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2">
          <Workflow className="h-5 w-5 shrink-0 text-primary" />
          <h1 className="whitespace-nowrap text-xl font-semibold tracking-tight">
            Prompt Map
          </h1>
          {index && (
            <span className="text-sm text-muted-foreground">
              ({plural(index.templates.length, "template")},{" "}
              {plural(index.blocks.length, "shared block")})
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {updating && (
            <span className="text-xs text-muted-foreground">updating…</span>
          )}
          <span className="text-xs text-muted-foreground">Usage over</span>
          <DaysSelector days={days} onChange={setDays} />
        </div>
      </div>
      <p className="max-w-2xl text-sm text-muted-foreground">
        See what a prompt edit reaches before making it. Pick a prompt or a
        shared block: the pipeline lights up every step that would change,
        and the detail shows its text, model, neighbours and versions.
      </p>

      {query.isError && !forbidden && (
        <p className="text-sm text-destructive">
          {query.error instanceof Error
            ? query.error.message
            : "Failed to load."}
        </p>
      )}

      {forbidden ? (
        <NoTraceAccess what="the Prompt Map" />
      ) : !catalog || !index || !radius ? (
        query.isError ? null : (
          <PageSkeleton />
        )
      ) : (
        <>
          {!statsAvailable && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
            >
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p>
                Usage counts and version history need migration{" "}
                <code className="font-mono text-xs">
                  024_ai_execution_traces.sql
                </code>{" "}
                to be applied. The map, the prompt text and the blast radius
                come from the code and work without it.
              </p>
            </div>
          )}

          <div className="grid items-start gap-4 xl:grid-cols-[20rem_minmax(0,1fr)]">
            {/* Pick lists: a rail at xl (beside the pane, in its own
               visibly scrollable region), the "Prompts" tab below that.
               In the grid's second row below xl, under the tab bar. */}
            <div
              className={cn(
                "row-start-2 overflow-hidden rounded-xl border xl:sticky xl:top-0 xl:row-start-1 xl:block",
                view !== "list" && "hidden",
              )}
            >
              <ScrollPane
                label="Prompts and shared blocks"
                className="xl:max-h-[calc(100dvh-4rem)]"
              >
                <ListHeading
                  icon={FileText}
                  title="Prompts"
                  count={index.templates.length}
                  hint={
                    statsAvailable
                      ? `Version, where it runs, model config, usage over ${days} days.`
                      : "Version, where it runs and model config."
                  }
                />
                <TemplateList
                  index={index}
                  selection={selection}
                  affectedTemplates={affectedTemplates}
                  statsAvailable={statsAvailable}
                  days={days}
                  onSelect={selectTemplate}
                />
                <div className="border-t" />
                <ListHeading
                  icon={Blocks}
                  title="Shared blocks"
                  count={index.blocks.length}
                  hint="Text embedded in several prompts. One edit changes them all."
                />
                <BlockList
                  index={index}
                  selection={selection}
                  onSelect={selectBlock}
                />
              </ScrollPane>
            </div>

            {/* No overflow clipping on this column: the selection bar is
               sticky against the page scroll. */}
            <div ref={paneRef} className="min-w-0 scroll-mt-4 space-y-3">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div
                  role="tablist"
                  aria-label="Prompt map views"
                  className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted p-1"
                >
                  <ViewTab
                    id="list"
                    view={view}
                    icon={ListChecks}
                    label="Prompts"
                    className="xl:hidden"
                    onSelect={showView}
                  />
                  <ViewTab
                    id="map"
                    view={view}
                    icon={Route}
                    label="Pipeline"
                    badge={affectedCount > 0 ? affectedCount : null}
                    onSelect={showView}
                  />
                  <ViewTab
                    id="detail"
                    view={view}
                    icon={FileText}
                    label="Detail"
                    onSelect={showView}
                  />
                </div>
                <label
                  className={cn(
                    "ml-auto flex min-h-9 cursor-pointer items-center gap-2 text-xs text-muted-foreground",
                    view === "detail" && "hidden",
                    view === "list" && "hidden xl:flex",
                  )}
                >
                  <Switch
                    checked={showDetails}
                    onCheckedChange={setShowDetails}
                    aria-label="Show full conditions, step descriptions and code locations"
                  />
                  Full conditions and code
                </label>
              </div>

              {selection && (
                <SelectionStrip
                  selection={selection}
                  radius={radius}
                  live={template?.usage?.live !== false}
                  known={known}
                  downstream={template?.usage?.downstream?.length ?? 0}
                  view={view}
                  onFocusNode={showOnMap}
                  onShowMap={() => showOnMap()}
                  onShowDetail={() => showView("detail")}
                  onClear={clear}
                />
              )}

              <section
                ref={mapRef}
                aria-label="Execution pipeline"
                className={cn(
                  "space-y-3",
                  view === "detail" && "hidden",
                  view === "list" && "hidden xl:block",
                )}
              >
                <p className="text-xs text-muted-foreground">
                  A chat turn runs top to bottom; steps side by side are the
                  alternatives or parts of one stage. A step that shows a
                  prompt name is clickable
                  {selection
                    ? "."
                    : ": select one (or a shared block) to light up every step an edit would change."}
                </p>
                <PipelineMap
                  index={index}
                  selection={known ? selection : null}
                  affected={radius.nodeKeys}
                  related={related}
                  showDetails={showDetails}
                  onSelectTemplate={selectOnMap}
                />
              </section>

              <div className={cn(view !== "detail" && "hidden")}>
                {template ? (
                  <PromptDetail
                    // Fresh local state (expanded text, open diff) per prompt.
                    key={template.name}
                    template={template}
                    index={index}
                    versions={catalog.versions}
                    statsAvailable={statsAvailable}
                    days={days}
                    onSelectTemplate={selectTemplate}
                    onSelectBlock={selectBlock}
                    onOpenTraces={onOpenTraces}
                  />
                ) : block ? (
                  <BlockDetail
                    key={block.name}
                    block={block}
                    index={index}
                    radius={radius}
                    statsAvailable={statsAvailable}
                    days={days}
                    onSelectTemplate={selectTemplate}
                  />
                ) : selection ? (
                  <div className="space-y-2 rounded-xl border p-5">
                    <p className="text-sm font-medium">
                      No{" "}
                      {selection.kind === "block" ? "shared block" : "prompt"}{" "}
                      named{" "}
                      <span className="break-all font-mono">
                        {selection.name}
                      </span>{" "}
                      in the current catalog.
                    </p>
                    <p className="text-sm text-muted-foreground">
                      It may have been renamed or removed since this link was
                      made. Pick one from the list.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed p-6 text-center">
                    <p className="text-sm font-medium">
                      Select a prompt or a shared block
                    </p>
                    <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                      Its detail opens here: where it is rendered and with
                      which model, what runs before and after it, the
                      template text, the blocks it shares with other
                      prompts, and the versions that have been live.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
