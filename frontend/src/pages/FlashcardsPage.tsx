import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutationState } from "@tanstack/react-query";
import { GraduationCap, Layers, Plus } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { CardGridSkeleton } from "@/components/common/CardGridSkeleton";
import { GlassCard } from "@/components/common/GlassCard";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Seo } from "@/components/common/Seo";
import { ListToolbar } from "@/components/common/list";
import { FlashcardViewer } from "@/components/chat/FlashcardViewer";
import { CreateFlashcardsPanel } from "@/components/flashcard/CreateFlashcardsPanel";
import { LibraryEmptyState } from "@/components/create/LibraryEmptyState";
import { PendingCreationCard } from "@/components/create/PendingCreationCard";
import { BookmarkButton } from "@/components/BookmarkButton";
import { mk, useFlashcardSets } from "@/hooks/api";
import { analytics, AnalyticsEvent } from "@/lib/analytics";
import type { CreateEntry } from "@/lib/analytics/events";
import { describeSource } from "@/lib/generationSource";
import { useListQuery } from "@/hooks/useListQuery";
import { useTabHosted } from "@/components/layout/tabPanel";
import {
  applyListQuery,
  byDateAsc,
  byDateDesc,
  type ListConfig,
} from "@/lib/listQuery";
import type { FlashcardGenerateRequest, FlashcardListItem } from "@/types";

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

  // Direct creation: the panel, plus decks still generating from it (kept in
  // the mutation cache, so they survive the panel closing).
  const [createOpen, setCreateOpen] = useState(false);
  const pending = useMutationState({
    filters: { mutationKey: mk.generateFlashcards, status: "pending" },
    select: (m) => m.state.variables as FlashcardGenerateRequest,
  });
  const openCreate = (entry: CreateEntry) => {
    analytics.track(AnalyticsEvent.FLASHCARDS_SETUP_REQUESTED, {
      source: "flashcards_page",
      entry,
    });
    setCreateOpen(true);
  };

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

  // Analytics: how the currently open set was reached.
  const openSourceRef = useRef<"flashcards_page" | "deeplink">("flashcards_page");
  const study = (id: string, source: "flashcards_page" | "deeplink" = "flashcards_page") => {
    openSourceRef.current = source;
    setActiveSet(id);
    setOpen(true);
  };

  // Deep-link: `/flashcards?setId=X` (e.g. from global search) opens that set,
  // then clears the param so it doesn't reopen on back/refresh.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const setId = searchParams.get("setId");
    if (!setId) return;
    study(setId, "deeplink");
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
        ) : sets.length === 0 && pending.length === 0 ? (
          <LibraryEmptyState
            icon={Layers}
            title="Your flashcard library is empty"
            body="Create your first flashcard set and make revision easier."
            cta="Create your first flashcards"
            onCreate={() => openCreate("empty_state")}
          />
        ) : (
          <>
            <ListToolbar
              className="mb-4"
              config={FLASHCARD_CONFIG}
              query={listQuery}
              placeholder="Search flashcards by title or topic…"
              extra={
                <Button
                  variant="brand"
                  onClick={() => openCreate("header")}
                  className="ml-auto gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Create flashcards
                </Button>
              }
            />
            {filtered.length === 0 && pending.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">
                No flashcard sets match your search or filters.
              </p>
            ) : (
              <div
                className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
                data-analytics-private
                data-analytics-section="flashcards_list"
              >
                {pending.map((req, i) => (
                  <PendingCreationCard
                    key={`pending-${i}`}
                    title="Creating your flashcards…"
                    detail={`On ${describeSource(req)}`}
                  />
                ))}
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

      <CreateFlashcardsPanel open={createOpen} onOpenChange={setCreateOpen} />

      <FlashcardViewer
        setId={activeSet}
        open={open}
        onOpenChange={setOpen}
        source={openSourceRef.current}
      />
    </PageContainer>
  );
}
