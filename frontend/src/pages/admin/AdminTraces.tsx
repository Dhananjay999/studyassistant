// AI execution traces: one row per chat turn. The search box takes text from
// the user's message or any id copied from elsewhere (trace, session,
// message, user), and the filters narrow by status, route, tool and prompt.
// Every filter lives in the URL (see `traceRoutes`), so a filtered list can
// be linked to from a session, a prompt or a tool.

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  DatabaseZap,
  ListTree,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { NoTraceAccess } from "@/components/admin/trace/TraceAccess";
import { TraceStatusBadge } from "@/components/admin/trace/TraceBlocks";
import {
  ResponsiveTable,
  type ResponsiveColumn,
} from "@/components/admin/ResponsiveTable";
import {
  EMPTY_TRACE_FILTERS,
  traceFiltersToQuery,
  type TraceFilters,
} from "@/components/admin/trace/traceFilters";
import {
  PLAN_SOURCES,
  TRACE_STATUSES,
  traceStatusHasProblem,
  traceStatusNote,
} from "@/components/admin/trace/traceKinds";
import {
  formatMs,
  formatTimestamp,
  shortId,
} from "@/components/admin/trace/traceModel";
import {
  useAdminPromptCatalog,
  useAdminPurgeTraces,
  useAdminTraces,
} from "@/hooks/adminTraceApi";
import { AdminForbiddenError } from "@/lib/adminTraceApi";
import type { AdminTraceSummary } from "@/types/adminTrace";

// Radix Select cannot hold an empty value; this stands for "no filter".
const ANY = "__any__";
// The backend rejects a longer search string.
const MAX_QUERY_CHARS = 200;
const DEFAULT_PURGE_DAYS = "30";

const userLabel = (t: AdminTraceSummary) =>
  t.owner_email || t.owner_name || (t.user_id ? shortId(t.user_id) : "—");

/** What went wrong, for a turn that did not end cleanly. */
const problemText = (t: AdminTraceSummary) =>
  traceStatusHasProblem(t.status) ? t.error || null : null;

/** "partial (answered, but a step failed or timed out)". */
const statusLabel = (status: string) => {
  const note = traceStatusNote(status);
  return note ? `${status} (${note})` : status;
};

const routeText = (t: AdminTraceSummary) =>
  `${t.plan_source ?? "—"} → ${
    t.tools.length > 0 ? t.tools.join(", ") : (t.plan_action ?? "no tool")
  }`;

// The query column takes whatever width is left (`w-full max-w-0`) and
// carries the user under it, so the table fits the content column on a
// laptop without scrolling sideways. On cards the same cell is the title.
const COLUMNS: ResponsiveColumn<AdminTraceSummary>[] = [
  {
    key: "time",
    header: "Time",
    className: "whitespace-nowrap font-mono text-xs text-muted-foreground",
    cell: (t) => (
      <span title={formatTimestamp(t.started_at)}>
        {formatTimestamp(t.started_at, true)}
      </span>
    ),
  },
  {
    key: "query",
    header: "Query · user",
    role: "primary",
    className: "w-full max-w-0",
    cell: (t) => (
      <>
        <p className="truncate text-sm" title={t.query ?? undefined}>
          {t.query || "(empty message)"}
        </p>
        <p className="truncate text-xs text-muted-foreground">{userLabel(t)}</p>
      </>
    ),
    mobileCell: (t) => (
      <>
        {t.query || "(empty message)"}
        <span className="block truncate text-xs font-normal text-muted-foreground">
          {userLabel(t)}
        </span>
      </>
    ),
  },
  {
    key: "route",
    header: "Route → tools",
    className: "max-w-[210px] truncate font-mono text-xs",
    cell: (t) => <span title={routeText(t)}>{routeText(t)}</span>,
    mobileCell: (t) => (
      <span className="font-mono [overflow-wrap:anywhere]">
        {routeText(t)}
      </span>
    ),
  },
  {
    key: "models",
    header: "Models",
    className: "max-w-[130px] truncate font-mono text-xs text-muted-foreground",
    cell: (t) =>
      t.models.length > 0 ? (
        <span title={t.models.join(", ")}>
          {t.models[0]}
          {t.models.length > 1 && ` +${t.models.length - 1}`}
        </span>
      ) : (
        "—"
      ),
  },
  {
    key: "llm_calls",
    header: "LLM calls",
    align: "right",
    cell: (t) => t.llm_calls,
  },
  {
    key: "duration",
    header: "Duration",
    align: "right",
    cell: (t) => formatMs(t.duration_ms),
  },
  {
    key: "status",
    header: "Status",
    className: "min-w-[150px] max-w-[190px]",
    cell: (t) => (
      <>
        <TraceStatusBadge status={t.status} />
        {problemText(t) && (
          <p
            className="mt-1 line-clamp-2 break-words font-mono text-[11px] leading-snug text-muted-foreground [overflow-wrap:anywhere]"
            title={problemText(t) ?? undefined}
          >
            {problemText(t)}
          </p>
        )}
      </>
    ),
    mobileCell: (t) => (
      <>
        <TraceStatusBadge status={t.status} />
        {problemText(t) && (
          <span className="mt-0.5 block break-words font-mono text-[11px] font-normal text-muted-foreground [overflow-wrap:anywhere]">
            {problemText(t)}
          </span>
        )}
      </>
    ),
  },
];

/** Options of a filter, always including the value currently applied. */
function withCurrent(options: string[], current: string): string[] {
  const unique = Array.from(new Set(options.filter(Boolean))).sort();
  return current && !unique.includes(current) ? [current, ...unique] : unique;
}

function FilterSelect({
  label,
  anyLabel,
  value,
  options,
  onChange,
}: {
  label: string;
  anyLabel: string;
  value: string;
  /** `short` is what the closed control shows when the label is a sentence. */
  options: { value: string; label: string; short?: string }[];
  onChange: (value: string) => void;
}) {
  const current = options.find((option) => option.value === value);
  return (
    <Select
      value={value || ANY}
      onValueChange={(next) => onChange(next === ANY ? "" : next)}
    >
      <SelectTrigger aria-label={label} className="min-w-0">
        <SelectValue>
          {current ? (current.short ?? current.label) : anyLabel}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>{anyLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function FilterChip({
  label,
  value,
  onClear,
}: {
  label: string;
  value: string;
  onClear: () => void;
}) {
  return (
    <Badge
      variant="secondary"
      className="max-w-full gap-1 py-1 pl-3 pr-1"
      data-analytics-private
    >
      <span className="min-w-0 truncate">
        {label}: <span className="font-mono font-normal">{value}</span>
      </span>
      <button
        type="button"
        aria-label={`Clear ${label.toLowerCase()} filter`}
        data-analytics-name="Clear trace filter"
        onClick={onClear}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full hover:bg-background/60 active:bg-background/80"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </Badge>
  );
}

/** Shown instead of the table until migration 024 exists in the database. */
function StorageMissing() {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
      <DatabaseZap
        aria-hidden
        className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400"
      />
      <div className="min-w-0 space-y-2 text-sm">
        <p className="font-semibold">Trace storage is not set up yet</p>
        <p className="text-muted-foreground">
          The trace tables do not exist in this database, so no chat turn is
          being recorded. Apply the migration{" "}
          <code className="break-all rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
            backend_v2/supabase/migrations/024_ai_execution_traces.sql
          </code>{" "}
          to create them.
        </p>
        <p className="text-muted-foreground">
          After it is applied, recording resumes by itself. A running backend
          re-checks for the tables every 10 minutes, so the first traces can
          take that long to appear.
        </p>
      </div>
    </div>
  );
}

export function AdminTraces({
  filters,
  onFiltersChange,
  onOpenTrace,
}: {
  filters: TraceFilters;
  /** Writes the filters to the URL (replacing the current history entry). */
  onFiltersChange: (next: TraceFilters) => void;
  onOpenTrace: (traceId: string) => void;
}) {
  const query = useMemo(() => traceFiltersToQuery(filters), [filters]);
  const { data, isLoading, isFetching, isError, error, isPlaceholderData } =
    useAdminTraces(query);
  const forbidden = error instanceof AdminForbiddenError;
  // Only a source of filter suggestions: the page works without it.
  const catalog = useAdminPromptCatalog();
  const purge = useAdminPurgeTraces();
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purgeDays, setPurgeDays] = useState(DEFAULT_PURGE_DAYS);

  // The debounce below fires later, so it must read the filters of that
  // moment, not the ones captured when the admin started typing.
  const latest = useRef(filters);
  latest.current = filters;
  const patch = (next: Partial<TraceFilters>) =>
    onFiltersChange({ ...latest.current, page: 1, ...next });

  // Search box ⇄ URL. Typing updates the URL after a pause; a URL changed
  // from elsewhere (a link, Back) is adopted by the box. `settledQ` is the
  // value both sides last agreed on, so neither overwrites the other.
  const [searchInput, setSearchInput] = useState(filters.q);
  const settledQ = useRef(filters.q);
  useEffect(() => {
    if (filters.q === settledQ.current) return;
    settledQ.current = filters.q;
    setSearchInput(filters.q);
  }, [filters.q]);
  useEffect(() => {
    if (searchInput === settledQ.current) return;
    const timer = setTimeout(() => {
      settledQ.current = searchInput;
      onFiltersChange({ ...latest.current, q: searchInput, page: 1 });
    }, 350);
    return () => clearTimeout(timer);
    // `onFiltersChange` is a fresh function on every render of the host.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const items = useMemo(() => data?.items ?? [], [data]);
  const available = data?.available !== false;
  const totalPages = data
    ? Math.max(1, Math.ceil(data.total / (data.page_size || 1)))
    : 1;

  // A page past the end (a stale link, or rows purged since) has nothing to
  // show: move to the last page that exists. Only once the answer is for
  // these filters, not the previous page kept on screen while loading.
  const pastEnd =
    !!data && !isPlaceholderData && !isError && filters.page > totalPages;
  useEffect(() => {
    if (pastEnd) onFiltersChange({ ...latest.current, page: totalPages });
    // `onFiltersChange` is a fresh function on every render of the host.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastEnd, totalPages]);

  // Tool and prompt names come from the prompt catalog when it loads, plus
  // whatever the rows on this page used.
  const toolOptions = useMemo(() => {
    const names = items.flatMap((t) => t.tools);
    for (const template of catalog.data?.templates ?? []) {
      if (template.usage?.tool) names.push(template.usage.tool);
    }
    for (const stage of catalog.data?.flow?.stages ?? []) {
      for (const node of stage.nodes ?? []) {
        if (node.tool) names.push(node.tool);
      }
    }
    return withCurrent(names, filters.tool);
  }, [items, catalog.data, filters.tool]);
  const promptOptions = useMemo(
    () =>
      withCurrent(
        [
          ...items.flatMap((t) => t.prompt_names),
          ...(catalog.data?.templates ?? []).map((t) => t.name),
        ],
        filters.prompt,
      ),
    [items, catalog.data, filters.prompt],
  );
  const statusOptions = withCurrent([...TRACE_STATUSES], filters.status);
  const sourceOptions = PLAN_SOURCES.some((s) => s.value === filters.source)
    ? PLAN_SOURCES
    : withCurrent(
        PLAN_SOURCES.map((s) => s.value),
        filters.source,
      ).map(
        (value) =>
          PLAN_SOURCES.find((s) => s.value === value) ?? {
            value,
            label: value,
          },
      );

  const filtered =
    Boolean(
      filters.q ||
      filters.status ||
      filters.source ||
      filters.tool ||
      filters.prompt ||
      filters.session ||
      filters.user,
    ) || searchInput !== "";

  const runPurge = async () => {
    const days = Number(purgeDays);
    if (!Number.isInteger(days) || days < 1 || days > 3650) {
      toast.error("Enter a whole number of days between 1 and 3650.");
      return;
    }
    try {
      const result = await purge.mutateAsync(days);
      toast.success(
        `Removed ${result.removed.toLocaleString()} ${
          result.removed === 1 ? "trace" : "traces"
        } older than ${days} ${days === 1 ? "day" : "days"}`,
      );
      setPurgeOpen(false);
      // The page being shown may no longer exist.
      if (filters.page !== 1) patch({ page: 1 });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Purge failed");
    }
  };

  // Not an error to report: this admin may simply not see traces.
  if (forbidden) {
    return (
      <div className="space-y-4">
        <div className="flex min-w-0 items-center gap-2">
          <ListTree className="h-5 w-5 shrink-0 text-primary" />
          <h1 className="truncate text-xl font-semibold tracking-tight">
            Traces
          </h1>
        </div>
        <NoTraceAccess />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <ListTree className="h-5 w-5 shrink-0 text-primary" />
          <h1 className="truncate text-xl font-semibold tracking-tight">
            Traces
          </h1>
          {data && available && (
            <span className="text-sm text-muted-foreground">
              ({data.total.toLocaleString()})
            </span>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-10 shrink-0 gap-1.5 sm:h-9"
          disabled={!data || !available}
          data-analytics-name="Purge old traces"
          onClick={() => setPurgeOpen(true)}
        >
          <Trash2 className="h-4 w-4" />
          Purge
        </Button>
      </div>
      <p className="max-w-2xl text-sm text-muted-foreground">
        One trace per chat turn: how it was routed, each prompt that was
        rendered and with which values, what every LLM call received and
        returned, and the tools that ran. Open a row to read its execution tree.
      </p>

      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            maxLength={MAX_QUERY_CHARS}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search query text, or paste any id: trace, session, message, user…"
            aria-label="Search traces by text or id"
            className="pl-9"
            data-analytics-private
          />
        </div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <FilterSelect
            label="Status"
            anyLabel="All statuses"
            value={filters.status}
            options={statusOptions.map((value) => ({
              value,
              label: statusLabel(value),
              short: value,
            }))}
            onChange={(status) => patch({ status })}
          />
          <FilterSelect
            label="Route"
            anyLabel="All routes"
            value={filters.source}
            options={sourceOptions}
            onChange={(source) => patch({ source })}
          />
          <FilterSelect
            label="Tool"
            anyLabel="All tools"
            value={filters.tool}
            options={toolOptions.map((value) => ({ value, label: value }))}
            onChange={(tool) => patch({ tool })}
          />
          <FilterSelect
            label="Prompt"
            anyLabel="All prompts"
            value={filters.prompt}
            options={promptOptions.map((value) => ({ value, label: value }))}
            onChange={(prompt) => patch({ prompt })}
          />
        </div>
        {filtered && (
          <div className="flex flex-wrap items-center gap-2">
            {filters.session && (
              <FilterChip
                label="Session"
                value={filters.session}
                onClear={() => patch({ session: "" })}
              />
            )}
            {filters.user && (
              <FilterChip
                label="User"
                value={filters.user}
                onClear={() => patch({ user: "" })}
              />
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-9 gap-1.5 text-xs text-muted-foreground sm:h-8"
              data-analytics-name="Clear trace filters"
              onClick={() => {
                settledQ.current = "";
                setSearchInput("");
                onFiltersChange(EMPTY_TRACE_FILTERS);
              }}
            >
              <X className="h-3.5 w-3.5" />
              Clear filters
            </Button>
          </div>
        )}
      </div>

      {isError && (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Failed to load traces."}
        </p>
      )}

      {!available ? (
        <StorageMissing />
      ) : (
        <>
          <ResponsiveTable
            columns={COLUMNS}
            rows={items}
            rowKey={(t) => t.id}
            onRowClick={(t) => onOpenTrace(t.id)}
            rowActionName="Open trace"
            loading={isLoading}
            empty={
              filtered
                ? "No trace matches these filters."
                : "No traces recorded yet. They appear here after a chat turn finishes."
            }
            analyticsSection="admin_traces_list"
          />

          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Page {Math.min(filters.page, totalPages)} of {totalPages}
              {isFetching && " · updating…"}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-10 sm:h-9"
                disabled={filters.page <= 1}
                onClick={() => patch({ page: filters.page - 1 })}
              >
                <ChevronLeft className="h-4 w-4" />
                Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-10 sm:h-9"
                disabled={filters.page >= totalPages}
                onClick={() => patch({ page: filters.page + 1 })}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}

      <ConfirmDialog
        open={purgeOpen}
        onOpenChange={setPurgeOpen}
        title="Purge old traces?"
        description={
          <div className="space-y-3">
            <p>
              Permanently deletes every stored trace, with all of its steps,
              older than the number of days below. Chats, messages and prompt
              versions are not touched. This cannot be undone.
            </p>
            <label className="block space-y-1.5 text-left">
              <span className="text-xs font-medium text-foreground">
                Delete traces older than (days)
              </span>
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={3650}
                step={1}
                value={purgeDays}
                onChange={(e) => setPurgeDays(e.target.value)}
                className="max-w-[140px]"
              />
            </label>
          </div>
        }
        confirmText="Purge traces"
        loading={purge.isPending}
        onConfirm={runPurge}
      />
    </div>
  );
}
