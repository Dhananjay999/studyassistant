// Feature Flags: admin kill switches for the app's optional features. The
// registry (keys, labels, defaults) lives in backend code; this view shows
// it merged with the DB overrides and toggles flags globally for every user.
// Changes propagate within a few minutes (backend cache + /config staleTime).

import { useState } from "react";
import { Flag, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  useAdminFeatureFlags,
  useSetFeatureFlag,
} from "@/hooks/adminApi";
import { formatDate } from "@/lib/adminFormat";
import type { AdminFeatureFlag } from "@/types/admin";

export function AdminFeatureFlags() {
  const { data, isLoading } = useAdminFeatureFlags();
  const setFlag = useSetFeatureFlag();
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const toggle = (flag: AdminFeatureFlag, on: boolean) => {
    setBusyKey(flag.key);
    setFlag.mutate(
      { key: flag.key, enabled: on },
      {
        onSuccess: () =>
          toast.success(`${flag.label} ${on ? "enabled" : "disabled"}`),
        onError: () => toast.error("Couldn't update the feature flag"),
        onSettled: () => setBusyKey(null),
      },
    );
  };

  const flags = data?.flags ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Flag className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-semibold tracking-tight">
          Feature Flags
        </h1>
      </div>

      <p className="max-w-2xl text-sm text-muted-foreground">
        Global switches for the app's optional features. Disabling a flag
        hides the feature from every user (and stops the assistant from
        using the matching tool); nothing is deleted, and re-enabling
        restores it. Changes take effect within a few minutes.
      </p>

      <section className="rounded-xl border">
        {isLoading ? (
          <div className="space-y-3 p-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : flags.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            No feature flags registered.
          </p>
        ) : (
          <ul className="divide-y">
            {flags.map((f) => (
              <li
                key={f.key}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{f.label}</p>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {f.key}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {f.description}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground/70">
                    {f.updated_at
                      ? `Updated ${formatDate(f.updated_at)}`
                      : "Default"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2.5">
                  {busyKey === f.key ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Switch
                      checked={f.enabled}
                      aria-label={`Toggle ${f.label}`}
                      onCheckedChange={(v) => toggle(f, v)}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
