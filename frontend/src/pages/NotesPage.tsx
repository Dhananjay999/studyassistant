// AI Notes library: every note (saved answers + manual), searchable
// client-side, newest-edited first. Clicking a card opens the editor.

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { NotebookPen, Plus, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/common/GlassCard";
import { CardGridSkeleton } from "@/components/common/CardGridSkeleton";
import { PageContainer } from "@/components/layout/PageContainer";
import { Seo } from "@/components/common/Seo";
import { useCreateNote, useNotes } from "@/hooks/api";
import type { NoteListItem } from "@/types";

function editedLabel(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Edited today";
  if (days === 1) return "Edited yesterday";
  if (days < 7) return `Edited ${days} days ago`;
  return `Edited ${new Date(iso).toLocaleDateString()}`;
}

function NoteCard({
  note,
  onOpen,
}: {
  note: NoteListItem;
  onOpen: () => void;
}) {
  return (
    <motion.button
      type="button"
      whileHover={{ y: -3 }}
      transition={{ duration: 0.15 }}
      onClick={onOpen}
      className="text-left"
    >
      <GlassCard className="flex h-full flex-col p-4 transition-colors hover:border-brand-1/30">
        <div className="flex items-start justify-between gap-2">
          <h3 className="line-clamp-1 font-display text-base font-bold leading-tight">
            {note.title}
          </h3>
          {note.source_type === "response" && (
            <Badge variant="secondary" className="shrink-0 gap-1 text-[10px]">
              <Sparkles className="h-3 w-3" /> From Aeva
            </Badge>
          )}
        </div>
        <p className="mt-1.5 line-clamp-3 flex-1 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
          {note.preview || "Empty note"}
        </p>
        <p className="mt-3 text-[11px] text-muted-foreground">
          {editedLabel(note.updated_at)}
        </p>
      </GlassCard>
    </motion.button>
  );
}

export default function NotesPage() {
  const navigate = useNavigate();
  const notesQuery = useNotes();
  const createNote = useCreateNote();
  const [search, setSearch] = useState("");

  const notes = useMemo(() => {
    const all = notesQuery.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.preview.toLowerCase().includes(q),
    );
  }, [notesQuery.data, search]);

  const newNote = () =>
    createNote.mutate(
      {},
      {
        onSuccess: (note) => navigate(`/notes/${note.id}`),
        onError: () => toast.error("Couldn't create a note"),
      },
    );

  return (
    <PageContainer title="Notes">
      <Seo title="Notes" noindex />

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search notes…"
            className="pl-9"
          />
        </div>
        <Button
          variant="brand"
          className="shrink-0 gap-1.5"
          disabled={createNote.isPending}
          onClick={newNote}
        >
          <Plus className="h-4 w-4" /> New note
        </Button>
      </div>

      {notesQuery.isLoading ? (
        <CardGridSkeleton count={6} />
      ) : notes.length === 0 ? (
        <GlassCard className="grid place-items-center gap-3 p-10 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-1/10 text-brand-1">
            <NotebookPen className="h-6 w-6" />
          </span>
          <div>
            <h3 className="font-display text-lg font-bold">
              {search ? "No notes match your search" : "No notes yet"}
            </h3>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              {search
                ? "Try a different search term."
                : "Save any of Aeva's answers as a note from the chat, or start one from scratch."}
            </p>
          </div>
          {!search && (
            <Button variant="brand" className="gap-1.5" onClick={newNote}>
              <Plus className="h-4 w-4" /> New note
            </Button>
          )}
        </GlassCard>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {notes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              onOpen={() => navigate(`/notes/${note.id}`)}
            />
          ))}
        </div>
      )}
    </PageContainer>
  );
}
