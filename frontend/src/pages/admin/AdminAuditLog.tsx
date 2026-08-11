// Audit trail of sensitive admin actions: who did what to which user and
// when. Insert-only server-side; this page is read-only by design.

import { ScrollText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAdminAuditLog } from "@/hooks/adminApi";
import { formatDateTime } from "@/lib/adminFormat";

const ACTION_TONE: Record<string, string> = {
  "user.delete": "bg-red-500/15 text-red-600 dark:text-red-400",
  "resource.delete_all": "bg-red-500/15 text-red-600 dark:text-red-400",
  "resource.clear": "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  "resource.delete": "bg-amber-500/15 text-amber-600 dark:text-amber-400",
};

export function AdminAuditLog() {
  const { data, isLoading, isError, error } = useAdminAuditLog();
  const entries = data?.entries ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ScrollText className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-semibold tracking-tight">Audit Log</h1>
        {data && (
          <span className="text-sm text-muted-foreground">
            (last {entries.length})
          </span>
        )}
      </div>
      <p className="max-w-2xl text-sm text-muted-foreground">
        Every sensitive admin action — profile edits, deletions, debug-user
        changes — is recorded here automatically and cannot be modified.
      </p>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : isError ? (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Failed to load."}
        </p>
      ) : entries.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No audited actions yet.
        </p>
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Admin</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Resource</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                    {formatDateTime(e.created_at)}
                  </TableCell>
                  <TableCell className="text-sm">{e.admin_username}</TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={ACTION_TONE[e.action] ?? ""}
                    >
                      {e.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {e.user_id ? `${e.user_id.slice(0, 8)}…` : "—"}
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground">
                    {e.resource ||
                      (Object.keys(e.detail ?? {}).length
                        ? JSON.stringify(e.detail)
                        : "—")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
