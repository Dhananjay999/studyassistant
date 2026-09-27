// A data table that is a real table on desktop and a list of cards on
// phones and tablets. Wide admin tables (nine columns of users) are
// unusable when the only way to read them is scrolling sideways, and row
// actions in the last column end up off-screen. Below the shell breakpoint
// each row becomes a card: a primary line, secondary lines, the remaining
// columns as labelled values, and the row's actions as visible buttons
// under the card (never nested inside the tappable body).
//
// One tree is rendered (a JS branch on `useIsMobileShell`), not two trees
// toggled with CSS, so the DOM — and the click analytics — are not doubled.

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useIsMobileShell } from "@/hooks/useIsMobileShell";
import { cn } from "@/lib/utils";

export interface ResponsiveColumn<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Card rendering when it should differ from the table cell. */
  mobileCell?: (row: T) => ReactNode;
  /** Card slot: title line, subtitle line, or a labelled value (default). */
  role?: "primary" | "secondary" | "meta";
  hideOnMobile?: boolean;
  align?: "right";
  /** Extra classes for the desktop cell. */
  className?: string;
}

interface ResponsiveTableProps<T> {
  columns: ResponsiveColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Analytics/accessible name of the row action (rows hold user content). */
  rowActionName?: string;
  /** Row actions in the table's last column (icon buttons). */
  desktopActions?: (row: T) => ReactNode;
  /** Row actions under the card (labelled buttons). */
  mobileActions?: (row: T) => ReactNode;
  loading?: boolean;
  skeletonRows?: number;
  empty: string;
  analyticsSection: string;
}

export function ResponsiveTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  rowActionName = "Open row",
  desktopActions,
  mobileActions,
  loading = false,
  skeletonRows = 8,
  empty,
  analyticsSection,
}: ResponsiveTableProps<T>) {
  const isMobileShell = useIsMobileShell();

  if (isMobileShell) {
    const shown = columns.filter((c) => !c.hideOnMobile);
    const primary = shown.find((c) => c.role === "primary") ?? shown[0];
    const secondary = shown.filter((c) => c.role === "secondary");
    const meta = shown.filter(
      (c) => c !== primary && c.role !== "secondary",
    );
    const render = (c: ResponsiveColumn<T>, row: T) =>
      (c.mobileCell ?? c.cell)(row);

    if (loading) {
      return (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: Math.min(skeletonRows, 6) }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      );
    }
    if (rows.length === 0) {
      return (
        <p className="rounded-lg border bg-background py-10 text-center text-sm text-muted-foreground">
          {empty}
        </p>
      );
    }
    return (
      <ul
        className="divide-y rounded-lg border bg-background"
        data-analytics-private
        data-analytics-section={analyticsSection}
      >
        {rows.map((row) => {
          const body = (
            <>
              <div className="min-w-0 flex-1">
                {primary && (
                  <div className="truncate text-sm font-medium">
                    {render(primary, row)}
                  </div>
                )}
                {secondary.map((c) => (
                  <div
                    key={c.key}
                    className="truncate text-xs text-muted-foreground"
                  >
                    {render(c, row)}
                  </div>
                ))}
                {meta.length > 0 && (
                  <dl className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    {meta.map((c) => (
                      <div key={c.key} className="flex min-w-0 gap-1">
                        <dt className="shrink-0 text-muted-foreground">
                          {c.header}
                        </dt>
                        <dd className="min-w-0 font-medium">
                          {render(c, row)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
              {onRowClick && (
                <ChevronRight
                  aria-hidden
                  className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                />
              )}
            </>
          );
          return (
            <li key={rowKey(row)}>
              {onRowClick ? (
                <button
                  type="button"
                  onClick={() => onRowClick(row)}
                  data-analytics-name={rowActionName}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left active:bg-accent/60"
                >
                  {body}
                </button>
              ) : (
                <div className="flex items-start gap-3 px-4 py-3">{body}</div>
              )}
              {mobileActions && (
                <div className="flex flex-wrap gap-2 px-4 pb-3">
                  {mobileActions(row)}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  const span = columns.length + (desktopActions ? 1 : 0);
  return (
    <div
      className="overflow-x-auto rounded-lg border bg-background"
      data-analytics-private
      data-analytics-section={analyticsSection}
    >
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((c) => (
              <TableHead
                key={c.key}
                className={c.align === "right" ? "text-right" : undefined}
              >
                {c.header}
              </TableHead>
            ))}
            {desktopActions && (
              <TableHead className="text-right">Actions</TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            Array.from({ length: skeletonRows }).map((_, i) => (
              <TableRow key={i}>
                {Array.from({ length: span }).map((__, j) => (
                  <TableCell key={j}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={span}
                className="py-10 text-center text-sm text-muted-foreground"
              >
                {empty}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow
                key={rowKey(row)}
                className={onRowClick ? "cursor-pointer" : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                data-analytics-name={onRowClick ? rowActionName : undefined}
              >
                {columns.map((c) => (
                  <TableCell
                    key={c.key}
                    className={cn(
                      c.align === "right" &&
                        "whitespace-nowrap text-right tabular-nums",
                      c.className,
                    )}
                  >
                    {c.cell(row)}
                  </TableCell>
                ))}
                {desktopActions && (
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {desktopActions(row)}
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
