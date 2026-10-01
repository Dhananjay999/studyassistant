// Shown by the Traces, Trace and Prompt Map pages when the backend answers
// 403: the admin is signed in, but their token does not grant the permission
// these pages need. It is a state of the page, not an error: no toast, and
// the admin session stays signed in.

import { Lock } from "lucide-react";

export function NoTraceAccess({
  what = "traces",
}: {
  /** What the page shows, e.g. "traces" or "the Prompt Map". */
  what?: string;
}) {
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-lg border bg-muted/30 p-4"
    >
      <Lock
        aria-hidden
        className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground"
      />
      <div className="min-w-0 space-y-2 text-sm">
        <p className="font-semibold">
          You do not have permission to view {what}
        </p>
        <p className="text-muted-foreground">
          Traces and the Prompt Map show the prompts, model inputs and model
          outputs of real conversations, so they are limited to admins with
          the{" "}
          <code className="break-all rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
            VIEW_DEBUG_DATA
          </code>{" "}
          permission. You are still signed in, and the rest of the admin panel
          works as before.
        </p>
        <p className="text-muted-foreground">
          Permissions are set on the backend (
          <code className="break-all font-mono text-xs">ADMIN_PERMISSIONS</code>
          ) and take effect the next time you sign in.
        </p>
      </div>
    </div>
  );
}
