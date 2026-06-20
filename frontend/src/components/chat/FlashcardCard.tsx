import { motion } from "framer-motion";
import { GraduationCap, Layers, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/common/GlassCard";
import type { FlashcardContent } from "@/types";

export function FlashcardCard({
  flashcards,
  onStudy,
}: {
  flashcards: FlashcardContent;
  onStudy: () => void;
}) {
  const count = flashcards.cards?.length ?? 0;
  const source = flashcards.source || flashcards.topic;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 320, damping: 24 }}
      className="mt-3 max-w-md"
    >
      <GlassCard className="border-brand-1/20 p-4">
        <div className="flex items-start justify-between gap-3">
          <h4 className="flex items-center gap-1.5 font-display text-base font-bold leading-tight">
            <Layers className="h-4 w-4 text-brand-1" />
            {flashcards.title}
          </h4>
          <Badge variant="secondary" className="shrink-0">
            Flashcards
          </Badge>
        </div>
        {source && (
          <p className="mt-1 truncate text-xs text-muted-foreground">
            Based on “{source}”
          </p>
        )}

        <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Sparkles className="h-4 w-4" /> {count} cards ready to study
        </div>

        <Button
          onClick={onStudy}
          className="mt-4 w-full gap-2 bg-brand-gradient text-white"
        >
          <GraduationCap className="h-4 w-4" /> Study Flashcards
        </Button>
      </GlassCard>
    </motion.div>
  );
}
