// Version history of one prompt template. A version is the content hash of
// the template plus the shared blocks it embeds, so a new row appears when
// either changes. Picking an older version loads its stored text and shows
// what changed, line by line, between it and the version deployed now.

import { useMemo, useState } from "react";
import { GitCompareArrows, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminPromptVersion } from "@/hooks/adminTraceApi";
import { formatDateTime } from "@/lib/adminFormat";
import { cn } from "@/lib/utils";
import type {
  AdminPromptTemplate,
  AdminPromptVersion,
  AdminPromptVersionRef,
} from "@/types/adminTrace";
import {
  collapseUnchanged,
  diffLines,
  type DiffResult,
  type DiffRow,
} from "./lineDiff";
import { HashChip, ScrollPane } from "./parts";
import { plural, versionRows, type VersionRow } from "./promptMapModel";

function DiffRows({ rows }: { rows: DiffRow[] }) {
  return (
    <div className="font-mono text-[11px] leading-relaxed">
      {rows.map((row, i) => {
        if (row.op === "gap") {
          return (
            <div
              key={i}
              className="border-y border-border/50 bg-muted/40 px-3 py-0.5 text-center font-sans text-[11px] text-muted-foreground"
            >
              {plural(row.count, "unchanged line")}
            </div>
          );
        }
        return (
          <div
            key={i}
            className={cn(
              "grid grid-cols-[2rem_2rem_1rem_minmax(0,1fr)] gap-x-1 px-1",
              row.op === "add" && "bg-emerald-500/15",
              row.op === "del" && "bg-red-500/15",
            )}
          >
            <span className="select-none text-right tabular-nums text-muted-foreground/70">
              {row.oldNo ?? ""}
            </span>
            <span className="select-none text-right tabular-nums text-muted-foreground/70">
              {row.newNo ?? ""}
            </span>
            <span
              className={cn(
                "select-none text-center font-semibold",
                row.op === "add" && "text-emerald-600 dark:text-emerald-400",
                row.op === "del" && "text-red-600 dark:text-red-400",
              )}
            >
              {row.op === "add" ? "+" : row.op === "del" ? "−" : ""}
            </span>
            <span className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {/* Keep the row's height when the line is empty. */}
              {row.text || " "}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function DiffPart({
  title,
  diff,
  full,
}: {
  title: string;
  diff: DiffResult;
  full: boolean;
}) {
  const changed = diff.added + diff.removed > 0;
  const rows = useMemo(
    () => (full ? diff.lines : collapseUnchanged(diff.lines)),
    [diff, full],
  );
  return (
    <div className="rounded-lg border bg-background">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2">
        <p className="min-w-0 flex-1 break-words text-sm font-medium [overflow-wrap:anywhere]">
          {title}
        </p>
        {changed ? (
          <span className="whitespace-nowrap font-mono text-[11px]">
            <span className="text-emerald-600 dark:text-emerald-400">
              +{diff.added}
            </span>{" "}
            <span className="text-red-600 dark:text-red-400">
              −{diff.removed}
            </span>
          </span>
        ) : (
          <span className="text-[11px] text-muted-foreground">unchanged</span>
        )}
      </div>
      {diff.coarse && (
        <p className="border-b px-3 py-1.5 text-[11px] text-muted-foreground">
          Too large to align line by line: the changed part is shown as one
          removed block followed by one added block.
        </p>
      )}
      {rows.length > 0 ? (
        <ScrollPane label={`${title} diff`} className="max-h-[28rem]">
          <DiffRows rows={rows} />
        </ScrollPane>
      ) : (
        !changed &&
        !full && (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            Identical in both versions.
          </p>
        )
      )}
    </div>
  );
}

function VersionDiff({
  template,
  version,
}: {
  template: AdminPromptTemplate;
  version: AdminPromptVersion;
}) {
  const [full, setFull] = useState(false);

  const parts = useMemo(() => {
    const out: Array<{ title: string; diff: DiffResult }> = [
      {
        title: "System channel",
        diff: diffLines(version.system_template, template.system),
      },
      {
        title: "User channel",
        diff: diffLines(version.user_template, template.user),
      },
    ];
    const before = version.defaults ?? {};
    const after = template.defaults ?? {};
    const names = [...new Set([...Object.keys(after), ...Object.keys(before)])];
    for (const name of names) {
      const note = !(name in before)
        ? " (added since)"
        : !(name in after)
          ? " (no longer embedded)"
          : "";
      out.push({
        title: `Shared block ${name}${note}`,
        diff: diffLines(before[name], after[name]),
      });
    }
    return out;
  }, [template, version]);

  const added = parts.reduce((sum, p) => sum + p.diff.added, 0);
  const removed = parts.reduce((sum, p) => sum + p.diff.removed, 0);
  const changedParts = parts.filter((p) => p.diff.added + p.diff.removed > 0);
  const unchangedParts = parts.filter(
    (p) => p.diff.added + p.diff.removed === 0,
  );

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          {added + removed === 0 ? (
            "No line differs between the two versions' stored text."
          ) : (
            <>
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                {plural(added, "line")} added
              </span>
              {" and "}
              <span className="font-semibold text-red-600 dark:text-red-400">
                {plural(removed, "line")} removed
              </span>{" "}
              since this version, across {plural(changedParts.length, "part")}.
            </>
          )}
        </p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-9 text-xs text-muted-foreground sm:h-7"
          aria-pressed={full}
          data-analytics-name="Toggle full prompt diff"
          onClick={() => setFull((v) => !v)}
        >
          {full ? "Show changes only" : "Show full text"}
        </Button>
      </div>

      {(full ? parts : changedParts).map((part) => (
        <DiffPart
          key={part.title}
          title={part.title}
          diff={part.diff}
          full={full}
        />
      ))}
      {!full && unchangedParts.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          Unchanged: {unchangedParts.map((p) => p.title).join(", ")}.
        </p>
      )}
    </div>
  );
}

function VersionCompare({
  template,
  hash,
  onClose,
}: {
  template: AdminPromptTemplate;
  hash: string;
  onClose: () => void;
}) {
  const { data, isLoading, isError, error } = useAdminPromptVersion(
    template.name,
    hash,
  );
  return (
    <div className="space-y-2.5 rounded-lg border border-primary/40 bg-primary/[0.04] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <GitCompareArrows className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        <p className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-sm font-medium">
          <HashChip hash={hash} />
          <span aria-hidden>→</span>
          <HashChip hash={template.hash} />
          <span className="text-xs font-normal text-muted-foreground">
            (deployed now)
          </span>
        </p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-9 gap-1.5 text-xs text-muted-foreground sm:h-7"
          data-analytics-name="Close prompt diff"
          onClick={onClose}
        >
          <X className="h-3 w-3" />
          Close
        </Button>
      </div>
      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : isError || !data ? (
        <p className="text-sm text-destructive">
          The stored text of this version could not be loaded
          {error instanceof Error ? `: ${error.message}` : "."}
        </p>
      ) : (
        <VersionDiff template={template} version={data} />
      )}
    </div>
  );
}

function VersionLine({
  row,
  comparing,
  statsAvailable,
  days,
  onCompare,
}: {
  row: VersionRow;
  comparing: boolean;
  statsAvailable: boolean;
  days: number;
  onCompare: () => void;
}) {
  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5",
        comparing && "bg-primary/10",
      )}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <HashChip hash={row.hash} className="text-foreground" />
          {row.current && (
            <Badge
              variant="secondary"
              className="bg-emerald-500/15 text-[10px] text-emerald-600 dark:text-emerald-400"
            >
              Deployed now
            </Badge>
          )}
          {row.gitSha && (
            <span
              className="font-mono text-[11px] text-muted-foreground"
              title="Git commit of the backend that first rendered this version"
            >
              git {row.gitSha.slice(0, 7)}
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          First seen {row.firstSeen ? formatDateTime(row.firstSeen) : "—"}
          {row.lastUsed && <> · last used {formatDateTime(row.lastUsed)}</>}
          {statsAvailable && (
            <>
              {" · "}
              <span className="tabular-nums">
                {row.uses
                  ? `${plural(row.uses, "use")} in ${plural(row.traces ?? 0, "trace")} (last ${days} days)`
                  : `not used in the last ${days} days`}
              </span>
            </>
          )}
        </p>
      </div>
      {!row.current && (
        <Button
          type="button"
          size="sm"
          variant={comparing ? "secondary" : "outline"}
          className="h-9 gap-1.5 text-xs sm:h-7"
          aria-pressed={comparing}
          data-analytics-name="Compare prompt version"
          onClick={onCompare}
        >
          <GitCompareArrows className="h-3 w-3" />
          {comparing ? "Comparing" : "Diff vs current"}
        </Button>
      )}
    </li>
  );
}

export function VersionHistory({
  template,
  refs,
  statsAvailable,
  days,
}: {
  template: AdminPromptTemplate;
  /** `catalog.versions` (all templates; filtered here). */
  refs: AdminPromptVersionRef[] | undefined;
  statsAvailable: boolean;
  days: number;
}) {
  const rows = useMemo(() => versionRows(template, refs), [template, refs]);
  const [compare, setCompare] = useState<string | null>(null);
  // A version can drop out of the list when the usage window changes.
  const comparing = rows.some((r) => r.hash === compare && !r.current)
    ? compare
    : null;
  const older = rows.filter((r) => !r.current).length;

  return (
    <div className="space-y-2.5">
      <ul className="divide-y rounded-lg border bg-background">
        {rows.map((row) => (
          <VersionLine
            key={row.hash}
            row={row}
            comparing={comparing === row.hash}
            statsAvailable={statsAvailable}
            days={days}
            onCompare={() =>
              setCompare((prev) => (prev === row.hash ? null : row.hash))
            }
          />
        ))}
      </ul>
      {older === 0 && (
        <p className="text-xs text-muted-foreground">
          {statsAvailable
            ? "No earlier version has been recorded. A version is stored the first time a traced turn renders it, so older text appears here after the next edit goes live."
            : "Earlier versions are recorded once tracing is on."}
        </p>
      )}
      {comparing && (
        <VersionCompare
          // Remount per version so a previous diff never flashes.
          key={comparing}
          template={template}
          hash={comparing}
          onClose={() => setCompare(null)}
        />
      )}
    </div>
  );
}
