// Card under an answer the notes generator wrote (a revision sheet, a
// formula sheet, important questions). The note's text is the answer itself;
// this card says it was saved and links to the copy in Notes, where it can
// be edited, printed and exported.

import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, NotebookPen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/common/GlassCard";
import { useFeature } from "@/hooks/useFeature";
import type { GeneratedNote } from "@/types";

export function NoteCard({ note }: { note: GeneratedNote }) {
  const reduce = useReducedMotion();
  // The link target lives behind the `notes` flag; no flag, no card.
  const enabled = useFeature("notes");
  if (!enabled) return null;

  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="mt-3 w-full max-w-md"
    >
      <GlassCard className="border-brand-1/20 p-3 sm:p-4">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-1/10 text-brand-1">
            <NotebookPen className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-muted-foreground">
              Saved to your Notes
            </p>
            <p className="mt-0.5 line-clamp-2 font-display text-sm font-bold leading-snug [overflow-wrap:anywhere]">
              {note.title}
            </p>
          </div>
        </div>
        <Button
          asChild
          variant="brand"
          className="mt-3 h-11 w-full gap-2 rounded-xl"
        >
          <Link
            to={`/notes/${note.note_id}`}
            data-analytics-name="Open generated note"
            data-analytics-location="chat_note_card"
          >
            Open note <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">
          Edit it, print it or export it as a PDF from the note.
        </p>
      </GlassCard>
    </motion.div>
  );
}
