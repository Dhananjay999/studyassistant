// Public, read-only view of a shared note: rendered markdown (tables, code,
// KaTeX) plus a sign-up CTA. No auth, no app shell — same surface as the
// other share renderers.

import { NotebookPen } from "lucide-react";
import { BrandLogo } from "@/components/common/BrandLogo";
import { GlassCard } from "@/components/common/GlassCard";
import { GoogleButton } from "@/components/landing/GoogleButton";
import { MarkdownContent } from "@/components/chat/MarkdownContent";

export interface SharedNoteContent {
  title: string;
  content_md: string;
  updated_at?: string;
}

export function SharedNoteView({ content }: { content: SharedNoteContent }) {
  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
        <div className="mb-6 flex items-center justify-between gap-3">
          <BrandLogo withWordmark />
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 px-3 py-1 text-xs font-medium text-muted-foreground">
            <NotebookPen className="h-3.5 w-3.5" /> Shared note
          </span>
        </div>

        <GlassCard strong className="p-5 sm:p-8">
          <h1 className="font-display text-2xl font-bold leading-tight">
            {content.title}
          </h1>
          {content.updated_at && (
            <p className="mt-1 text-xs text-muted-foreground">
              Updated {new Date(content.updated_at).toLocaleDateString()}
            </p>
          )}
          <div className="learning-content prose prose-sm mt-5 max-w-none dark:prose-invert prose-p:my-2 prose-pre:my-2">
            <MarkdownContent content={content.content_md} />
          </div>
        </GlassCard>

        <div className="mt-8 text-center">
          <p className="mb-3 text-sm text-muted-foreground">
            Made with Aeva — save answers as notes, then turn them into
            quizzes and flashcards.
          </p>
          <div className="flex justify-center">
            <GoogleButton label="Start learning free" />
          </div>
        </div>
      </div>
    </div>
  );
}
