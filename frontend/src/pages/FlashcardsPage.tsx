import { useState } from "react";
import { GraduationCap, Layers, Loader2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { GlassCard } from "@/components/common/GlassCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Seo } from "@/components/common/Seo";
import { FlashcardViewer } from "@/components/chat/FlashcardViewer";
import { BookmarkButton } from "@/components/BookmarkButton";
import { useFlashcardSets } from "@/hooks/api";

export default function FlashcardsPage() {
  const { data: sets = [], isLoading } = useFlashcardSets();
  const [activeSet, setActiveSet] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const study = (id: string) => {
    setActiveSet(id);
    setOpen(true);
  };

  return (
    <AppShell title="Flashcards">
      <Seo title="Flashcards — Aeva" noindex path="/flashcards" />
      <div className="p-4">
        {isLoading ? (
          <div className="grid place-items-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : sets.length === 0 ? (
          <div className="grid place-items-center rounded-2xl border border-dashed border-border/60 py-20 text-center">
            <Layers className="mb-3 h-8 w-8 text-muted-foreground" />
            <p className="font-medium">No flashcards yet</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Use “Create Flashcards” on any answer, or type /flashcards in a
              chat, and your sets will appear here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {sets.map((s) => {
              const pct = s.card_count
                ? Math.round((s.studied / s.card_count) * 100)
                : 0;
              return (
                <GlassCard
                  key={s.id}
                  className="flex flex-col p-4 transition-shadow hover:shadow-glow"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="line-clamp-2 font-display text-base font-bold">
                      {s.title}
                    </h3>
                    <BookmarkButton
                      item={{
                        item_type: "flashcard",
                        item_ref: s.set_id,
                        title: s.title,
                        content: s.topic || s.title,
                        metadata: { set_id: s.set_id, topic: s.topic },
                      }}
                    />
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <Layers className="h-3.5 w-3.5" /> {s.card_count} cards
                    <span className="ml-auto">
                      {s.mastered} mastered
                    </span>
                  </div>
                  <Progress value={pct} className="mt-3 h-1" />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {pct}% studied
                  </p>
                  <Button
                    onClick={() => study(s.set_id)}
                    className="mt-4 w-full gap-2 bg-brand-gradient text-white"
                  >
                    <GraduationCap className="h-4 w-4" /> Study
                  </Button>
                </GlassCard>
              );
            })}
          </div>
        )}
      </div>

      <FlashcardViewer setId={activeSet} open={open} onOpenChange={setOpen} />
    </AppShell>
  );
}
