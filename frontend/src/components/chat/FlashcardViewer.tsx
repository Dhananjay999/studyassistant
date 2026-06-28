import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  ListChecks,
  Loader2,
  RotateCcw,
  Shuffle,
  Sparkles,
  Trophy,
} from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { BookmarkButton } from "@/components/BookmarkButton";
import {
  useCreateSession,
  useFlashcardSet,
  useRecordStudy,
} from "@/hooks/api";
import { cn } from "@/lib/utils";
import type { ChatSeed, FlashcardAnalytics, StudyRating } from "@/types";

const RATINGS: Array<{ value: StudyRating; label: string; cls: string }> = [
  { value: "easy", label: "Easy", cls: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400" },
  { value: "medium", label: "Medium", cls: "border-amber-500/40 text-amber-600 dark:text-amber-400" },
  { value: "hard", label: "Hard", cls: "border-orange-500/40 text-orange-600 dark:text-orange-400" },
  { value: "needs_revision", label: "Needs Revision", cls: "border-red-500/40 text-red-600 dark:text-red-400" },
];

function shuffle<T>(arr: T[], seed: number): T[] {
  // Deterministic shuffle (no Math.random) so renders stay stable.
  const a = arr.slice();
  let s = seed + 1;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function FlashcardViewer({
  setId,
  open,
  onOpenChange,
}: {
  setId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { data, isLoading } = useFlashcardSet(open ? setId : null);
  const recordStudy = useRecordStudy();
  const createSession = useCreateSession();

  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [shuffleSeed, setShuffleSeed] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [analytics, setAnalytics] = useState<FlashcardAnalytics | null>(null);

  const cards = useMemo(() => data?.cards ?? [], [data?.cards]);
  const order = useMemo(
    () =>
      shuffleSeed
        ? shuffle(
            cards.map((_, i) => i),
            shuffleSeed,
          )
        : cards.map((_, i) => i),
    [cards, shuffleSeed],
  );
  const total = cards.length;
  const card = total > 0 ? cards[order[index] ?? 0] : null;

  // Reset when a different set opens; seed analytics from the server.
  useEffect(() => {
    setIndex(0);
    setFlipped(false);
    setShuffleSeed(0);
    setCompleted(false);
  }, [setId, open]);
  useEffect(() => {
    if (data?.analytics) setAnalytics(data.analytics);
  }, [data?.analytics]);

  const restart = () => {
    setIndex(0);
    setFlipped(false);
    setCompleted(false);
  };

  const go = (delta: number) => {
    setFlipped(false);
    if (delta > 0 && index >= total - 1) {
      setCompleted(true);
      return;
    }
    setIndex((i) => Math.min(total - 1, Math.max(0, i + delta)));
  };

  const rate = async (rating: StudyRating) => {
    if (!setId || !card) return;
    try {
      const next = await recordStudy.mutateAsync({
        setId,
        flashcardId: card.id,
        rating,
      });
      setAnalytics(next);
    } catch {
      /* ignore — rating is best-effort */
    }
    if (index < total - 1) go(1);
    else setCompleted(true);
  };

  // Keyboard navigation.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setFlipped((f) => !f);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, total]);

  const resume = async (mode: ChatSeed["mode"]) => {
    if (!data) return;
    const content =
      `${data.title}\n\n` +
      data.cards.map((c) => `Q: ${c.front}\nA: ${c.back}`).join("\n\n");
    const seed: ChatSeed = { mode, content, title: data.title };
    const session = await createSession.mutateAsync({});
    onOpenChange(false);
    navigate(`/chat?sessionId=${session.id}`, { state: { seed } });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl"
      >
        {isLoading || !data ? (
          <div className="grid flex-1 place-items-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <>
            <div className="border-b border-border/50 px-5 py-4">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-brand-1" />
                <h2 className="flex-1 truncate font-display text-lg font-bold">
                  {data.title}
                </h2>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => setShuffleSeed((s) => (s ? 0 : Date.parse(data.created_at) || 7))}
                  aria-label="Shuffle"
                  title="Shuffle"
                >
                  <Shuffle
                    className={cn("h-4 w-4", shuffleSeed && "text-brand-1")}
                  />
                </Button>
                <BookmarkButton
                  item={{
                    item_type: "flashcard",
                    item_ref: data.set_id,
                    title: data.title,
                    content: data.topic || data.title,
                    metadata: { set_id: data.set_id, topic: data.topic },
                  }}
                />
              </div>
              {total > 0 && (
                <>
                  <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      Card {index + 1} of {total}
                    </span>
                    {analytics && (
                      <span>{analytics.completion}% complete</span>
                    )}
                  </div>
                  <Progress
                    value={((index + 1) / total) * 100}
                    className="mt-2 h-1"
                  />
                </>
              )}
            </div>

            {completed ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 py-8 text-center">
                <div className="grid h-16 w-16 place-items-center rounded-2xl bg-brand-gradient text-white">
                  <Trophy className="h-8 w-8" />
                </div>
                <div>
                  <h3 className="font-display text-xl font-bold">
                    Flashcards Completed
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Total cards reviewed: {total}
                  </p>
                  {analytics && (
                    <div className="mt-2 flex justify-center gap-3 text-xs">
                      <span className="text-emerald-600 dark:text-emerald-400">
                        Mastered {analytics.mastered}
                      </span>
                      <span className="text-red-600 dark:text-red-400">
                        Needs revision {analytics.needs_revision}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex w-full max-w-sm flex-col gap-2">
                  <Button
                    onClick={() => resume("quiz")}
                    disabled={createSession.isPending}
                    className="gap-2 bg-brand-gradient text-white"
                  >
                    <ListChecks className="h-4 w-4" /> Generate Quiz
                  </Button>
                  <Button
                    variant="outline"
                    onClick={restart}
                    className="gap-2"
                  >
                    <RotateCcw className="h-4 w-4" /> Restart Flashcards
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => resume("continue")}
                    disabled={createSession.isPending}
                    className="gap-2"
                  >
                    <Sparkles className="h-4 w-4" /> Continue Learning
                  </Button>
                  <div className="flex justify-center pt-1">
                    <BookmarkButton
                      label
                      item={{
                        item_type: "flashcard",
                        item_ref: data.set_id,
                        title: data.title,
                        content: data.topic || data.title,
                        metadata: { set_id: data.set_id, topic: data.topic },
                      }}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="flex flex-1 flex-col items-center justify-center gap-4 px-5 py-6">
                  {card ? (
                    <motion.div
                      drag="x"
                      dragSnapToOrigin
                      dragConstraints={{ left: 0, right: 0 }}
                      dragElastic={0.5}
                      onDragEnd={(_e, info) => {
                        if (info.offset.x < -80) go(1);
                        else if (info.offset.x > 80) go(-1);
                      }}
                      onTap={() => setFlipped((f) => !f)}
                      role="button"
                      tabIndex={0}
                      aria-label="Flip card; swipe left or right to navigate"
                      className="relative h-72 w-full max-w-md cursor-grab touch-pan-y [perspective:1200px] active:cursor-grabbing"
                    >
                  <motion.div
                    className="pointer-events-none relative h-full w-full [transform-style:preserve-3d]"
                    animate={{ rotateY: flipped ? 180 : 0 }}
                    transition={{ duration: 0.5 }}
                  >
                    <div className="absolute inset-0 grid place-items-center rounded-2xl border border-border/60 bg-card p-6 text-center [backface-visibility:hidden]">
                      <div className="learning-content">
                        <Badge variant="secondary" className="mb-3">
                          Question
                        </Badge>
                        <p className="text-lg font-semibold">{card.front}</p>
                        <p className="mt-4 text-xs text-muted-foreground">
                          Tap or press Space to flip
                        </p>
                      </div>
                    </div>
                    <div className="absolute inset-0 grid place-items-center overflow-auto rounded-2xl border border-brand-1/30 bg-card p-6 text-center [backface-visibility:hidden] [transform:rotateY(180deg)]">
                      <div className="learning-content">
                        <Badge className="mb-3 bg-brand-gradient text-white">
                          Answer
                        </Badge>
                        <p className="text-base font-medium">{card.back}</p>
                        {card.example && (
                          <p className="mt-3 rounded-lg bg-muted/50 p-2 text-sm text-muted-foreground">
                            <span className="font-medium">Example: </span>
                            {card.example}
                          </p>
                        )}
                      </div>
                    </div>
                  </motion.div>
                    </motion.div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      This set has no cards.
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground sm:hidden">
                    Swipe to move • tap to flip
                  </p>

              {/* Study rating */}
              <div className="flex flex-wrap justify-center gap-2">
                {RATINGS.map((r) => (
                  <Button
                    key={r.value}
                    variant="outline"
                    size="sm"
                    disabled={!card || recordStudy.isPending}
                    onClick={() => rate(r.value)}
                    className={cn("h-8 text-xs", r.cls)}
                  >
                    {r.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Nav + analytics + flow actions */}
            <div className="border-t border-border/50 px-5 py-3">
              <div className="mb-3 flex items-center justify-between">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={index === 0}
                  onClick={() => go(-1)}
                  className="gap-1"
                >
                  <ChevronLeft className="h-4 w-4" /> Prev
                </Button>
                {analytics && (
                  <div className="flex gap-3 text-[11px] text-muted-foreground">
                    <span>Studied {analytics.studied}/{analytics.total}</span>
                    <span className="text-emerald-600 dark:text-emerald-400">
                      Mastered {analytics.mastered}
                    </span>
                    <span className="text-red-600 dark:text-red-400">
                      Revise {analytics.needs_revision}
                    </span>
                  </div>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={index >= total - 1}
                  onClick={() => go(1)}
                  className="gap-1"
                >
                  Next <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => resume("quiz")}
                  disabled={createSession.isPending}
                  className="flex-1 gap-1.5 bg-brand-gradient text-white"
                >
                  <ListChecks className="h-4 w-4" /> Create Quiz
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => resume("continue")}
                  disabled={createSession.isPending}
                  className="flex-1 gap-1.5"
                >
                  <Sparkles className="h-4 w-4" /> Continue Learning
                </Button>
              </div>
            </div>
              </>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
