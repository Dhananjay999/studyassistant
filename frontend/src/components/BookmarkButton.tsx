import { useState } from "react";
import { Bookmark, BookmarkCheck, Check, Folder, FolderPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  useBookmarks,
  useCollections,
  useCreateBookmark,
  useCreateCollection,
  useDeleteBookmark,
} from "@/hooks/api";
import type { CreateBookmarkInput } from "@/types";

/**
 * Bookmark toggle. Clicking opens a folder picker (it never saves silently);
 * the user chooses an existing folder or creates a new one. When already
 * saved, the popover offers to remove it.
 */
export function BookmarkButton({
  item,
  label = false,
  className,
}: {
  item: CreateBookmarkInput;
  label?: boolean;
  className?: string;
}) {
  const { data: bookmarks = [] } = useBookmarks();
  const { data: collections = [] } = useCollections();
  const create = useCreateBookmark();
  const remove = useDeleteBookmark();
  const createCollection = useCreateCollection();

  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newFolder, setNewFolder] = useState("");

  const ref = item.item_ref ?? null;
  const existing = bookmarks.find(
    (b) => b.item_type === item.item_type && b.item_ref === ref,
  );
  const saved = Boolean(existing);
  const folderName =
    collections.find((c) => c.id === existing?.collection_id)?.name ??
    "Favorites";
  const busy = create.isPending || remove.isPending || createCollection.isPending;

  const saveTo = async (collectionId: string) => {
    try {
      await create.mutateAsync({ ...item, collection_id: collectionId });
      const where = collections.find((c) => c.id === collectionId)?.name;
      toast.success(`Saved to ${where ?? "Favorites"}`);
      setOpen(false);
    } catch {
      toast.error("Couldn't save bookmark");
    }
  };

  const createAndSave = async () => {
    const name = newFolder.trim();
    if (!name) return;
    try {
      const col = await createCollection.mutateAsync(name);
      await create.mutateAsync({ ...item, collection_id: col.id });
      toast.success(`Saved to ${name}`);
      setNewFolder("");
      setCreating(false);
      setOpen(false);
    } catch {
      toast.error("Couldn't create folder");
    }
  };

  const removeBookmark = async () => {
    if (!existing) return;
    try {
      await remove.mutateAsync(existing.id);
      toast.success("Removed from bookmarks");
      setOpen(false);
    } catch {
      toast.error("Couldn't remove bookmark");
    }
  };

  const Icon = saved ? BookmarkCheck : Bookmark;

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setCreating(false);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size={label ? "sm" : "icon"}
          aria-pressed={saved}
          aria-label={saved ? "Edit bookmark" : "Add bookmark"}
          className={cn(
            label ? "h-7 gap-1.5 rounded-full px-3 text-xs" : "h-7 w-7",
            saved && "text-brand-1",
            className,
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          {label && <span>{saved ? "Saved" : "Save"}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        {saved ? (
          <div className="space-y-2">
            <p className="px-1 text-sm font-semibold">Bookmarked</p>
            <p className="px-1 text-xs text-muted-foreground">
              Saved in <span className="font-medium">{folderName}</span>
            </p>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              disabled={busy}
              onClick={removeBookmark}
            >
              Remove bookmark
            </Button>
          </div>
        ) : (
          <div className="space-y-1.5">
            <p className="px-1 text-sm font-semibold">Save to folder</p>
            <div className="max-h-44 space-y-0.5 overflow-y-auto">
              {collections.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  disabled={busy}
                  onClick={() => saveTo(c.id)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-50"
                >
                  <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{c.name}</span>
                  {c.name === "Favorites" && (
                    <Badge variant="secondary" className="ml-auto text-[10px]">
                      Default
                    </Badge>
                  )}
                </button>
              ))}
            </div>
            <Separator />
            {creating ? (
              <div className="flex items-center gap-1">
                <Input
                  autoFocus
                  value={newFolder}
                  onChange={(e) => setNewFolder(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") createAndSave();
                    if (e.key === "Escape") setCreating(false);
                  }}
                  placeholder="New folder name"
                  className="h-8"
                />
                <Button
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  disabled={busy || !newFolder.trim()}
                  onClick={createAndSave}
                  aria-label="Create and save"
                >
                  <Check className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-2"
                onClick={() => setCreating(true)}
              >
                <FolderPlus className="h-4 w-4" /> New folder
              </Button>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
