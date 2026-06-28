// Generic global manager for one resource (sessions/quizzes/flashcards/
// bookmarks/files). Search, filter-by-owner, per-row delete, delete-all,
// pagination — driven entirely by the resource key.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  BookMarked,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileText,
  Layers,
  ListChecks,
  type LucideIcon,
  MessageSquare,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { SessionDialog } from "@/components/admin/SessionDialog";
import {
  useAdminResource,
  useDeleteAll,
  useDeleteResourceItem,
} from "@/hooks/adminApi";
import { formatBytes, formatDate, formatDateTime } from "@/lib/adminFormat";
import type { AdminResourceItem, ResourceKey } from "@/types/admin";

const META: Record<
  ResourceKey,
  { title: string; icon: LucideIcon; placeholder: string }
> = {
  sessions: {
    title: "Sessions & Chats",
    icon: MessageSquare,
    placeholder: "Search chats by title…",
  },
  quizzes: {
    title: "Quizzes",
    icon: ListChecks,
    placeholder: "Search quizzes by title or topic…",
  },
  flashcards: {
    title: "Flashcard Sets",
    icon: Layers,
    placeholder: "Search sets by title or topic…",
  },
  bookmarks: {
    title: "Bookmarks",
    icon: BookMarked,
    placeholder: "Search bookmarks by title…",
  },
  files: {
    title: "Files",
    icon: FileText,
    placeholder: "Search files by name…",
  },
};

interface Column {
  header: string;
  align?: "right";
  cell: (it: AdminResourceItem) => ReactNode;
}

function columnsFor(resource: ResourceKey): Column[] {
  switch (resource) {
    case "sessions":
      return [
        { header: "Title", cell: (it) => it.title || "Untitled" },
        {
          header: "Mode",
          cell: (it) =>
            it.mode ? <Badge variant="secondary">{it.mode}</Badge> : "—",
        },
        { header: "Updated", cell: (it) => formatDateTime(it.updated_at) },
      ];
    case "quizzes":
      return [
        { header: "Title", cell: (it) => it.title || "—" },
        { header: "Topic", cell: (it) => it.topic || "—" },
      ];
    case "flashcards":
      return [
        { header: "Title", cell: (it) => it.title || "—" },
        { header: "Topic", cell: (it) => it.topic || "—" },
        {
          header: "Source",
          cell: (it) =>
            it.source_type ? (
              <Badge variant="secondary">{it.source_type}</Badge>
            ) : (
              "—"
            ),
        },
      ];
    case "bookmarks":
      return [
        { header: "Title", cell: (it) => it.title || "—" },
        {
          header: "Type",
          cell: (it) =>
            it.item_type ? (
              <Badge variant="secondary">{it.item_type}</Badge>
            ) : (
              "—"
            ),
        },
      ];
    case "files":
      return [
        { header: "File", cell: (it) => it.file_name || "—" },
        { header: "Type", cell: (it) => it.mime_type || "—" },
        {
          header: "Size",
          align: "right",
          cell: (it) => formatBytes(it.size_bytes),
        },
      ];
  }
}

const PAGE_SIZE = 25;

export function AdminResources({ resource }: { resource: ResourceKey }) {
  const meta = META[resource];
  const cols = useMemo(() => columnsFor(resource), [resource]);

  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [owner, setOwner] = useState<{ id: string; label: string } | null>(
    null,
  );
  const [pendingItem, setPendingItem] = useState<AdminResourceItem | null>(
    null,
  );
  const [confirmAll, setConfirmAll] = useState(false);
  const [openSession, setOpenSession] = useState<string | null>(null);

  // Debounce the search box; any new search resets to page 1.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ((prev) => {
        if (prev !== searchInput) setPage(1);
        return searchInput;
      });
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  const params = useMemo(
    () => ({ q, user_id: owner?.id ?? "", page, page_size: PAGE_SIZE }),
    [q, owner, page],
  );

  const { data, isLoading, isFetching, isError, error } = useAdminResource(
    resource,
    params,
  );
  const deleteItem = useDeleteResourceItem();
  const deleteAll = useDeleteAll();

  const totalPages = data
    ? Math.max(1, Math.ceil(data.total / data.page_size))
    : 1;
  const items = data?.items ?? [];
  const Icon = meta.icon;

  const filterByOwner = (it: AdminResourceItem) => {
    if (!it.owner_id) return;
    setOwner({ id: it.owner_id, label: it.owner_email || "selected user" });
    setPage(1);
  };

  const runDeleteItem = async () => {
    if (!pendingItem) return;
    try {
      await deleteItem.mutateAsync({ resource, id: pendingItem.id });
      toast.success("Deleted");
      setPendingItem(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const runDeleteAll = async () => {
    try {
      await deleteAll.mutateAsync(resource);
      toast.success(`Deleted all ${resource}`);
      setConfirmAll(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold tracking-tight">
            {meta.title}
          </h1>
          {data && (
            <span className="text-sm text-muted-foreground">
              ({data.total.toLocaleString()})
            </span>
          )}
        </div>
        <Button
          variant="destructive"
          size="sm"
          className="gap-1.5"
          disabled={!data?.total}
          onClick={() => setConfirmAll(true)}
        >
          <Trash2 className="h-4 w-4" />
          Delete all
        </Button>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={meta.placeholder}
            className="pl-9"
          />
        </div>
        {owner && (
          <Badge variant="secondary" className="gap-1.5 py-1.5 pl-3 pr-1.5">
            <span className="max-w-[180px] truncate">Owner: {owner.label}</span>
            <button
              type="button"
              onClick={() => {
                setOwner(null);
                setPage(1);
              }}
              className="rounded-full p-0.5 hover:bg-background/60"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </Badge>
        )}
      </div>

      {isError && (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Failed to load."}
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              {cols.map((c) => (
                <TableHead
                  key={c.header}
                  className={c.align === "right" ? "text-right" : undefined}
                >
                  {c.header}
                </TableHead>
              ))}
              <TableHead>Owner</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: cols.length + 3 }).map((__, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={cols.length + 3}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  Nothing found.
                </TableCell>
              </TableRow>
            ) : (
              items.map((it) => (
                <TableRow key={it.id}>
                  {cols.map((c) => (
                    <TableCell
                      key={c.header}
                      className={
                        c.align === "right"
                          ? "whitespace-nowrap text-right tabular-nums"
                          : "max-w-[260px] truncate"
                      }
                    >
                      {c.cell(it)}
                    </TableCell>
                  ))}
                  <TableCell>
                    <button
                      type="button"
                      onClick={() => filterByOwner(it)}
                      className="max-w-[180px] truncate text-left text-muted-foreground hover:text-foreground hover:underline"
                      title="Filter by this owner"
                    >
                      {it.owner_email || "—"}
                    </button>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDate(it.created_at)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {resource === "sessions" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setOpenSession(it.id)}
                          title="View conversation"
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setPendingItem(it)}
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Page {page} of {totalPages}
          {isFetching && " · updating…"}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
            Prev
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={pendingItem !== null}
        onOpenChange={(o) => !o && setPendingItem(null)}
        title="Delete this item?"
        description="This permanently deletes the record. This cannot be undone."
        confirmText="Delete"
        loading={deleteItem.isPending}
        onConfirm={runDeleteItem}
      />

      <ConfirmDialog
        open={confirmAll}
        onOpenChange={setConfirmAll}
        title={`Delete all ${meta.title.toLowerCase()}?`}
        description={`Permanently deletes EVERY ${resource} record across all users. This cannot be undone.`}
        confirmText="Delete all"
        confirmWord="DELETE"
        loading={deleteAll.isPending}
        onConfirm={runDeleteAll}
      />

      <SessionDialog
        sessionId={openSession}
        onClose={() => setOpenSession(null)}
      />
    </div>
  );
}
