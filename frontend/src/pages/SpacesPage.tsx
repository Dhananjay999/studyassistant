// My Study Spaces: grid of subject workspaces + create/edit/delete. The
// General (default) space is shown last, subdued, as the home of unfiled
// content — it cannot be edited or deleted.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Layers,
  LibraryBig,
  ListChecks,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { GlassCard } from "@/components/common/GlassCard";
import { CardGridSkeleton } from "@/components/common/CardGridSkeleton";
import { PageContainer } from "@/components/layout/PageContainer";
import { Seo } from "@/components/common/Seo";
import { SpaceDialog, type SpaceFormValues } from "@/components/spaces/SpaceDialog";
import {
  useCreateSpace,
  useDeleteSpace,
  useSpaces,
  useUpdateSpace,
} from "@/hooks/api";
import { defaultSpace, realSpaces, spaceColor, spaceIcon } from "@/lib/spaces";
import { cn } from "@/lib/utils";
import type { StudySpace } from "@/types";

function relativeDay(iso: string | null): string {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Studied today";
  if (days === 1) return "Studied yesterday";
  if (days < 7) return `Studied ${days} days ago`;
  return `Last studied ${new Date(iso).toLocaleDateString()}`;
}

function SpaceCard({
  space,
  onOpen,
  onEdit,
  onDelete,
}: {
  space: StudySpace;
  onOpen: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const color = spaceColor(space.color);
  const Icon = spaceIcon(space.icon);
  const c = space.counts ?? {};
  const stats: [typeof MessageSquare, number | undefined][] = [
    [MessageSquare, c.sessions],
    [ListChecks, c.quizzes],
    [Layers, c.flashcard_sets],
  ];

  return (
    <motion.div whileHover={{ y: -3 }} transition={{ duration: 0.15 }}>
      <GlassCard
        className={cn(
          "group relative cursor-pointer p-4 transition-colors hover:border-brand-1/30",
          space.is_default && "opacity-80",
        )}
        onClick={onOpen}
      >
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "grid h-10 w-10 shrink-0 place-items-center rounded-xl",
              color.tint,
              color.text,
            )}
          >
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-display text-base font-bold leading-tight">
              {space.name}
            </h3>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {space.is_default
                ? "Unfiled chats & materials"
                : space.subject || space.description || "Study space"}
            </p>
          </div>
          {(onEdit || onDelete) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Space options"
                  onClick={(e) => e.stopPropagation()}
                  className="shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                onClick={(e) => e.stopPropagation()}
              >
                {onEdit && (
                  <DropdownMenuItem onClick={onEdit}>
                    <Pencil className="mr-2 h-3.5 w-3.5" /> Edit
                  </DropdownMenuItem>
                )}
                {onDelete && (
                  <DropdownMenuItem
                    onClick={onDelete}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
          {stats.map(([StatIcon, n], i) => (
            <span key={i} className="flex items-center gap-1">
              <StatIcon className="h-3.5 w-3.5" />
              {n ?? 0}
            </span>
          ))}
          <span className="ml-auto truncate">
            {relativeDay(space.last_activity_at)}
          </span>
        </div>
      </GlassCard>
    </motion.div>
  );
}

export default function SpacesPage() {
  const navigate = useNavigate();
  const spacesQuery = useSpaces();
  const createSpace = useCreateSpace();
  const updateSpace = useUpdateSpace();
  const deleteSpace = useDeleteSpace();

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<StudySpace | null>(null);
  const [deleting, setDeleting] = useState<StudySpace | null>(null);
  const [deleteMode, setDeleteMode] = useState<"move" | "purge">("move");

  const spaces = realSpaces(spacesQuery.data);
  const general = defaultSpace(spacesQuery.data);

  const submitCreate = (values: SpaceFormValues) =>
    createSpace.mutate(values, {
      onSuccess: (space) => {
        setCreateOpen(false);
        navigate(`/spaces/${space.id}`);
      },
      onError: () => toast.error("Couldn't create the space"),
    });

  const submitEdit = (values: SpaceFormValues) => {
    if (!editing) return;
    updateSpace.mutate(
      { id: editing.id, patch: values },
      {
        onSuccess: () => setEditing(null),
        onError: () => toast.error("Couldn't update the space"),
      },
    );
  };

  const confirmDelete = () => {
    if (!deleting) return;
    deleteSpace.mutate(
      { id: deleting.id, mode: deleteMode },
      {
        onSuccess: () => {
          toast.success(
            deleteMode === "move"
              ? "Space deleted — its content moved to General"
              : "Space and its content deleted",
          );
          setDeleting(null);
        },
        onError: () => toast.error("Couldn't delete the space"),
      },
    );
  };

  return (
    <PageContainer title="Study Spaces">
      <Seo title="Study Spaces" noindex />

      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          One workspace per subject — chats, files, quizzes and flashcards
          stay together.
        </p>
        <Button
          variant="brand"
          className="shrink-0 gap-1.5"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="h-4 w-4" /> New space
        </Button>
      </div>

      {spacesQuery.isLoading ? (
        <CardGridSkeleton count={6} />
      ) : spaces.length === 0 ? (
        <GlassCard className="grid place-items-center gap-3 p-10 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-1/10 text-brand-1">
            <LibraryBig className="h-6 w-6" />
          </span>
          <div>
            <h3 className="font-display text-lg font-bold">
              Create your first Study Space
            </h3>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Organize a subject — like “Operating Systems” or “NEET Biology” —
              and every chat, file, quiz and flashcard for it stays in one
              place. Your existing chats are untouched.
            </p>
          </div>
          <Button
            variant="brand"
            className="gap-1.5"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-4 w-4" /> New space
          </Button>
        </GlassCard>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {spaces.map((space) => (
            <SpaceCard
              key={space.id}
              space={space}
              onOpen={() => navigate(`/spaces/${space.id}`)}
              onEdit={() => setEditing(space)}
              onDelete={() => {
                setDeleteMode("move");
                setDeleting(space);
              }}
            />
          ))}
          {general && (
            <SpaceCard
              space={general}
              onOpen={() => navigate(`/spaces/${general.id}`)}
            />
          )}
        </div>
      )}

      <SpaceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New Study Space"
        submitLabel="Create space"
        busy={createSpace.isPending}
        onSubmit={submitCreate}
      />

      <SpaceDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        title="Edit Study Space"
        submitLabel="Save changes"
        initial={editing ?? undefined}
        busy={updateSpace.isPending}
        onSubmit={submitEdit}
      />

      {/* Delete: choose what happens to the space's content. */}
      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete “{deleting?.name}”?</DialogTitle>
            <DialogDescription>
              Choose what happens to the chats, files, quizzes and flashcards
              inside it.
            </DialogDescription>
          </DialogHeader>
          <RadioGroup
            value={deleteMode}
            onValueChange={(v) => setDeleteMode(v as "move" | "purge")}
            className="gap-3"
          >
            <label className="flex cursor-pointer items-start gap-2.5">
              <RadioGroupItem value="move" id="del-move" className="mt-0.5" />
              <span>
                <Label htmlFor="del-move" className="cursor-pointer">
                  Keep content
                </Label>
                <p className="text-xs text-muted-foreground">
                  Move everything to General. Nothing is lost.
                </p>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5">
              <RadioGroupItem
                value="purge"
                id="del-purge"
                className="mt-0.5"
              />
              <span>
                <Label htmlFor="del-purge" className="cursor-pointer">
                  Delete everything
                </Label>
                <p className="text-xs text-muted-foreground">
                  Permanently delete the space and all content inside it.
                </p>
              </span>
            </label>
          </RadioGroup>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant={deleteMode === "purge" ? "destructive" : "brand"}
              disabled={deleteSpace.isPending}
              onClick={confirmDelete}
            >
              {deleteMode === "purge" ? "Delete everything" : "Delete space"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
