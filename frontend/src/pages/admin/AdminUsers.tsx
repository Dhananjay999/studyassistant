// Searchable, sortable, paginated user table. Row click opens user detail.

import { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Search,
  Users as UsersIcon,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAdminUsers } from "@/hooks/adminApi";
import { formatBytes, formatDate, formatDateTime } from "@/lib/adminFormat";
import type { AdminUsersParams } from "@/types/admin";

const DEFAULT_PARAMS: AdminUsersParams = {
  q: "",
  page: 1,
  page_size: 25,
  sort: "created_at",
  order: "desc",
  status: "all",
};

const SORTS: { value: AdminUsersParams["sort"]; label: string }[] = [
  { value: "created_at", label: "Joined date" },
  { value: "email", label: "Email" },
  { value: "full_name", label: "Name" },
];

const STATUSES: { value: AdminUsersParams["status"]; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "completed", label: "Onboarded" },
  { value: "pending", label: "Pending" },
  { value: "skipped", label: "Skipped" },
];

export function AdminUsers({
  onSelectUser,
}: {
  onSelectUser: (id: string) => void;
}) {
  const [params, setParams] = useState<AdminUsersParams>(DEFAULT_PARAMS);
  const [search, setSearch] = useState("");

  // Debounce the search box into the query params.
  useEffect(() => {
    const t = setTimeout(() => {
      setParams((p) => (p.q === search ? p : { ...p, q: search, page: 1 }));
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, isFetching, isError, error } =
    useAdminUsers(params);

  const totalPages = useMemo(() => {
    if (!data) return 1;
    return Math.max(1, Math.ceil(data.total / data.page_size));
  }, [data]);

  const patch = (next: Partial<AdminUsersParams>) =>
    setParams((p) => ({ ...p, ...next }));

  const users = data?.users ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <UsersIcon className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-semibold tracking-tight">Users</h1>
        {data && (
          <span className="text-sm text-muted-foreground">
            ({data.total.toLocaleString()})
          </span>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            className="pl-9"
          />
        </div>
        <Select
          value={params.status}
          onValueChange={(v) =>
            patch({ status: v as AdminUsersParams["status"], page: 1 })
          }
        >
          <SelectTrigger className="sm:w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={params.sort}
          onValueChange={(v) =>
            patch({ sort: v as AdminUsersParams["sort"], page: 1 })
          }
        >
          <SelectTrigger className="sm:w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          onClick={() =>
            patch({ order: params.order === "desc" ? "asc" : "desc" })
          }
        >
          {params.order === "desc" ? "Desc" : "Asc"}
        </Button>
      </div>

      {isError && (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Failed to load users."}
        </p>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead>Last active</TableHead>
              <TableHead className="text-right">Chats</TableHead>
              <TableHead className="text-right">Quizzes</TableHead>
              <TableHead className="text-right">Cards</TableHead>
              <TableHead className="text-right">Storage</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 9 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : users.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={9}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  No users found.
                </TableCell>
              </TableRow>
            ) : (
              users.map((u) => (
                <TableRow
                  key={u.id}
                  className="cursor-pointer"
                  onClick={() => onSelectUser(u.id)}
                >
                  <TableCell className="font-medium">
                    {u.full_name || "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {u.email || "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="capitalize">
                      {u.login_provider}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDate(u.joined_at)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(u.last_active)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {u.total_chats}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {u.total_quizzes}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {u.total_flashcards}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">
                    {formatBytes(u.storage_used)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Page {params.page} of {totalPages}
          {isFetching && " · updating…"}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={params.page <= 1}
            onClick={() => patch({ page: params.page - 1 })}
          >
            <ChevronLeft className="h-4 w-4" />
            Prev
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={params.page >= totalPages}
            onClick={() => patch({ page: params.page + 1 })}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
