import { MarkdownContent } from "@/components/chat/MarkdownContent";
import { Bot, ListChecks, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Bookmark } from "@/types";

/**
 * Read-only preview of a bookmark rendered inside the chat as a normal
 * response card. No session exists yet — actions create one lazily.
 */
export function BookmarkPreview({
  bookmark,
  onContinue,
  onQuiz,
  onFlashcards,
  onClose,
}: {
  bookmark: Bookmark;
  onContinue: () => void;
  onQuiz: () => void;
  onFlashcards: () => void;
  onClose: () => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-6">
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="gap-1">
          Saved {bookmark.item_type}
        </Badge>
        <span className="text-xs text-muted-foreground">Preview</span>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto h-7 w-7"
          onClick={onClose}
          aria-label="Close preview"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-gradient text-white">
          <Bot className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1 rounded-2xl rounded-bl-sm glass px-4 py-3 text-sm leading-relaxed">
          {bookmark.title && (
            <p className="mb-1 font-display text-base font-bold">
              {bookmark.title}
            </p>
          )}
          <div className="learning-content prose prose-sm max-w-none dark:prose-invert prose-p:my-2">
            <MarkdownContent content={bookmark.content || "_No content saved._"} />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 pl-11">
        <Button
          size="sm"
          onClick={onContinue}
          className="gap-1.5 bg-brand-gradient text-white"
        >
          <Sparkles className="h-4 w-4" /> Continue Learning
        </Button>
        <Button size="sm" variant="outline" onClick={onQuiz} className="gap-1.5">
          <ListChecks className="h-4 w-4" /> Create Quiz
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onFlashcards}
          className="gap-1.5"
        >
          <Sparkles className="h-4 w-4" /> Create Flashcards
        </Button>
      </div>
      <p className="pl-11 text-xs text-muted-foreground">
        Ask a follow-up below to continue in a new chat.
      </p>
    </div>
  );
}
