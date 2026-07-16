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
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SwipeableRow } from "@/components/common/SwipeableRow";
import { ConfirmModal } from "@/components/common/ConfirmModal";
import { ListToolbar } from "@/components/common/list";
import { FolderPickerSheet } from "@/components/bookmarks/FolderPickerSheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { useBackClose } from "@/hooks/useBackClose";
import { useLongPress } from "@/hooks/useLongPress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Seo } from "@/components/common/Seo";
import { CardGridSkeleton } from "@/components/common/CardGridSkeleton";
import { PageContainer } from "@/components/layout/PageContainer";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { QuizDrawer } from "@/components/chat/QuizDrawer";
import { FlashcardViewer } from "@/components/chat/FlashcardViewer";
import { MarkdownContent } from "@/components/chat/MarkdownContent";
import { getQuiz } from "@/lib/api";
import { useListQuery } from "@/hooks/useListQuery";
import { useTabHosted } from "@/components/layout/tabPanel";
import {
  applyListQuery,
  byDateAsc,
  byDateDesc,
  type ListConfig,
} from "@/lib/listQuery";
import { cn } from "@/lib/utils";
import {
  useBookmarks,
  useCollections,
  useCreateCollection,
  useCreateSession,
  useDeleteBookmark,
  useDeleteCollection,
  useRenameCollection,
  useUpdateBookmark,
} from "@/hooks/api";
import type {
  Bookmark as BookmarkT,
  BookmarkType,
  ChatSeed,
  QuizContent,
} from "@/types";

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

/**
 * Sort/filter config for the bookmarks list. `resolveFolder` maps a bookmark's
 * collection id to its folder name so search matches the folder too. (Folder
 * scoping itself is a separate sidebar pre-filter, not a toolbar filter.)
 */
function buildBookmarkConfig(
  resolveFolder: (id: string | null) => string,
): ListConfig<BookmarkT> {
  return {
    defaultSort: "recent",
    sorts: [
      { value: "recent", label: "Recently saved", compare: (a, b) => byDateDesc(a.created_at, b.created_at) },
      { value: "oldest", label: "Oldest", compare: (a, b) => byDateAsc(a.created_at, b.created_at) },
      { value: "name", label: "Alphabetical (A–Z)", compare: (a, b) => a.title.localeCompare(b.title) },
    ],
    filters: [
      {
        id: "type",
        label: "Type",
        kind: "multi",
        options: (Object.keys(TYPE_META) as BookmarkType[]).map((t) => ({
          value: t,
          label: TYPE_META[t].label,
        })),
        predicate: (b, sel) => sel.includes(b.item_type),
      },
    ],
    searchFields: (b) => [b.title, b.content, resolveFolder(b.collection_id)],
  };
}

export default function BookmarksPage() {
  const navigate = useNavigate();
  const { data: bookmarks = [], isLoading: bookmarksLoading } = useBookmarks();
  const { data: collections = [] } = useCollections();
  const createCollection = useCreateCollection();
  const renameCollection = useRenameCollection();
  const deleteCollection = useDeleteCollection();
  const removeBookmark = useDeleteBookmark();
  const updateBookmark = useUpdateBookmark();
  const createSession = useCreateSession();

  const isMobile = useIsMobile();

  const [activeCollection, setActiveCollection] = useState<string>("all");

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

  // Opening a bookmark surfaces its content in a centered popup (never a new
  // chat): quizzes → QuizDrawer, flashcards → FlashcardViewer, everything else
  // → a read-only content dialog with a "Continue in chat" springboard.
  const [contentBookmark, setContentBookmark] = useState<BookmarkT | null>(
    null,
  );
  const [quiz, setQuiz] = useState<QuizContent | null>(null);
  const [quizOpen, setQuizOpen] = useState(false);
  const [flashcardSetId, setFlashcardSetId] = useState<string | null>(null);
  const [cardsOpen, setCardsOpen] = useState(false);
  const [openingQuizId, setOpeningQuizId] = useState<string | null>(null);

  const openBookmark = async (b: BookmarkT) => {
    if (b.item_type === "quiz" && b.item_ref) {
      setOpeningQuizId(b.id);
      try {
        setQuiz(await getQuiz(b.item_ref));
        setQuizOpen(true);
      } catch {
        toast.error("This quiz is no longer available");
      } finally {
        setOpeningQuizId(null);
      }
      return;
    }
    if (b.item_type === "flashcard" && b.item_ref) {
      setFlashcardSetId(b.item_ref);
      setCardsOpen(true);
      return;
    }
    // response / note / media (and quizzes/flashcards missing their ref).
    setContentBookmark(b);
  };

  const continueInChat = async (b: BookmarkT) => {
    setContentBookmark(null);
    // Prefer reopening the exact conversation this bookmark came from. Only
    // when there's no origin session (deleted, or a note/media bookmark) do
    // we fall back to seeding a fresh chat with the saved content.
    if (b.session_id) {
      // For a saved response, item_ref is the message id — scroll to it.
      const highlightMessageId =
        b.item_type === "response" ? b.item_ref : undefined;
      navigate(`/chat?sessionId=${b.session_id}`, {
        state: highlightMessageId ? { highlightMessageId } : undefined,
      });
      return;
    }
    const seed: ChatSeed = {
      mode: "continue",
      content: b.content || b.title,
      title: b.title,
    };
    const session = await createSession.mutateAsync({});
    navigate(`/chat?sessionId=${session.id}`, { state: { seed } });
  };

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

  // Device/browser Back while selecting exits select mode (deselecting
  // everything) instead of leaving the page; the next Back navigates as usual.
  useBackClose(selectMode, exitSelect);

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

  const config = useMemo(
    () => buildBookmarkConfig(collectionName),
    // collectionName only depends on collections.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [collections],
  );
  // Under mobile keep-alive, hidden tabs stay mounted, so filters must NOT go
  // in the shared URL (they'd collide across tabs); use in-memory state, which
  // keep-alive preserves. Desktop keeps URL-persisted filters unchanged.
  const listQuery = useListQuery(config, { persist: !useTabHosted() });

  // Folder scoping is a sidebar pre-filter; search/sort/type live in the toolbar.
  const filtered = useMemo(() => {
    const scoped =
      activeCollection === "all"
        ? bookmarks
        : bookmarks.filter((b) => b.collection_id === activeCollection);
    return applyListQuery(scoped, config, listQuery.state);
  }, [bookmarks, activeCollection, config, listQuery.state]);

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
      <PageContainer title="Bookmarks">
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
            <ListToolbar
              className="mb-4"
              config={config}
              query={listQuery}
              placeholder="Search bookmarks…"
              extra={
                (filtered.length > 0 || selectMode) && (
                  <Button
                    variant={selectMode ? "default" : "outline"}
                    className="gap-2"
                    onClick={() =>
                      selectMode ? exitSelect() : setSelectMode(true)
                    }
                  >
                    <ListChecks className="h-4 w-4" />
                    {selectMode ? "Done" : "Select"}
                  </Button>
                )
              }
            />

            {bookmarksLoading && bookmarks.length === 0 ? (
              <CardGridSkeleton />
            ) : filtered.length === 0 ? (
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
                    opening={openingQuizId === b.id}
                    onOpen={() => openBookmark(b)}
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

        {/* Center popups — open a saved item in place instead of a new chat. */}
        <QuizDrawer quiz={quiz} open={quizOpen} onOpenChange={setQuizOpen} />
        <FlashcardViewer
          setId={flashcardSetId}
          open={cardsOpen}
          onOpenChange={setCardsOpen}
        />
        <BookmarkContentDialog
          bookmark={contentBookmark}
          onOpenChange={(o) => !o && setContentBookmark(null)}
          onContinue={continueInChat}
          continuing={createSession.isPending}
        />
      </PageContainer>
    </>
  );
}

/**
 * Read-only centered popup for text-style bookmarks (response / note / media,
 * or a quiz/flashcard whose source was deleted). Shows the saved content and
 * offers a "Continue in chat" springboard into a fresh session.
 */
function BookmarkContentDialog({
  bookmark,
  onOpenChange,
  onContinue,
  continuing,
}: {
  bookmark: BookmarkT | null;
  onOpenChange: (open: boolean) => void;
  onContinue: (b: BookmarkT) => void;
  continuing: boolean;
}) {
  const meta = bookmark ? TYPE_META[bookmark.item_type] : null;
  const Icon = meta?.icon ?? FileText;

  return (
    <Dialog open={bookmark !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl gap-0 overflow-hidden p-0">
        {bookmark && (
          <>
            <DialogHeader className="border-b border-border/50 px-5 py-4">
              <div className="mb-1.5 flex items-center gap-2">
                <Badge variant="secondary" className="gap-1 text-[10px]">
                  <Icon className="h-3 w-3" /> {meta?.label}
                </Badge>
                <span className="text-[10px] text-muted-foreground">
                  Saved {new Date(bookmark.created_at).toLocaleDateString()}
                </span>
              </div>
              <DialogTitle className="text-left text-lg">
                {bookmark.title || "Saved content"}
              </DialogTitle>
            </DialogHeader>

            <div className="max-h-[55vh] overflow-y-auto px-5 py-4">
              <div className="learning-content prose prose-sm max-w-none dark:prose-invert">
                <MarkdownContent
                  content={bookmark.content || "_No content saved._"}
                />
              </div>
            </div>

            <div className="flex justify-end border-t border-border/50 px-5 py-3">
              <Button
                onClick={() => onContinue(bookmark)}
                disabled={continuing}
                className="gap-2 bg-brand-gradient text-white"
              >
                {continuing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {bookmark.session_id ? "Open conversation" : "Continue in chat"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
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
  opening,
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
  opening: boolean;
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
    // Deliberately effect-free (no hover accents, no touch ripple): the card
    // is a calm reading surface; selection state is the only highlight.
    <div
      {...press}
      data-no-ripple
      className={cn(
        "flex h-full flex-col rounded-2xl border bg-card/50 p-4 transition-colors",
        selected
          ? "border-brand-1 ring-1 ring-brand-1"
          : "border-border/60",
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
        <button
          type="button"
          onClick={onOpen}
          disabled={opening}
          className="text-left"
        >
          <h3 className="flex items-center gap-1.5 text-sm font-semibold">
            <span className="line-clamp-2">
              {bookmark.title || "Untitled"}
            </span>
            {opening && (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
            )}
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
