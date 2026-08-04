// Note editor: markdown editing with a live-rendered preview (same renderer
// as chat answers — tables, code, KaTeX math), plus the learning actions that
// make notes a hub: quiz / flashcards / continue with Aeva (all through the
// existing source_content chat flow), share (generic share platform), and a
// print/PDF export of the rendered preview.

import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Layers,
  Loader2,
  MessageSquarePlus,
  NotebookPen,
  Printer,
  Save,
  Share2,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownContent } from "@/components/chat/MarkdownContent";
import { PageContainer } from "@/components/layout/PageContainer";
import { Seo } from "@/components/common/Seo";
import { useConfirm } from "@/components/common/ConfirmProvider";
import {
  useCreateSession,
  useDeleteNote,
  useNote,
  useUpdateNote,
} from "@/hooks/api";
import { createShare } from "@/lib/api";
import { printNote } from "@/lib/printReport";
import { cn } from "@/lib/utils";
import type { ChatSeed } from "@/types";

export default function NoteEditorPage() {
  const { noteId } = useParams<{ noteId: string }>();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const noteQuery = useNote(noteId);
  const updateNote = useUpdateNote();
  const deleteNote = useDeleteNote();
  const createSession = useCreateSession();

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<"preview" | "edit">("preview");
  const [sharing, setSharing] = useState(false);
  // The rendered preview node — its innerHTML feeds the print export.
  const previewRef = useRef<HTMLDivElement>(null);
  const seededId = useRef<string | null>(null);

  const note = noteQuery.data;

  // Seed local editing state once per loaded note.
  useEffect(() => {
    if (!note || seededId.current === note.id) return;
    seededId.current = note.id;
    setTitle(note.title);
    setBody(note.content_md);
    setDirty(false);
    setTab(note.content_md.trim() ? "preview" : "edit");
  }, [note]);

  const save = (onSaved?: () => void) => {
    if (!noteId) return;
    updateNote.mutate(
      { id: noteId, patch: { title: title.trim() || "Untitled note", content_md: body } },
      {
        onSuccess: () => {
          setDirty(false);
          onSaved?.();
        },
        onError: () => toast.error("Couldn't save the note"),
      },
    );
  };

  /** Run a learning action: save pending edits, then open a chat in the
   * note's space seeded with the note as the only source content. */
  const askAeva = (mode: ChatSeed["mode"], display: string) => {
    const run = async () => {
      try {
        const s = await createSession.mutateAsync({
          spaceId: note?.space_id ?? undefined,
        });
        const seed: ChatSeed = {
          mode,
          content: `# ${title}\n\n${body}`,
          title,
        };
        navigate(`/chat?sessionId=${s.id}`, { state: { seed } });
      } catch {
        toast.error(`Couldn't start "${display}"`);
      }
    };
    if (dirty) save(() => void run());
    else void run();
  };

  const exportPdf = () => {
    const html = previewRef.current?.innerHTML;
    if (!html) {
      // Preview not mounted (edit tab) — flip to it and let the user retry.
      setTab("preview");
      toast.info("Preview opened — tap Export again");
      return;
    }
    printNote(title.trim() || "Note", html);
  };

  const share = async () => {
    if (!noteId) return;
    setSharing(true);
    try {
      const link = await createShare("note", noteId);
      await navigator.clipboard.writeText(link.url);
      toast.success("Share link copied to clipboard");
    } catch {
      toast.error("Couldn't create a share link");
    } finally {
      setSharing(false);
    }
  };

  const remove = async () => {
    if (!noteId) return;
    const ok = await confirm({
      title: "Delete this note?",
      description: "This can't be undone.",
      destructive: true,
    });
    if (!ok) return;
    deleteNote.mutate(noteId, {
      onSuccess: () => navigate("/notes"),
      onError: () => toast.error("Couldn't delete the note"),
    });
  };

  return (
    <PageContainer title={note?.title ?? "Note"}>
      <Seo title={note?.title ?? "Note"} noindex />

      {noteQuery.isLoading || !note ? (
        <div className="space-y-3">
          <Skeleton className="h-10 w-2/3 rounded-xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      ) : (
        <div className="mx-auto max-w-3xl">
          {/* Top bar: back + title + save */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate("/notes")}
              aria-label="All notes"
              className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <Input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setDirty(true);
              }}
              placeholder="Note title"
              className="h-10 border-transparent bg-transparent font-display text-lg font-bold focus-visible:border-input"
            />
            <Button
              variant="brand"
              size="sm"
              className="shrink-0 gap-1.5"
              disabled={!dirty || updateNote.isPending}
              onClick={() => save(() => toast.success("Note saved"))}
            >
              {updateNote.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              {dirty ? "Save" : "Saved"}
            </Button>
          </div>

          {/* Learning actions */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 rounded-full text-xs"
              onClick={() => askAeva("quiz", "Create Quiz")}
            >
              <Sparkles className="h-3.5 w-3.5 text-brand-1" /> Create Quiz
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 rounded-full text-xs"
              onClick={() => askAeva("flashcards", "Create Flashcards")}
            >
              <Layers className="h-3.5 w-3.5 text-brand-1" /> Create Flashcards
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 rounded-full text-xs"
              onClick={() => askAeva("continue", "Continue with Aeva")}
            >
              <MessageSquarePlus className="h-3.5 w-3.5 text-brand-1" />
              Continue with Aeva
            </Button>
            <span className="ml-auto flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-8 gap-1.5 text-xs text-muted-foreground"
                onClick={exportPdf}
              >
                <Printer className="h-3.5 w-3.5" /> Export
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 gap-1.5 text-xs text-muted-foreground"
                disabled={sharing}
                onClick={share}
              >
                {sharing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Share2 className="h-3.5 w-3.5" />
                )}
                Share
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-destructive"
                onClick={remove}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </span>
          </div>

          {/* Editor / preview */}
          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v as "preview" | "edit")}
            className="mt-4"
          >
            <TabsList className="mb-3">
              <TabsTrigger value="preview" className="gap-1.5">
                <NotebookPen className="h-3.5 w-3.5" /> Preview
              </TabsTrigger>
              <TabsTrigger value="edit">Edit</TabsTrigger>
            </TabsList>
          </Tabs>

          {tab === "edit" && (
            <Textarea
              value={body}
              onChange={(e) => {
                setBody(e.target.value);
                setDirty(true);
              }}
              placeholder={
                "Write in markdown — **bold**, lists, tables, code fences, " +
                "and $math$ all render in the preview."
              }
              className="min-h-[50vh] font-mono text-sm leading-relaxed"
            />
          )}

          {/* The preview stays mounted (hidden while editing) so Export
             always has rendered HTML to print. */}
          <div
            className={cn(
              "rounded-2xl border border-border/50 bg-card/40 p-5",
              tab !== "preview" && "hidden",
            )}
          >
            {body.trim() ? (
              <div
                ref={previewRef}
                className="learning-content prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-pre:my-2"
              >
                <MarkdownContent content={body} />
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nothing here yet — switch to Edit and start writing.
              </p>
            )}
          </div>
        </div>
      )}
    </PageContainer>
  );
}
