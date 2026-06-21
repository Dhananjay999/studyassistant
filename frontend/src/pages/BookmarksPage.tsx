import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft,
  Bookmark,
  Check,
  FileText,
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Seo } from "@/components/common/Seo";
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

  const [activeCollection, setActiveCollection] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<BookmarkType | "all">("all");
  const [sort, setSort] = useState<SortKey>("recent");

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deletingFolderId, setDeletingFolderId] = useState<string | null>(null);
  const [deletingBookmarkId, setDeletingBookmarkId] = useState<string | null>(
    null,
  );

  const removeBookmarkById = async (id: string) => {
    setDeletingBookmarkId(id);
    try {
      await removeBookmark.mutateAsync(id);
      toast.success("Removed from bookmarks");
    } catch {
      toast.error("Couldn't remove bookmark");
    } finally {
      setDeletingBookmarkId(null);
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
      <div className="flex min-h-dvh flex-col bg-background">
        <header className="flex items-center gap-2 border-b border-border/50 px-4 py-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/chat")}
            aria-label="Back to chat"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Bookmark className="h-5 w-5 text-brand-1" />
          <h1 className="font-display text-lg font-bold">Bookmarks</h1>
          <Badge variant="secondary" className="ml-1">
            {bookmarks.length}
          </Badge>
        </header>

        <div className="flex flex-1 flex-col lg:flex-row">
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
                    collections={collections}
                    onOpen={() =>
                      navigate("/chat", { state: { previewBookmark: b } })
                    }
                    onMove={(collectionId) =>
                      updateBookmark.mutate({ id: b.id, collection_id: collectionId })
                    }
                    removing={deletingBookmarkId === b.id}
                    onRemove={() => removeBookmarkById(b.id)}
                  />
                ))}
              </div>
            )}
          </main>
        </div>
      </div>
    </>
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
  collections,
  removing = false,
  onOpen,
  onMove,
  onRemove,
}: {
  bookmark: BookmarkT;
  folderName: string;
  collections: Array<{ id: string; name: string }>;
  removing?: boolean;
  onOpen: () => void;
  onMove: (collectionId: string) => void;
  onRemove: () => void;
}) {
  const meta = TYPE_META[bookmark.item_type];
  const Icon = meta.icon;
  return (
    <div className="flex flex-col rounded-2xl border border-border/60 bg-card/50 p-4 transition-colors hover:border-brand-1/40">
      <div className="mb-2 flex items-center gap-2">
        <Badge variant="secondary" className="gap-1 text-[10px]">
          <Icon className="h-3 w-3" /> {meta.label}
        </Badge>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {new Date(bookmark.created_at).toLocaleDateString()}
        </span>
      </div>
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
      <div className="mt-3 flex items-center gap-1 border-t border-border/40 pt-2">
        <Badge variant="outline" className="text-[10px]">
          {folderName}
        </Badge>
        <div className="ml-auto flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
              >
                Move
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Move to folder</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {collections.map((c) => (
                <DropdownMenuItem key={c.id} onClick={() => onMove(c.id)}>
                  {c.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={onRemove}
            disabled={removing}
            aria-label="Remove bookmark"
          >
            {removing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>
    </div>
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
