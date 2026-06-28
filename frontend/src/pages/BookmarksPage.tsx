import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Bookmark,
  Check,
  FileText,
  FolderInput,
  FolderPlus,
  Layers,
  ListChecks,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SwipeableRow } from "@/components/common/SwipeableRow";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { FolderPickerSheet } from "@/components/bookmarks/FolderPickerSheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLongPress } from "@/hooks/useLongPress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Seo } from "@/components/common/Seo";
import { AppShell } from "@/components/AppShell";
import { cn } from "@/lib/utils";
import {
  useBookmarks,
  useCollections,
  useCreateCollection,
  useDeleteBookmark,
  useDeleteCollection,
  useRenameCollection,
  useUpdateBookmark,
} from "@/hooks/api";
import type { Bookmark as BookmarkT, BookmarkType } from "@/types";

type SortKey = "recent" | "oldest" | "name";

const TYPE_META: Record<
  BookmarkType,
  { label: string; icon: typeof FileText }
> = {
  response: { label: "Response", icon: MessageSquare },
  quiz: { label: "Quiz", icon: ListChecks },
  flashcard: { label: "Flashcards", icon: Layers },
  media: { label: "Media", icon: FileText },
  note: { label: "Note", icon: NotebookPen },
};

const TYPE_FILTERS: Array<BookmarkType | "all"> = [
  "all",
  "response",
  "quiz",
  "flashcard",
  "media",
  "note",
];

export default function BookmarksPage() {
  const navigate = useNavigate();
  const { data: bookmarks = [] } = useBookmarks();
  const { data: collections = [] } = useCollections();
  const createCollection = useCreateCollection();
  const renameCollection = useRenameCollection();
  const deleteCollection = useDeleteCollection();
  const removeBookmark = useDeleteBookmark();
  const updateBookmark = useUpdateBookmark();

  const isMobile = useIsMobile();

  const [activeCollection, setActiveCollection] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<BookmarkType | "all">("all");
  const [sort, setSort] = useState<SortKey>("recent");

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deletingFolderId, setDeletingFolderId] = useState<string | null>(null);

  // Multi-select (entered via long-press or the Select toggle).
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Pending move (folder picker) / delete (confirm) for one or many bookmarks.
  const [moveState, setMoveState] = useState<{
    ids: string[];
    currentId?: string | null;
  } | null>(null);
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  const enterSelect = (id: string) => {
    setSelectMode(true);
    setSelectedIds(new Set([id]));
  };

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const exitSelect = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const confirmDelete = async () => {
    if (!confirmIds) return;
    const ids = confirmIds;
    setBulkBusy(true);
    try {
      await Promise.all(ids.map((id) => removeBookmark.mutateAsync(id)));
      toast.success(
        ids.length === 1
          ? "Removed from bookmarks"
          : `Removed ${ids.length} bookmarks`,
      );
      setConfirmIds(null);
      exitSelect();
    } catch {
      toast.error("Couldn't remove bookmarks");
    } finally {
      setBulkBusy(false);
    }
  };

  const applyMove = async (collectionId: string | null) => {
    if (!moveState) return;
    const ids = moveState.ids;
    setBulkBusy(true);
    try {
      await Promise.all(
        ids.map((id) =>
          updateBookmark.mutateAsync({ id, collection_id: collectionId }),
        ),
      );
      toast.success(ids.length === 1 ? "Moved" : `Moved ${ids.length} bookmarks`);
      setMoveState(null);
      exitSelect();
    } catch {
      toast.error("Couldn't move bookmarks");
    } finally {
      setBulkBusy(false);
    }
  };

  const collectionName = (id: string | null) =>
    collections.find((c) => c.id === id)?.name ?? "Unfiled";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = bookmarks.slice();
    if (activeCollection !== "all") {
      list = list.filter((b) => b.collection_id === activeCollection);
    }
    if (typeFilter !== "all") {
      list = list.filter((b) => b.item_type === typeFilter);
    }
    if (q) {
      list = list.filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          b.content.toLowerCase().includes(q) ||
          collectionName(b.collection_id).toLowerCase().includes(q),
      );
    }
    list.sort((a, b) => {
      if (sort === "name") return a.title.localeCompare(b.title);
      const da = new Date(a.created_at).getTime();
      const db = new Date(b.created_at).getTime();
      return sort === "oldest" ? da - db : db - da;
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookmarks, collections, activeCollection, typeFilter, query, sort]);

  const countFor = (id: string) =>
    bookmarks.filter((b) => b.collection_id === id).length;

  const submitNew = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await createCollection.mutateAsync(name);
      toast.success("Folder created");
      setNewName("");
      setCreating(false);
    } catch {
      toast.error("Couldn't create folder");
    }
  };

  const submitRename = async (id: string) => {
    const name = editName.trim();
    if (!name) return;
    try {
      await renameCollection.mutateAsync({ id, name });
      toast.success("Folder renamed");
      setEditingId(null);
    } catch {
      toast.error("Couldn't rename folder");
    }
  };

  const removeFolder = async (id: string) => {
    setDeletingFolderId(id);
    try {
      await deleteCollection.mutateAsync(id);
      toast.success("Folder deleted");
      if (activeCollection === id) setActiveCollection("all");
    } catch {
      toast.error("Couldn't delete folder");
    } finally {
      setDeletingFolderId(null);
    }
  };

  return (
    <>
      <Seo title="Bookmarks — Aeva" noindex path="/bookmarks" />
      <AppShell title="Bookmarks" hideDesktopSidebar backTo="/chat">
        <div className="flex min-h-full flex-col lg:flex-row">
          {/* Folder navigation */}
          <aside className="w-full shrink-0 border-b border-border/50 p-3 lg:w-64 lg:border-b-0 lg:border-r">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Folders
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setCreating((c) => !c)}
                aria-label="New folder"
              >
                <FolderPlus className="h-4 w-4" />
              </Button>
            </div>

            {creating && (
              <div className="mb-2 flex items-center gap-1 px-1">
                <Input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitNew();
                    if (e.key === "Escape") setCreating(false);
                  }}
                  placeholder="Folder name"
                  className="h-8"
                />
                <Button size="icon" className="h-8 w-8" onClick={submitNew}>
                  <Check className="h-4 w-4" />
                </Button>
              </div>
            )}

            <nav className="flex flex-col gap-0.5">
              <FolderRow
                label="All bookmarks"
                count={bookmarks.length}
                active={activeCollection === "all"}
                onClick={() => setActiveCollection("all")}
              />
              {collections.map((c) =>
                editingId === c.id ? (
                  <div key={c.id} className="flex items-center gap-1 px-1 py-1">
                    <Input
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") submitRename(c.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="h-8"
                    />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => setEditingId(null)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <FolderRow
                    key={c.id}
                    label={c.name}
                    count={countFor(c.id)}
                    active={activeCollection === c.id}
                    deleting={deletingFolderId === c.id}
                    onClick={() => setActiveCollection(c.id)}
                    onRename={() => {
                      setEditingId(c.id);
                      setEditName(c.name);
                    }}
                    onDelete={() => removeFolder(c.id)}
                  />
                ),
              )}
            </nav>
          </aside>

          {/* Main */}
          <main className="flex-1 p-4">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search bookmarks…"
                  className="pl-9"
                />
              </div>
              <Select
                value={sort}
                onValueChange={(v) => setSort(v as SortKey)}
              >
                <SelectTrigger className="w-full sm:w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recent">Recent</SelectItem>
                  <SelectItem value="oldest">Oldest</SelectItem>
                  <SelectItem value="name">Name</SelectItem>
                </SelectContent>
              </Select>
              {filtered.length > 0 && (
                <Button
                  variant={selectMode ? "default" : "outline"}
                  className="gap-2 sm:w-auto"
                  onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
                >
                  <ListChecks className="h-4 w-4" />
                  {selectMode ? "Done" : "Select"}
                </Button>
              )}
            </div>

            <div className="mb-4 flex flex-wrap gap-1.5">
              {TYPE_FILTERS.map((t) => (
                <Button
                  key={t}
                  size="sm"
                  variant={typeFilter === t ? "default" : "outline"}
                  className="h-7 rounded-full px-3 text-xs capitalize"
                  onClick={() => setTypeFilter(t)}
                >
                  {t === "all" ? "All" : TYPE_META[t].label}
                </Button>
              ))}
            </div>

            {filtered.length === 0 ? (
              <EmptyBookmarks hasAny={bookmarks.length > 0} />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {filtered.map((b) => (
                  <BookmarkCard
                    key={b.id}
                    bookmark={b}
                    folderName={collectionName(b.collection_id)}
                    swipeEnabled={isMobile}
                    selectMode={selectMode}
                    selected={selectedIds.has(b.id)}
                    onToggleSelect={() => toggleSelect(b.id)}
                    onEnterSelect={() => enterSelect(b.id)}
                    onOpen={() =>
                      navigate("/chat", { state: { previewBookmark: b } })
                    }
                    onRequestMove={() =>
                      setMoveState({ ids: [b.id], currentId: b.collection_id })
                    }
                    onRequestRemove={() => setConfirmIds([b.id])}
                  />
                ))}
              </div>
            )}
          </main>
        </div>

        {selectMode && (
          <SelectionBar
            count={selectedIds.size}
            total={filtered.length}
            onSelectAll={() =>
              setSelectedIds(new Set(filtered.map((b) => b.id)))
            }
            onMove={() =>
              selectedIds.size > 0 &&
              setMoveState({ ids: [...selectedIds] })
            }
            onDelete={() =>
              selectedIds.size > 0 && setConfirmIds([...selectedIds])
            }
            onCancel={exitSelect}
          />
        )}

        <FolderPickerSheet
          open={moveState !== null}
          onOpenChange={(o) => !o && setMoveState(null)}
          collections={collections}
          currentId={moveState?.currentId}
          count={moveState?.ids.length ?? 1}
          busy={bulkBusy}
          onPick={applyMove}
        />

        <ConfirmModal
          open={confirmIds !== null}
          onOpenChange={(o) => !o && setConfirmIds(null)}
          title={
            (confirmIds?.length ?? 0) > 1
              ? `Remove ${confirmIds?.length} bookmarks?`
              : "Remove bookmark?"
          }
          description="This can't be undone."
          confirmText="Remove"
          destructive
          loading={bulkBusy}
          onConfirm={confirmDelete}
        />
      </AppShell>
    </>
  );
}

function SelectionBar({
  count,
  total,
  onSelectAll,
  onMove,
  onDelete,
  onCancel,
}: {
  count: number;
  total: number;
  onSelectAll: () => void;
  onMove: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border/60 bg-background/95 px-3 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex max-w-3xl items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={onCancel}
          aria-label="Cancel selection"
        >
          <X className="h-5 w-5" />
        </Button>
        <span className="text-sm font-medium">{count} selected</span>
        {count < total && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={onSelectAll}
          >
            Select all
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={count === 0}
            onClick={onMove}
          >
            <FolderInput className="h-4 w-4" /> Move
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="gap-1.5"
            disabled={count === 0}
            onClick={onDelete}
          >
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
        </div>
      </div>
    </div>
  );
}

function FolderRow({
  label,
  count,
  active,
  deleting = false,
  onClick,
  onRename,
  onDelete,
}: {
  label: string;
  count: number;
  active: boolean;
  deleting?: boolean;
  onClick: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div
      className={cn(
        "group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm",
        deleting && "opacity-60",
        active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex flex-1 items-center gap-2 truncate text-left"
      >
        <span className="truncate">{label}</span>
        <span className="ml-auto text-xs text-muted-foreground">{count}</span>
      </button>
      {deleting ? (
        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin text-muted-foreground" />
      ) : (onRename || onDelete) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 opacity-0 group-hover:opacity-100"
              aria-label="Folder options"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onRename && (
              <DropdownMenuItem onClick={onRename}>
                <Pencil className="mr-2 h-4 w-4" /> Rename
              </DropdownMenuItem>
            )}
            {onDelete && (
              <DropdownMenuItem
                onClick={onDelete}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" /> Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function BookmarkCard({
  bookmark,
  folderName,
  swipeEnabled,
  selectMode,
  selected,
  onToggleSelect,
  onEnterSelect,
  onOpen,
  onRequestMove,
  onRequestRemove,
}: {
  bookmark: BookmarkT;
  folderName: string;
  swipeEnabled: boolean;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onEnterSelect: () => void;
  onOpen: () => void;
  onRequestMove: () => void;
  onRequestRemove: () => void;
}) {
  const meta = TYPE_META[bookmark.item_type];
  const Icon = meta.icon;

  // Long-press enters multi-select; a plain tap opens (or toggles in select
  // mode). Movement cancels the press so it never fires mid-scroll/-swipe.
  const press = useLongPress({
    onLongPress: () => {
      if (!selectMode) onEnterSelect();
    },
    onTap: () => {
      if (selectMode) onToggleSelect();
    },
  });

  const card = (
    <div
      {...press}
      className={cn(
        "flex h-full flex-col rounded-2xl border bg-card/50 p-4 transition-colors",
        selected
          ? "border-brand-1 ring-1 ring-brand-1"
          : "border-border/60 hover:border-brand-1/40",
        selectMode && "cursor-pointer select-none",
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <Badge variant="secondary" className="gap-1 text-[10px]">
          <Icon className="h-3 w-3" /> {meta.label}
        </Badge>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {new Date(bookmark.created_at).toLocaleDateString()}
        </span>
        {selectMode && (
          <span
            className={cn(
              "grid h-5 w-5 place-items-center rounded-full border transition-colors",
              selected
                ? "border-brand-1 bg-brand-1 text-white"
                : "border-muted-foreground/40",
            )}
            aria-hidden
          >
            {selected && <Check className="h-3.5 w-3.5" />}
          </span>
        )}
      </div>

      {selectMode ? (
        <div className="text-left">
          <h3 className="line-clamp-2 text-sm font-semibold">
            {bookmark.title || "Untitled"}
          </h3>
          {bookmark.content && (
            <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">
              {bookmark.content}
            </p>
          )}
        </div>
      ) : (
        <button type="button" onClick={onOpen} className="text-left">
          <h3 className="line-clamp-2 text-sm font-semibold hover:underline">
            {bookmark.title || "Untitled"}
          </h3>
          {bookmark.content && (
            <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">
              {bookmark.content}
            </p>
          )}
        </button>
      )}

      <div className="mt-auto flex items-center gap-1 border-t border-border/40 pt-3">
        <Badge variant="outline" className="text-[10px]">
          {folderName}
        </Badge>
        {!selectMode && (
          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs"
              onClick={onRequestMove}
            >
              <FolderInput className="h-3.5 w-3.5" /> Move
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={onRequestRemove}
              aria-label="Remove bookmark"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <SwipeableRow
      disabled={!swipeEnabled || selectMode}
      className="h-full rounded-2xl"
      leading={{
        icon: <FolderInput className="h-5 w-5" />,
        label: "Move",
        onAction: onRequestMove,
        className: "bg-brand-1",
      }}
      trailing={{
        icon: <Trash2 className="h-5 w-5" />,
        label: "Delete",
        onAction: onRequestRemove,
        className: "bg-destructive",
      }}
    >
      {card}
    </SwipeableRow>
  );
}

function EmptyBookmarks({ hasAny }: { hasAny: boolean }) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-border/60 py-20 text-center">
      <Bookmark className="mb-3 h-8 w-8 text-muted-foreground" />
      <p className="font-medium">
        {hasAny ? "No bookmarks match your filters" : "No bookmarks yet"}
      </p>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        {hasAny
          ? "Try a different folder, type, or search term."
          : "Save responses, quizzes, and materials with the bookmark icon to find them here."}
      </p>
    </div>
  );
}
