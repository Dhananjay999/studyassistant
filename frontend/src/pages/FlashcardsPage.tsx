import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { GraduationCap, Layers } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { CardGridSkeleton } from "@/components/common/CardGridSkeleton";
import { GlassCard } from "@/components/common/GlassCard";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Seo } from "@/components/common/Seo";
import { ListToolbar } from "@/components/common/list";
import { FlashcardViewer } from "@/components/chat/FlashcardViewer";
import { BookmarkButton } from "@/components/BookmarkButton";
import { useFlashcardSets } from "@/hooks/api";
import { useListQuery } from "@/hooks/useListQuery";
import { useTabHosted } from "@/components/layout/tabPanel";
import {
  applyListQuery,
  byDateAsc,
  byDateDesc,
  type ListConfig,
} from "@/lib/listQuery";
import type { FlashcardListItem } from "@/types";

/** Sort/filter config for the flashcard-sets list. */
const FLASHCARD_CONFIG: ListConfig<FlashcardListItem> = {
  defaultSort: "recent",
  sorts: [
    { value: "recent", label: "Recently created", compare: (a, b) => byDateDesc(a.created_at, b.created_at) },
    { value: "oldest", label: "Oldest", compare: (a, b) => byDateAsc(a.created_at, b.created_at) },
    { value: "az", label: "Alphabetical (A–Z)", compare: (a, b) => a.title.localeCompare(b.title) },
    { value: "most_cards", label: "Most cards", compare: (a, b) => b.card_count - a.card_count },
  ],
  filters: [
    {
      id: "progress",
      label: "Progress",
      kind: "multi",
      options: [
        { value: "not_started", label: "Not started" },
        { value: "in_progress", label: "In progress" },
        { value: "mastered", label: "Mastered" },
      ],
      predicate: (s, sel) =>
        sel.some((v) =>
          v === "not_started"
            ? s.studied === 0
            : v === "mastered"
              ? s.card_count > 0 && s.mastered === s.card_count
              : s.studied > 0 && s.mastered < s.card_count,
        ),
    },
  ],
  searchFields: (s) => [s.title, s.topic],
};

export default function FlashcardsPage() {
  const { data: sets = [], isLoading } = useFlashcardSets();
  const [activeSet, setActiveSet] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  // Instant client-side search / sort / filter. Deep card-content search is
  // available from the global command palette (Cmd/Ctrl+F).
  // In-memory filters under mobile keep-alive (preserved across tab switches);
  // URL-persisted on desktop. See BookmarksPage for the rationale.
  const listQuery = useListQuery(FLASHCARD_CONFIG, {
    persist: !useTabHosted(),
  });
  const filtered = useMemo(
    () => applyListQuery(sets, FLASHCARD_CONFIG, listQuery.state),
    [sets, listQuery.state],
  );

  const study = (id: string) => {
    setActiveSet(id);
    setOpen(true);
  };

  // Deep-link: `/flashcards?setId=X` (e.g. from global search) opens that set,
  // then clears the param so it doesn't reopen on back/refresh.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const setId = searchParams.get("setId");
    if (!setId) return;
    study(setId);
    const next = new URLSearchParams(searchParams);
    next.delete("setId");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  return (
    <PageContainer title="Flashcards">
      <Seo title="Flashcards — Aeva" noindex path="/flashcards" />
      <div className="p-4">
        {isLoading ? (
          <CardGridSkeleton />
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
          <>
            <ListToolbar
              className="mb-4"
              config={FLASHCARD_CONFIG}
              query={listQuery}
              placeholder="Search flashcards by title or topic…"
            />
            {filtered.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">
                No flashcard sets match your search or filters.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {filtered.map((s) => {
                  const pct = s.card_count
                    ? Math.round((s.studied / s.card_count) * 100)
                    : 0;
                  return (
                <GlassCard
                  key={s.id}
                  className="flex flex-col p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-sm"
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
                    variant="brand"
                    className="mt-4 w-full gap-2"
                  >
                    <GraduationCap className="h-4 w-4" /> Study
                  </Button>
                </GlassCard>
              );
            })}
              </div>
            )}
          </>
        )}
      </div>

      <FlashcardViewer setId={activeSet} open={open} onOpenChange={setOpen} />
    </PageContainer>
  );
}
