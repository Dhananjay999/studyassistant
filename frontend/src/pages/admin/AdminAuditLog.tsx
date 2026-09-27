// Audit trail of sensitive admin actions: who did what to which user and
// when. Insert-only server-side; this page is read-only by design.

import { ScrollText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveTable,
  type ResponsiveColumn,
} from "@/components/admin/ResponsiveTable";
import { useAdminAuditLog } from "@/hooks/adminApi";
import { formatDateTime } from "@/lib/adminFormat";
import type { AdminAuditEntry } from "@/types/admin";

const ACTION_TONE: Record<string, string> = {
  "user.delete": "bg-red-500/15 text-red-600 dark:text-red-400",
  "resource.delete_all": "bg-red-500/15 text-red-600 dark:text-red-400",
  "resource.clear": "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  "resource.delete": "bg-amber-500/15 text-amber-600 dark:text-amber-400",
};

const resourceText = (e: AdminAuditEntry) =>
  e.resource ||
  (Object.keys(e.detail ?? {}).length ? JSON.stringify(e.detail) : "—");

const COLUMNS: ResponsiveColumn<AdminAuditEntry>[] = [
  {
    key: "time",
    header: "Time",
    className: "whitespace-nowrap font-mono text-xs text-muted-foreground",
    cell: (e) => formatDateTime(e.created_at),
  },
  {
    key: "admin",
    header: "Admin",
    role: "secondary",
    className: "text-sm",
    cell: (e) => e.admin_username,
  },
  {
    key: "action",
    header: "Action",
    role: "primary",
    cell: (e) => (
      <Badge variant="secondary" className={ACTION_TONE[e.action] ?? ""}>
        {e.action}
      </Badge>
    ),
  },
  {
    key: "user",
    header: "User",
    className: "font-mono text-xs text-muted-foreground",
    cell: (e) => (e.user_id ? `${e.user_id.slice(0, 8)}…` : "—"),
  },
  {
    key: "resource",
    header: "Resource",
    className: "max-w-[220px] truncate text-xs text-muted-foreground",
    cell: resourceText,
    // Cards have the width to show the detail instead of truncating it.
    mobileCell: (e) => (
      <span className="line-clamp-2 break-all font-normal text-muted-foreground">
        {resourceText(e)}
      </span>
    ),
  },
];

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

      {isError ? (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Failed to load."}
        </p>
      ) : (
        <ResponsiveTable
          columns={COLUMNS}
          rows={entries}
          rowKey={(e) => e.id}
          loading={isLoading}
          skeletonRows={4}
          empty="No audited actions yet."
          analyticsSection="admin_audit_log"
        />
      )}
    </div>
  );
}
