// Generic global manager for one resource (sessions/quizzes/flashcards/
// bookmarks/files). Search, filter-by-owner, per-row delete, delete-all,
// pagination — driven entirely by the resource key.

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  BookMarked,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileText,
  Filter,
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
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import {
  ResponsiveTable,
  type ResponsiveColumn,
} from "@/components/admin/ResponsiveTable";
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

type Column = Pick<
  ResponsiveColumn<AdminResourceItem>,
  "header" | "align" | "cell"
>;

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
  // The first resource column is the card title; the owner its subtitle;
  // everything else a labelled value.
  const cols = useMemo<ResponsiveColumn<AdminResourceItem>[]>(
    () => [
      ...columnsFor(resource).map(
        (c, index): ResponsiveColumn<AdminResourceItem> => ({
          ...c,
          key: c.header,
          role: index === 0 ? "primary" : "meta",
          className: c.align === "right" ? undefined : "max-w-[260px] truncate",
        }),
      ),
      {
        key: "owner",
        header: "Owner",
        role: "secondary",
        cell: (it) => (
          <button
            type="button"
            onClick={() => filterByOwnerRef.current(it)}
            data-analytics-name="Filter by owner"
            className="max-w-[180px] truncate text-left text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
            title="Filter by this owner"
          >
            {it.owner_email || "—"}
          </button>
        ),
        // The card offers a labelled "Filter by owner" button instead.
        mobileCell: (it) => it.owner_email || "—",
      },
      {
        key: "created",
        header: "Created",
        className: "whitespace-nowrap text-muted-foreground",
        cell: (it) => formatDate(it.created_at),
      },
    ],
    [resource],
  );

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
  const filterByOwnerRef = useRef<(it: AdminResourceItem) => void>(() => {});

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
  // The memoized columns call the latest handler through a ref.
  filterByOwnerRef.current = filterByOwner;

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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-5 w-5 shrink-0 text-primary" />
          <h1 className="truncate text-xl font-semibold tracking-tight">
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
          className="h-10 shrink-0 gap-1.5 sm:h-9"
          disabled={!data?.total}
          data-analytics-name="Delete all resources"
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
          <Badge
            variant="secondary"
            className="max-w-full gap-1 py-1 pl-3 pr-1 sm:max-w-[260px]"
            data-analytics-private
          >
            <span className="min-w-0 truncate">Owner: {owner.label}</span>
            <button
              type="button"
              aria-label="Clear owner filter"
              data-analytics-name="Clear owner filter"
              onClick={() => {
                setOwner(null);
                setPage(1);
              }}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full hover:bg-background/60 active:bg-background/80"
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

      <ResponsiveTable
        columns={cols}
        rows={items}
        rowKey={(it) => it.id}
        loading={isLoading}
        empty="Nothing found."
        analyticsSection="admin_resources_list"
        desktopActions={(it) => (
          <>
            {resource === "sessions" && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="View conversation"
                data-analytics-name="View conversation"
                onClick={() => setOpenSession(it.id)}
                title="View conversation"
              >
                <Eye className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              aria-label="Delete"
              data-analytics-name="Delete resource"
              onClick={() => setPendingItem(it)}
              title="Delete"
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </>
        )}
        mobileActions={(it) => (
          <>
            {resource === "sessions" && (
              <Button
                variant="outline"
                size="sm"
                className="h-10 gap-1.5"
                data-analytics-name="View conversation"
                onClick={() => setOpenSession(it.id)}
              >
                <Eye className="h-4 w-4" />
                View
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              className="h-10 gap-1.5"
              disabled={!it.owner_id}
              data-analytics-name="Filter by owner"
              onClick={() => filterByOwner(it)}
            >
              <Filter className="h-4 w-4" />
              This owner
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-10 gap-1.5 text-destructive hover:text-destructive"
              data-analytics-name="Delete resource"
              onClick={() => setPendingItem(it)}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </>
        )}
      />

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Page {page} of {totalPages}
          {isFetching && " · updating…"}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-10 sm:h-9"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
            Prev
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-10 sm:h-9"
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
