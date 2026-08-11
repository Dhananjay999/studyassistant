// Formatted conversation viewer for one session — renders what the student
// actually saw (markdown, math, code, images, sources, quiz/flashcard cards)
// instead of raw rows. Each assistant turn has an expandable "Raw" section
// with the full stored metadata (tool, model, debug timings, payload) for
// troubleshooting, and the header offers Copy Full Chat / Copy Raw Data.

import { useState } from "react";
import {
  Bot,
  Braces,
  Check,
  ChevronDown,
  Copy,
  FileText,
  Globe,
  ImageIcon,
  Layers,
  ListChecks,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ResponsiveModal,
  ResponsiveModalBody,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "@/components/ui/responsive-modal";
import { Skeleton } from "@/components/ui/skeleton";
import { MarkdownContent } from "@/components/chat/MarkdownContent";
import { useAdminSession } from "@/hooks/adminApi";
import { cn } from "@/lib/utils";
import type { AdminMessage } from "@/types/admin";

/** Stored assistant payload (metadata.content) — loosely typed on purpose. */
type StoredContent = Record<string, unknown>;

function contentOf(m: AdminMessage): StoredContent {
  return (m.metadata?.content as StoredContent) ?? {};
}

function toolOf(m: AdminMessage): string | undefined {
  return (m.metadata?.tool_used as string | undefined) ?? undefined;
}

/** Compact, read-only source chips (web domains + document names). */
function SourceChips({ sources }: { sources: Array<Record<string, unknown>> }) {
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {sources.slice(0, 8).map((s, i) => {
        const doc = Boolean(s.media_id || s.document_name);
        const label =
          (s.document_name as string) ||
          (s.title as string) ||
          (s.url as string) ||
          "source";
        return (
          <span
            key={i}
            title={(s.url as string) || (s.snippet as string) || undefined}
            className="inline-flex max-w-[220px] items-center gap-1 rounded-full border border-border/60 bg-muted/30 px-2 py-0.5 text-[11px]"
          >
            {doc ? (
              <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
            ) : (
              <Globe className="h-3 w-3 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate">{label}</span>
            {s.page_number != null && (
              <span className="shrink-0 text-muted-foreground">
                p.{String(s.page_number)}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

/** Generated images: stored signed URLs may have expired — degrade politely. */
function ImageAttachments({
  images,
}: {
  images: Array<Record<string, unknown>>;
}) {
  const [broken, setBroken] = useState<Record<number, boolean>>({});
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {images.map((img, i) =>
        broken[i] || !img.url ? (
          <span
            key={i}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border/70 px-2.5 py-1.5 text-[11px] text-muted-foreground"
          >
            <ImageIcon className="h-3.5 w-3.5" />
            {(img.file_name as string) || "Generated image"} — URL expired
            (open via Files tab)
          </span>
        ) : (
          <a
            key={i}
            href={img.url as string}
            target="_blank"
            rel="noopener noreferrer"
            title={(img.file_name as string) || "Generated image"}
            className="block max-w-[260px] overflow-hidden rounded-lg border border-border/60"
          >
            <img
              src={img.url as string}
              alt={(img.file_name as string) || "Generated image"}
              loading="lazy"
              onError={() => setBroken((b) => ({ ...b, [i]: true }))}
              className="max-h-48 w-full object-contain"
            />
          </a>
        ),
      )}
    </div>
  );
}

/** One assistant/user turn, rendered like the student's chat. */
function MessageRow({ m }: { m: AdminMessage }) {
  const [showRaw, setShowRaw] = useState(false);
  const isUser = m.role === "user";
  const content = contentOf(m);
  const tool = toolOf(m);
  const sources = (content.sources as Array<Record<string, unknown>>) ?? [];
  const images = (content.images as Array<Record<string, unknown>>) ?? [];
  const quiz = content.quiz_id
    ? content
    : ((content.quiz as StoredContent | undefined) ?? undefined);
  const flashcards = content.set_id
    ? content
    : ((content.flashcards as StoredContent | undefined) ?? undefined);

  return (
    <div className={cn("flex gap-2.5", isUser && "flex-row-reverse")}>
      <span
        className={cn(
          "grid h-7 w-7 shrink-0 place-items-center rounded-full",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-brand-gradient text-white",
        )}
      >
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </span>

      <div
        className={cn(
          "min-w-0 rounded-xl border px-3.5 py-2.5 text-sm",
          isUser
            ? "max-w-[85%] border-transparent bg-primary/10"
            : "flex-1 border-border/50 bg-card/50",
        )}
      >
        {!isUser && tool && (
          <Badge variant="secondary" className="mb-1.5 text-[10px]">
            {tool}
          </Badge>
        )}

        {isUser ? (
          <p className="whitespace-pre-wrap break-words">{m.content}</p>
        ) : (
          <div className="learning-content prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-pre:my-2">
            <MarkdownContent content={m.content} />
          </div>
        )}

        {images.length > 0 && <ImageAttachments images={images} />}
        {sources.length > 0 && <SourceChips sources={sources} />}

        {quiz && (quiz.title || quiz.questions) ? (
          <span className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-brand-1/30 bg-brand-1/5 px-2.5 py-1.5 text-xs font-medium">
            <ListChecks className="h-3.5 w-3.5 text-brand-1" />
            Quiz: {(quiz.title as string) || "Untitled"} (
            {Array.isArray(quiz.questions) ? quiz.questions.length : "?"}{" "}
            questions)
          </span>
        ) : null}
        {flashcards && (flashcards.title || flashcards.cards) ? (
          <span className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-brand-1/30 bg-brand-1/5 px-2.5 py-1.5 text-xs font-medium">
            <Layers className="h-3.5 w-3.5 text-brand-1" />
            Flashcards: {(flashcards.title as string) || "Untitled"} (
            {Array.isArray(flashcards.cards) ? flashcards.cards.length : "?"}{" "}
            cards)
          </span>
        ) : null}

        {/* Raw stored metadata — the debug level of the two-level design. */}
        {!isUser && m.metadata && Object.keys(m.metadata).length > 0 && (
          <div className="mt-2 border-t border-border/40 pt-1.5">
            <button
              type="button"
              onClick={() => setShowRaw((v) => !v)}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <Braces className="h-3 w-3" />
              Raw data
              <ChevronDown
                className={cn(
                  "h-3 w-3 transition-transform",
                  showRaw && "rotate-180",
                )}
              />
            </button>
            {showRaw && (
              <pre className="mt-1.5 max-h-72 overflow-auto rounded-lg bg-muted/40 p-2.5 font-mono text-[10px] leading-relaxed">
                {JSON.stringify(m.metadata, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function SessionDialog({
  sessionId,
  onClose,
}: {
  sessionId: string | null;
  onClose: () => void;
}) {
  const { data, isLoading } = useAdminSession(sessionId);
  const [copied, setCopied] = useState<"chat" | "raw" | null>(null);

  const copy = async (kind: "chat" | "raw") => {
    if (!data) return;
    const text =
      kind === "chat"
        ? [
            "StudyAssistant Chat",
            "",
            ...data.messages.map(
              (m) =>
                `${m.role === "user" ? "User" : "Aeva"}:\n${m.content}\n`,
            ),
          ].join("\n")
        : JSON.stringify(data, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      toast.success(kind === "chat" ? "Chat copied" : "Raw data copied");
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error("Couldn't copy");
    }
  };

  return (
    <ResponsiveModal
      open={sessionId !== null}
      onOpenChange={(o) => !o && onClose()}
    >
      <ResponsiveModalContent className="max-h-[85vh] sm:max-w-3xl">
        <ResponsiveModalHeader>
          <div className="flex items-center justify-between gap-3 pr-6">
            <ResponsiveModalTitle className="truncate">
              {data?.session.title || "Conversation"}
            </ResponsiveModalTitle>
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-xs"
                disabled={!data}
                onClick={() => copy("chat")}
              >
                {copied === "chat" ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                Copy Full Chat
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 text-xs text-muted-foreground"
                disabled={!data}
                onClick={() => copy("raw")}
              >
                <Braces className="h-3 w-3" />
                Raw
              </Button>
            </div>
          </div>
        </ResponsiveModalHeader>
        <ResponsiveModalBody>
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : (
            <div className="space-y-4">
              {(data?.messages ?? []).map((m) => (
                <MessageRow key={m.id} m={m} />
              ))}
              {!data?.messages.length && (
                <p className="text-sm text-muted-foreground">No messages.</p>
              )}
            </div>
          )}
        </ResponsiveModalBody>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
