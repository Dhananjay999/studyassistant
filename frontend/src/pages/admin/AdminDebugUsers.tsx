// Developer / Debug Users: admin-managed roster of accounts with Developer
// Mode enabled. Debug users see internal diagnostics (model, tool, timings)
// throughout the app; normal users never do. Independent of any role — any
// student account can be toggled on temporarily and off again.

import { useEffect, useState } from "react";
import { Bug, Loader2, Search, ShieldCheck, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  useAdminDebugUsers,
  useAdminUsers,
  useSetDebugUser,
} from "@/hooks/adminApi";
import { formatDate } from "@/lib/adminFormat";
import type { AdminDebugUser, AdminUserRow } from "@/types/admin";

function UserIdentity({
  user,
}: {
  user: Pick<AdminDebugUser, "email" | "full_name" | "avatar_url">;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      {user.avatar_url ? (
        <img
          src={user.avatar_url}
          alt=""
          referrerPolicy="no-referrer"
          className="h-8 w-8 shrink-0 rounded-full"
        />
      ) : (
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold uppercase">
          {(user.full_name || user.email || "?").slice(0, 1)}
        </span>
      )}
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          {user.full_name || "—"}
        </p>
        <p className="truncate text-xs text-muted-foreground">{user.email}</p>
      </div>
    </div>
  );
}

export function AdminDebugUsers() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");

  // Debounce the search box (same cadence as the Users page).
  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const debugUsers = useAdminDebugUsers();
  const results = useAdminUsers({
    q: query,
    page: 1,
    page_size: 10,
    sort: "created_at",
    order: "desc",
    status: "all",
  });
  const setDebug = useSetDebugUser();
  const [busyId, setBusyId] = useState<string | null>(null);

  const toggle = (user: { id: string; email: string | null }, on: boolean) => {
    setBusyId(user.id);
    setDebug.mutate(
      { id: user.id, enabled: on },
      {
        onSuccess: () =>
          toast.success(
            `Developer Mode ${on ? "enabled" : "disabled"} for ${
              user.email ?? user.id
            }`,
          ),
        onError: () => toast.error("Couldn't update the debug flag"),
        onSettled: () => setBusyId(null),
      },
    );
  };

  const active = debugUsers.data?.users ?? [];
  const found: AdminUserRow[] = query ? (results.data?.users ?? []) : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Bug className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-semibold tracking-tight">Debug Users</h1>
        {debugUsers.data && (
          <span className="text-sm text-muted-foreground">
            ({active.length} active)
          </span>
        )}
      </div>

      <p className="max-w-2xl text-sm text-muted-foreground">
        Debug users see Developer Mode diagnostics in the app — model, tool,
        orchestrator decisions, and timings on every response. This works
        independently of roles: any account can be enabled temporarily for
        testing and disabled again. Normal users never see debug information.
      </p>

      {/* Active debug users */}
      <section className="rounded-xl border">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Active debug users</h2>
        </div>
        {debugUsers.isLoading ? (
          <div className="space-y-3 p-4">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : active.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            No debug users right now. Search below to add one.
          </p>
        ) : (
          <ul className="divide-y">
            {active.map((u) => (
              <li
                key={u.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <UserIdentity user={u} />
                <div className="flex shrink-0 items-center gap-3">
                  <span className="hidden text-xs text-muted-foreground sm:inline">
                    since {formatDate(u.created_at)}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={busyId === u.id}
                    onClick={() => toggle(u, false)}
                  >
                    {busyId === u.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <UserMinus className="h-3.5 w-3.5" />
                    )}
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Add / search */}
      <section className="rounded-xl border">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Add debug user</h2>
        </div>
        <div className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search users by name or email…"
              className="pl-9"
            />
          </div>

          {query &&
            (results.isLoading ? (
              <div className="mt-3 space-y-3">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : found.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">
                No users match “{query}”.
              </p>
            ) : (
              <ul className="mt-3 divide-y rounded-lg border">
                {found.map((u) => {
                  const on = !!u.is_debug_user;
                  return (
                    <li
                      key={u.id}
                      className="flex items-center justify-between gap-3 px-3 py-2.5"
                    >
                      <UserIdentity user={u} />
                      <div className="flex shrink-0 items-center gap-2.5">
                        {on && (
                          <Badge variant="secondary" className="gap-1">
                            <Bug className="h-3 w-3" /> Debug
                          </Badge>
                        )}
                        {busyId === u.id ? (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        ) : (
                          <Switch
                            checked={on}
                            aria-label={`Toggle Developer Mode for ${u.email}`}
                            onCheckedChange={(v) => toggle(u, v)}
                          />
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ))}
        </div>
      </section>
    </div>
  );
}
