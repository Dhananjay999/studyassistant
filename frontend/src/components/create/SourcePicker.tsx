import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Check,
  FileText,
  ImageIcon,
  Lightbulb,
  Loader2,
  NotebookPen,
  type LucideIcon,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMedia, useNotes } from "@/hooks/api";
import { cn } from "@/lib/utils";
import type { SourceDraft } from "@/lib/generationSource";
import { isMediaSelectable, type GenerationSourceKind } from "@/types";

const KINDS: { value: GenerationSourceKind; label: string; icon: LucideIcon }[] =
  [
    { value: "topic", label: "Topic", icon: Lightbulb },
    { value: "files", label: "My files", icon: FileText },
    { value: "note", label: "A note", icon: NotebookPen },
  ];

/**
 * "What do you want to create … for?" — the material picker shared by the
 * Quizzes and Flashcards creation panels: a typed topic or subject, uploaded
 * files from the Files library, or a saved note.
 */
export function SourcePicker({
  value,
  onChange,
  question,
}: {
  value: SourceDraft;
  onChange: (next: SourceDraft) => void;
  question: string;
}) {
  const set = (patch: Partial<SourceDraft>) => onChange({ ...value, ...patch });

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label className="text-xs">{question}</Label>
        <div className="grid grid-cols-3 gap-2" role="radiogroup">
          {KINDS.map(({ value: kind, label, icon: Icon }) => {
            const active = value.kind === kind;
            return (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => set({ kind })}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg border px-2 py-2.5 text-xs font-medium transition-colors",
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {value.kind === "files" && (
        <FileList
          selected={value.mediaIds}
          onToggle={(id) =>
            set({
              mediaIds: value.mediaIds.includes(id)
                ? value.mediaIds.filter((m) => m !== id)
                : [...value.mediaIds, id],
            })
          }
        />
      )}
      {value.kind === "note" && (
        <NoteList
          selected={value.noteId}
          onSelect={(id) => set({ noteId: id })}
        />
      )}

      <div className="space-y-1.5">
        <Label className="text-xs">
          {value.kind === "topic" ? "Topic or subject" : "Focus (optional)"}
        </Label>
        <Input
          value={value.topic}
          onChange={(e) => set({ topic: e.target.value })}
          placeholder={
            value.kind === "topic"
              ? "e.g. Photosynthesis class 10, World War II causes"
              : "e.g. Chapter 3 only"
          }
          className="h-9"
        />
      </div>
    </div>
  );
}

function PickerRow({
  active,
  disabled,
  icon: Icon,
  title,
  hint,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  icon: LucideIcon;
  title: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors disabled:opacity-50",
        active ? "bg-primary/10 text-primary" : "hover:bg-muted",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {hint && (
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {hint}
        </span>
      )}
      {active && <Check className="h-4 w-4 shrink-0" />}
    </button>
  );
}

function ListShell({
  loading,
  empty,
  children,
}: {
  loading: boolean;
  empty: ReactNode | null;
  children: ReactNode;
}) {
  if (loading) {
    return (
      <div className="grid place-items-center rounded-lg border border-border/60 py-6">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (empty) {
    return (
      <p className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-center text-xs text-muted-foreground">
        {empty}
      </p>
    );
  }
  return (
    <div className="max-h-48 space-y-0.5 overflow-y-auto overscroll-contain rounded-lg border border-border/60 p-1">
      {children}
    </div>
  );
}

function FileList({
  selected,
  onToggle,
}: {
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const { data: media = [], isLoading } = useMedia();
  return (
    <ListShell
      loading={isLoading}
      empty={
        media.length === 0 ? (
          <>
            No uploaded files yet.{" "}
            <Link to="/files" className="font-medium text-primary underline">
              Upload in Files
            </Link>
          </>
        ) : null
      }
    >
      {media.map((m) => {
        const usable = isMediaSelectable(m);
        return (
          <PickerRow
            key={m.id}
            active={selected.includes(m.id)}
            disabled={!usable}
            icon={m.mime_type.startsWith("image/") ? ImageIcon : FileText}
            title={m.file_name}
            hint={usable ? undefined : "Processing…"}
            onClick={() => onToggle(m.id)}
          />
        );
      })}
    </ListShell>
  );
}

function NoteList({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const { data: notes = [], isLoading } = useNotes();
  return (
    <ListShell
      loading={isLoading}
      empty={
        notes.length === 0 ? (
          <>
            No notes yet.{" "}
            <Link to="/notes" className="font-medium text-primary underline">
              Create one in Notes
            </Link>
          </>
        ) : null
      }
    >
      {notes.map((n) => (
        <PickerRow
          key={n.id}
          active={selected === n.id}
          icon={NotebookPen}
          title={n.title || "Untitled note"}
          onClick={() => onSelect(n.id)}
        />
      ))}
    </ListShell>
  );
}
