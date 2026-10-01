// One AI execution trace: what the user asked, how the turn was routed, and
// every recorded step as an expandable tree. Selecting a step shows what it
// received and returned (beside the tree on wide screens, under the row on
// narrow ones). The selected step lives in the URL (`&span=<id>`) so a link
// lands on the exact LLM call or decision being discussed.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronsDownUp,
  ChevronsUpDown,
  ListFilter,
  ListTree,
  Plus,
  User as UserIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SpanDetail } from "@/components/admin/trace/SpanDetail";
import { NoTraceAccess } from "@/components/admin/trace/TraceAccess";
import {
  CopyButton,
  Facts,
  LinkButton,
  Notice,
  TraceStatusBadge,
} from "@/components/admin/trace/TraceBlocks";
import { TraceTree } from "@/components/admin/trace/TraceTree";
import type { TraceFilters } from "@/components/admin/trace/traceFilters";
import {
  traceStatusNote,
  VISIBLE_SCROLLBAR,
} from "@/components/admin/trace/traceKinds";
import {
  allExpandable,
  buildTraceTree,
  defaultExpanded,
  failedSteps,
  firstProblem,
  formatMs,
  formatTimestamp,
  pathSummary,
  revealSpan,
  type TraceTree as TraceTreeData,
} from "@/components/admin/trace/traceModel";
import { useMediaQuery } from "@/components/admin/trace/useMediaQuery";
import { useAdminTrace } from "@/hooks/adminTraceApi";
import { AdminForbiddenError } from "@/lib/adminTraceApi";
import type { AdminTraceSummary } from "@/types/adminTrace";

// Below this the tree needs the full content width, so details open under
// the selected row instead of beside the tree.
const SIDE_BY_SIDE = "(min-width: 1280px)";

interface AdminTraceDetailProps {
  traceId: string;
  /** Selected step from the URL (`&span=`), if any. */
  spanId: string | null;
  onSelectSpan: (spanId: string | null) => void;
  onBack: () => void;
  onOpenPrompt: (name: string) => void;
  onOpenTraces: (filter: Partial<TraceFilters>) => void;
  onOpenUser: (userId: string) => void;
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <Button variant="ghost" size="sm" className="gap-2" onClick={onBack}>
      <ArrowLeft className="h-4 w-4" />
      Back to traces
    </Button>
  );
}

function IdField({
  label,
  value,
  action,
}: {
  label: string;
  value: string | null;
  action?: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      {value ? (
        <div className="flex items-center gap-0.5">
          <span className="min-w-0 truncate font-mono text-xs" title={value}>
            {value}
          </span>
          <CopyButton text={value} label={`Copy ${label.toLowerCase()}`} />
          {action}
        </div>
      ) : (
        <p className="flex h-9 items-center text-xs text-muted-foreground sm:h-7">
          —
        </p>
      )}
    </div>
  );
}

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      data-analytics-name={label}
      className="inline-flex h-9 min-w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:bg-accent sm:h-7 sm:min-w-7"
    >
      {children}
    </button>
  );
}

/**
 * What went wrong in a turn that did not end cleanly: the status in words,
 * the error text stored on the trace, the steps that failed, and a way to
 * the first of them in the tree.
 */
function TraceProblem({
  trace,
  onShowStep,
}: {
  trace: AdminTraceSummary;
  /** Present when a step of the tree is flagged. */
  onShowStep?: () => void;
}) {
  const failed = failedSteps(trace.meta?.failed_steps);
  const partial = trace.status === "partial";
  if (!trace.error && !partial) return null;
  const title =
    trace.status === "error"
      ? "The turn failed"
      : (traceStatusNote(trace.status) ?? "The turn did not end cleanly");
  return (
    <Notice tone={trace.status === "error" ? "error" : "warn"}>
      <p className="font-semibold first-letter:uppercase">{title}</p>
      {partial && (
        <p>
          The user received an answer and it was saved, but not everything
          the turn set out to do succeeded.
        </p>
      )}
      {trace.error && (
        <pre className="mt-0.5 whitespace-pre-wrap break-words font-mono text-xs [overflow-wrap:anywhere]">
          {trace.error}
        </pre>
      )}
      {failed.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {failed.map((step, index) => (
            <li key={index} className="break-words [overflow-wrap:anywhere]">
              <span className="font-mono font-semibold">{step.name}</span>
              {step.status && ` · ${step.status}`}
              {step.error && (
                <span className="font-mono"> · {step.error}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {onShowStep && (
        <p className="mt-1">
          <LinkButton
            onClick={onShowStep}
            analyticsName="Go to first failed step"
          >
            Show the first step that did not finish cleanly
          </LinkButton>
        </p>
      )}
    </Notice>
  );
}

function TraceHeader({
  trace,
  storedSpans,
  onOpenTraces,
  onOpenUser,
  onShowProblem,
}: {
  trace: AdminTraceSummary;
  storedSpans: number;
  onOpenTraces: (filter: Partial<TraceFilters>) => void;
  onOpenUser: (userId: string) => void;
  onShowProblem?: () => void;
}) {
  const dropped = trace.meta?.dropped_spans;
  return (
    <Card data-analytics-private>
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div>
          <div className="flex items-center justify-between gap-3">
            <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              User query
              {trace.query && (
                <CopyButton text={trace.query} label="Copy user query" />
              )}
            </p>
            <TraceStatusBadge status={trace.status} />
          </div>
          <h1 className="whitespace-pre-wrap break-words text-lg font-semibold leading-snug [overflow-wrap:anywhere]">
            {trace.query || "(empty message)"}
          </h1>
        </div>

        <TraceProblem trace={trace} onShowStep={onShowProblem} />

        <div className="grid gap-x-8 gap-y-1.5 md:grid-cols-2">
          <Facts
            items={[
              [
                "Route",
                <span key="route" className="font-mono">
                  {trace.plan_source ?? "—"}
                  {trace.plan_action ? ` → ${trace.plan_action}` : ""}
                </span>,
              ],
              [
                "Tools",
                trace.tools.length > 0 ? (
                  <span className="font-mono">{trace.tools.join(" · ")}</span>
                ) : (
                  <span className="font-normal text-muted-foreground">
                    none ran
                  </span>
                ),
              ],
              [
                "Models",
                trace.models.length > 0 ? (
                  <span className="font-mono">{trace.models.join(" · ")}</span>
                ) : null,
              ],
            ]}
          />
          <Facts
            items={[
              [
                "Duration",
                `${formatMs(trace.duration_ms)} · ${trace.llm_calls} LLM ${
                  trace.llm_calls === 1 ? "call" : "calls"
                } · ${trace.span_count} steps`,
              ],
              [
                "Started",
                `${formatTimestamp(trace.started_at)}${
                  trace.endpoint ? ` · ${trace.endpoint} endpoint` : ""
                }`,
              ],
              [
                "Git sha",
                trace.git_sha ? (
                  <span className="font-mono">{trace.git_sha}</span>
                ) : (
                  <span className="font-normal text-muted-foreground">
                    not recorded
                  </span>
                ),
              ],
              [
                "User",
                trace.owner_email || trace.owner_name
                  ? trace.owner_email || trace.owner_name
                  : null,
              ],
            ]}
          />
        </div>

        <div className="grid gap-x-6 gap-y-2 border-t pt-3 sm:grid-cols-2 xl:grid-cols-3">
          <IdField label="Trace id" value={trace.id} />
          <IdField
            label="Session id"
            value={trace.session_id}
            action={
              trace.session_id && (
                <IconAction
                  label="Show traces of this session"
                  onClick={() =>
                    onOpenTraces({ session: trace.session_id as string })
                  }
                >
                  <ListFilter className="h-3.5 w-3.5" />
                </IconAction>
              )
            }
          />
          <IdField
            label="User id"
            value={trace.user_id}
            action={
              trace.user_id && (
                <IconAction
                  label="Open this user"
                  onClick={() => onOpenUser(trace.user_id as string)}
                >
                  <UserIcon className="h-3.5 w-3.5" />
                </IconAction>
              )
            }
          />
          <IdField label="User message id" value={trace.user_message_id} />
          <IdField
            label="Assistant message id"
            value={trace.assistant_message_id}
          />
          <IdField label="Run id" value={trace.run_id} />
        </div>

        {typeof dropped === "number" && dropped > 0 && (
          <Notice>
            {dropped} more {dropped === 1 ? "step was" : "steps were"} not
            recorded: the turn reached the per-trace step limit
            (AI_TRACE_MAX_SPANS).
          </Notice>
        )}
        {storedSpans < trace.span_count && (
          <Notice>
            Only {storedSpans} of this trace's {trace.span_count} steps were
            stored (step rows are written best-effort after the answer). The
            tree below is incomplete.
          </Notice>
        )}
      </CardContent>
    </Card>
  );
}

export function AdminTraceDetail({
  traceId,
  spanId,
  onSelectSpan,
  onBack,
  onOpenPrompt,
  onOpenTraces,
  onOpenUser,
}: AdminTraceDetailProps) {
  const query = useAdminTrace(traceId);
  const { isLoading, isError, error } = query;
  // Anything that is not a trace (a mangled id can reach another endpoint)
  // is treated as a failed load rather than rendered.
  const data =
    query.data &&
    Array.isArray(query.data.spans) &&
    query.data.trace &&
    typeof query.data.trace === "object"
      ? query.data
      : undefined;
  const wide = useMediaQuery(SIDE_BY_SIDE);
  const panel = useRef<HTMLElement>(null);

  const tree = useMemo(
    () => (data ? buildTraceTree(data.spans, data.trace.duration_ms) : null),
    [data],
  );
  const defaults = useMemo(
    () => (tree ? defaultExpanded(tree) : new Set<string>()),
    [tree],
  );
  // The admin's own open/closed choices, valid for the tree they were made on.
  const [choice, setChoice] = useState<{
    tree: TraceTreeData;
    open: Set<string>;
  } | null>(null);
  const expanded = choice && choice.tree === tree ? choice.open : defaults;

  // A step selected from outside the tree (a deep link, the path line, a
  // link in the details) may sit under closed rows: open the way to it.
  useEffect(() => {
    if (!tree || !spanId) return;
    setChoice((current) => {
      const base = current && current.tree === tree ? current.open : defaults;
      const next = revealSpan(tree, base, spanId);
      return next === base ? current : { tree, open: next };
    });
  }, [tree, spanId, defaults]);

  // A step reached from outside the tree is brought into view once its row
  // exists: on arrival by deep link, and after following the path line or a
  // link in the details. Clicking a row never scrolls.
  const bringIntoView = useRef(spanId);
  const arriving = useRef(true);
  useEffect(() => {
    const target = bringIntoView.current;
    if (!tree || !target) return;
    if (target !== spanId) {
      // The selection moved on before the row appeared: nothing to chase.
      bringIntoView.current = null;
      return;
    }
    const row = document.querySelector(
      `[data-span-row=${JSON.stringify(target)}]`,
    );
    if (!row) return; // Its ancestors open on the next render.
    bringIntoView.current = null;
    // Under-the-row details need the row at the top to be readable. Beside
    // the tree, a deep link centres its row; later jumps move the page only
    // as far as needed.
    row.scrollIntoView({
      block: !wide ? "start" : arriving.current ? "center" : "nearest",
    });
    arriving.current = false;
  }, [tree, expanded, spanId, wide]);

  const selectedId = spanId && tree?.byId.has(spanId) ? spanId : null;
  // Beside the tree there is always room for details, so start on the turn
  // itself (what was asked, what was answered) rather than an empty panel.
  const shownId =
    selectedId ?? (wide ? (tree?.roots[0]?.span.id ?? null) : null);
  const shownNode = shownId ? (tree?.byId.get(shownId) ?? null) : null;

  useEffect(() => {
    panel.current?.scrollTo({ top: 0 });
  }, [shownId]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <BackButton onBack={onBack} />
        <Skeleton className="h-52 w-full" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }
  if (error instanceof AdminForbiddenError) {
    return (
      <div className="space-y-4">
        <BackButton onBack={onBack} />
        <NoTraceAccess what="this trace" />
      </div>
    );
  }
  if (isError || !data || !tree) {
    return (
      <div className="space-y-4">
        <BackButton onBack={onBack} />
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Failed to load trace."}
        </p>
        <p className="max-w-2xl text-sm text-muted-foreground">
          The trace may have been purged, or its id is not a trace id. A
          session, message or user id can be pasted into the search box of the
          Traces list instead.
        </p>
      </div>
    );
  }

  const { trace } = data;
  const path = pathSummary(tree, trace);
  const problem = firstProblem(tree);

  const select = (id: string) => {
    // Under-the-row details close by tapping the row again.
    onSelectSpan(!wide && id === selectedId ? null : id);
  };
  const toggle = (id: string) => {
    const open = new Set(expanded);
    if (open.has(id)) open.delete(id);
    else open.add(id);
    setChoice({ tree, open });
  };
  const goTo = (id: string) => {
    if (id === spanId) {
      document
        .querySelector(`[data-span-row=${JSON.stringify(id)}]`)
        ?.scrollIntoView({ block: wide ? "nearest" : "start" });
      return;
    }
    bringIntoView.current = id;
    onSelectSpan(id);
  };
  const detail = (node: NonNullable<typeof shownNode>) => (
    <SpanDetail
      key={node.span.id}
      node={node}
      tree={tree}
      onSelectSpan={goTo}
      onOpenPrompt={onOpenPrompt}
      onOpenTraces={(filter) => onOpenTraces(filter)}
    />
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <BackButton onBack={onBack} />
        <CopyButton
          text={() => window.location.href}
          label="Copy a link to this trace and the selected step"
          caption="Copy link"
        />
      </div>

      <TraceHeader
        trace={trace}
        storedSpans={data.spans.length}
        onOpenTraces={onOpenTraces}
        onOpenUser={onOpenUser}
        onShowProblem={problem ? () => goTo(problem.span.id) : undefined}
      />

      {spanId && !selectedId && (
        <Notice>
          The linked step (<span className="font-mono">{spanId}</span>) is not
          among the steps stored for this trace.
        </Notice>
      )}
      {tree.orphans > 0 && tree.roots.length === 1 && (
        <Notice tone="info">
          {tree.orphans === 1
            ? "1 step is shown directly under the turn because the step it ran under was not stored."
            : `${tree.orphans} steps are shown directly under the turn because the steps they ran under were not stored.`}
        </Notice>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <ListTree className="h-4 w-4 text-primary" aria-hidden />
          <h2 className="text-sm font-semibold tracking-tight">
            Execution tree
          </h2>
          <span className="text-xs text-muted-foreground">
            ({data.spans.length} steps)
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 text-xs sm:h-8"
            data-analytics-name="Expand all trace steps"
            onClick={() => setChoice({ tree, open: allExpandable(tree) })}
          >
            <ChevronsUpDown className="h-3.5 w-3.5" />
            Expand all
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 text-xs sm:h-8"
            data-analytics-name="Collapse all trace steps"
            onClick={() =>
              setChoice({
                tree,
                // Keep the turn itself open: one closed row tells nothing.
                open: new Set(tree.roots.map((root) => root.span.id)),
              })
            }
          >
            <ChevronsDownUp className="h-3.5 w-3.5" />
            Collapse all
          </Button>
        </div>
      </div>

      {path.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-1.5"
          aria-label="Path taken"
        >
          <span className="mr-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Path
          </span>
          {path.map((step, index) => (
            <span key={index} className="inline-flex items-center gap-1.5">
              {index > 0 &&
                (step.parallel ? (
                  <span title="Ran at the same time as the previous step">
                    <Plus
                      aria-label="in parallel with"
                      className="h-3 w-3 text-muted-foreground"
                    />
                  </span>
                ) : (
                  <ArrowRight
                    aria-label="then"
                    className="h-3 w-3 text-muted-foreground"
                  />
                ))}
              <button
                type="button"
                disabled={!step.spanId}
                onClick={() => step.spanId && goTo(step.spanId)}
                data-analytics-name="Go to path step"
                className="rounded-md border bg-background px-2 py-1 font-mono text-xs enabled:hover:bg-accent enabled:active:bg-accent disabled:cursor-default sm:py-0.5"
              >
                {step.label}
              </button>
            </span>
          ))}
        </div>
      )}

      <div
        className={
          wide
            ? "grid grid-cols-[minmax(0,5fr)_minmax(0,6fr)] items-start gap-4"
            : undefined
        }
        data-analytics-private
        data-analytics-section="admin_trace_tree"
      >
        <div className="overflow-hidden rounded-lg border bg-background">
          <TraceTree
            tree={tree}
            expanded={expanded}
            selectedId={shownId}
            onToggle={toggle}
            onSelect={select}
            renderInline={wide ? undefined : detail}
          />
        </div>
        {wide && (
          <aside
            ref={panel}
            aria-label="Step details"
            style={VISIBLE_SCROLLBAR}
            className="sticky top-0 max-h-[calc(100dvh-3rem)] overflow-y-auto rounded-lg border bg-background p-4"
          >
            {shownNode ? (
              detail(shownNode)
            ) : (
              <p className="py-10 text-center text-sm text-muted-foreground">
                Select a step to see what it received and returned.
              </p>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
