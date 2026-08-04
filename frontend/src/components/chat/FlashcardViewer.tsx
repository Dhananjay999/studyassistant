import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  AnimatePresence,
  motion,
  useIsPresent,
  type PanInfo,
} from "framer-motion";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Clock,
  Layers,
  ListChecks,
  Loader2,
  RotateCcw,
  Shuffle,
  Sparkles,
  Trophy,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BookmarkButton } from "@/components/BookmarkButton";
import { MathText } from "@/components/common/MathText";
import { FlashcardAnalytics } from "@/components/flashcard/FlashcardAnalytics";
import { ConfidencePrompt } from "@/components/revision/ConfidencePrompt";
import {
  useCreateSession,
  useFlashcardSet,
  useRecordStudyBatch,
} from "@/hooks/api";
import { useIsMobile } from "@/hooks/use-mobile";
import { useBackClose } from "@/hooks/useBackClose";
import { formatDuration } from "@/lib/quizFormat";
import { cn } from "@/lib/utils";
import type {
  ChatSeed,
  Flashcard,
  FlashcardAnalytics as Analytics,
  StudyRating,
} from "@/types";

const RATINGS: Array<{ value: StudyRating; label: string; cls: string }> = [
  {
    value: "easy",
    label: "Easy",
    cls: "border-emerald-500/40 text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400",
  },
  {
    value: "medium",
    label: "Good",
    cls: "border-amber-500/40 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400",
  },
  {
    value: "hard",
    label: "Hard",
    cls: "border-orange-500/40 text-orange-600 hover:bg-orange-500/10 dark:text-orange-400",
  },
  {
    value: "needs_revision",
    label: "Again",
    cls: "border-red-500/40 text-red-600 hover:bg-red-500/10 dark:text-red-400",
  },
];

// Swipe commit tuned like SwipeableRow: a decisive drag OR a fast flick.
const SWIPE_DISTANCE = 90;
const SWIPE_VELOCITY = 500;

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
  const isMobile = useIsMobile();
  const { data, isLoading } = useFlashcardSet(open ? setId : null);
  const recordStudyBatch = useRecordStudyBatch();
  // Ratings are buffered on the client during a session and persisted in ONE
  // batch on completion (or when the viewer closes) — no API call per flip or
  // navigation. `flushStudy` is reassigned each render so it always closes over
  // the latest setId/mutation, while `finish` can stay referentially stable.
  const ratingsRef = useRef<Map<string, StudyRating>>(new Map());
  const flushStudy = useRef<() => void>(() => {});
  const createSession = useCreateSession();

  // Back gesture/button closes the flashcard viewer instead of leaving the page.
  useBackClose(open, () => onOpenChange(false));

  const [index, setIndex] = useState(0);
  // Direction the deck is moving (1 = forward, -1 = back) for slide transitions.
  const [dir, setDir] = useState(1);
  const [shuffleSeed, setShuffleSeed] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  // Study time, measured client-side (no server field): started on open, frozen
  // into `elapsed` when the deck is finished.
  const startedAtRef = useRef<number>(0);
  const [elapsed, setElapsed] = useState(0);

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
  const progress = total > 0 ? ((index + 1) / total) * 100 : 0;

  // Reset when a different set opens; seed analytics from the server. Each card
  // owns its own flip state and remounts on navigation, so there's nothing to
  // reset here — a fresh card always starts on its question side.
  useEffect(() => {
    setIndex(0);
    setDir(1);
    setShuffleSeed(0);
    setCompleted(false);
    setElapsed(0);
    ratingsRef.current = new Map();
    startedAtRef.current = Date.now();
  }, [setId, open]);
  useEffect(() => {
    if (data?.analytics) setAnalytics(data.analytics);
  }, [data?.analytics]);

  // Persist all buffered ratings in one request. Reassigned every render so it
  // always uses the current setId/mutation; callers invoke `flushStudy.current`.
  flushStudy.current = () => {
    const buffered = ratingsRef.current;
    if (!setId || buffered.size === 0) return;
    const ratings = [...buffered.entries()].map(([flashcard_id, rating]) => ({
      flashcard_id,
      rating,
    }));
    ratingsRef.current = new Map();
    recordStudyBatch.mutate(
      { setId, ratings },
      { onSuccess: (next) => setAnalytics(next) },
    );
  };
  // Save any un-flushed ratings if the viewer closes mid-session.
  useEffect(() => () => flushStudy.current(), []);

  const finish = useCallback(() => {
    setElapsed((Date.now() - startedAtRef.current) / 1000);
    setCompleted(true);
    flushStudy.current();
  }, []);

  const reviewAgain = () => {
    setIndex(0);
    setDir(1);
    setShuffleSeed(0);
    setCompleted(false);
    setElapsed(0);
    ratingsRef.current = new Map();
    startedAtRef.current = Date.now();
  };

  const go = useCallback(
    (delta: number) => {
      if (delta > 0 && index >= total - 1) {
        finish();
        return;
      }
      setDir(delta >= 0 ? 1 : -1);
      setIndex((i) => Math.min(total - 1, Math.max(0, i + delta)));
    },
    [index, total, finish],
  );

  const rate = (rating: StudyRating) => {
    if (!card) return;
    // Buffer client-side and advance immediately — the whole session is saved
    // in one batch on completion (see flushStudy), so navigation stays instant.
    ratingsRef.current.set(card.id, rating);
    if (index < total - 1) go(1);
    else finish();
  };

  // Keyboard navigation. Space/Enter (flip) is owned by the on-screen card.
  useEffect(() => {
    if (!open || completed) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, completed, go]);

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

  const bookmarkItem = data && {
    item_type: "flashcard" as const,
    item_ref: data.set_id,
    title: data.title,
    content: data.topic || data.title,
    metadata: { set_id: data.set_id, topic: data.topic },
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex flex-col gap-0 overflow-hidden bg-gradient-to-b from-background to-muted/30 p-0",
          isMobile
            ? "h-dvh w-screen max-w-none rounded-none border-0"
            : "h-[86vh] w-[min(760px,95vw)] max-w-none rounded-3xl",
        )}
      >
        <DialogTitle className="sr-only">
          {data?.title ?? "Flashcards"}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Study the flashcard set: flip cards, rate your recall, and track
          progress.
        </DialogDescription>
        {isLoading || !data ? (
          <div className="grid flex-1 place-items-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="border-b border-border/40 px-5 pb-4 pt-[calc(env(safe-area-inset-top)+1rem)] sm:pt-4">
              {/* Only the title row clears the top-right ✕; the progress bar
                  below keeps the symmetric px-5 so it spans the full width. */}
              <div className="flex items-center gap-2 pr-10">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-brand-gradient text-white shadow-glow">
                  <Layers className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate font-display text-base font-bold leading-tight">
                    {data.title}
                  </h2>
                  {data.topic && (
                    <p className="truncate text-xs text-muted-foreground">
                      {data.topic}
                    </p>
                  )}
                </div>
                {!completed && total > 0 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() =>
                      setShuffleSeed((s) =>
                        s ? 0 : Date.parse(data.created_at) || 7,
                      )
                    }
                    aria-label="Shuffle"
                    title="Shuffle"
                  >
                    <Shuffle
                      className={cn("h-4 w-4", shuffleSeed && "text-brand-1")}
                    />
                  </Button>
                )}
                {bookmarkItem && <BookmarkButton item={bookmarkItem} />}
              </div>
              {!completed && total > 0 && (
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs font-medium">
                    <span className="tabular-nums text-muted-foreground">
                      Card{" "}
                      <span className="text-foreground">{index + 1}</span> of{" "}
                      {total}
                    </span>
                    <span className="tabular-nums text-brand-1">
                      {Math.round(progress)}%
                    </span>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <motion.div
                      className="h-full rounded-full bg-brand-gradient"
                      animate={{ width: `${progress}%` }}
                      transition={{ type: "spring", stiffness: 260, damping: 32 }}
                    />
                  </div>
                </div>
              )}
            </div>

            {completed ? (
              /* ---------- Completion screen ---------- */
              <div className="flex-1 overflow-y-auto px-5 pt-8 pb-[calc(env(safe-area-inset-bottom)+2rem)]">
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mx-auto flex max-w-sm flex-col items-center gap-5 text-center"
                >
                  <motion.div
                    initial={{ scale: 0.6, rotate: -12 }}
                    animate={{ scale: 1, rotate: 0 }}
                    transition={{ type: "spring", stiffness: 240, damping: 14 }}
                    className="grid h-20 w-20 place-items-center rounded-3xl bg-brand-gradient text-white shadow-glow"
                  >
                    <Trophy className="h-10 w-10" />
                  </motion.div>
                  <div>
                    <h3 className="font-display text-2xl font-extrabold">
                      🎉 Great job!
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      You completed{" "}
                      <span className="font-medium text-foreground">
                        {data.title}
                      </span>
                      .
                    </p>
                  </div>

                  {/* Session stats */}
                  <div className="grid w-full grid-cols-3 gap-2.5">
                    <StatTile
                      icon={Layers}
                      label="Reviewed"
                      value={String(total)}
                    />
                    <StatTile
                      icon={Clock}
                      label="Time"
                      value={formatDuration(elapsed)}
                    />
                    <StatTile
                      icon={Sparkles}
                      label="Complete"
                      value={`${analytics?.completion ?? 100}%`}
                    />
                  </div>

                  {analytics && (
                    <FlashcardAnalytics
                      analytics={analytics}
                      className="w-full"
                    />
                  )}

                  {/* Confidence check-in feeds the revision schedule; the
                     study batch is already flushed by finish() before this
                     screen renders. */}
                  <ConfidencePrompt
                    topic={data.topic || data.title}
                    source="flashcards"
                    refId={data.set_id}
                    className="w-full"
                  />

                  {/* Actions */}
                  <div className="flex w-full flex-col gap-2">
                    <Button onClick={reviewAgain} variant="brand" className="gap-2">
                      <RotateCcw className="h-4 w-4" /> Review Again
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => resume("quiz")}
                      disabled={createSession.isPending}
                      className="gap-2"
                    >
                      <ListChecks className="h-4 w-4" /> Generate Quiz
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => onOpenChange(false)}
                      className="gap-2 text-muted-foreground"
                    >
                      <ArrowLeft className="h-4 w-4" /> Back to Chat
                    </Button>
                  </div>
                </motion.div>
              </div>
            ) : (
              /* ---------- Study view ---------- */
              <>
                <div className="flex flex-1 flex-col items-center justify-center gap-5 px-5 py-6">
                  {card ? (
                    <div className="relative w-full max-w-md [perspective:1600px]">
                      <AnimatePresence mode="popLayout" custom={dir}>
                        {/* Keyed by card id so every navigation remounts a fresh
                           card that starts on its question side — flip state can
                           never carry over from the previous card. */}
                        <StudyCard
                          key={card.id}
                          card={card}
                          dir={dir}
                          onSwipe={go}
                        />
                      </AnimatePresence>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      This set has no cards.
                    </p>
                  )}

                  {/* Self-rating */}
                  <div className="flex flex-wrap justify-center gap-2">
                    {RATINGS.map((r) => (
                      <Button
                        key={r.value}
                        variant="outline"
                        size="sm"
                        disabled={!card}
                        onClick={() => rate(r.value)}
                        className={cn("h-9 rounded-full px-4 text-xs", r.cls)}
                      >
                        {r.label}
                      </Button>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground sm:hidden">
                    Swipe to move • tap to flip
                  </p>
                </div>

                {/* Footer nav + flow actions */}
                <div className="border-t border-border/40 px-5 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <Button
                      variant="outline"
                      size="icon"
                      disabled={index === 0}
                      onClick={() => go(-1)}
                      aria-label="Previous card"
                      className="h-9 w-9 shrink-0 rounded-full"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    {analytics && (
                      <div className="flex gap-3 text-[11px] text-muted-foreground">
                        <span>
                          Studied {analytics.studied}/{analytics.total}
                        </span>
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
                      size="icon"
                      onClick={() => go(1)}
                      aria-label={
                        index >= total - 1 ? "Finish deck" : "Next card"
                      }
                      className="h-9 w-9 shrink-0 rounded-full"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => resume("quiz")}
                      disabled={createSession.isPending}
                      variant="brand"
                      className="flex-1 gap-1.5"
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
      </DialogContent>
    </Dialog>
  );
}

/**
 * A single flashcard: slides in/out with the deck and owns its own flip state.
 * Because each card is a distinct, id-keyed instance it always mounts on the
 * question side, and its flip can never leak into the next or previous card.
 *
 * The forwarded ref lands on the root motion element so AnimatePresence's
 * `popLayout` can measure the outgoing card and pop it out of layout flow —
 * without it the exiting and entering cards briefly stack in normal flow, which
 * jolts the surrounding layout (the footer flicker) during a swipe.
 */
const StudyCard = forwardRef<
  HTMLDivElement,
  { card: Flashcard; dir: number; onSwipe: (delta: number) => void }
>(function StudyCard({ card, dir, onSwipe }, ref) {
  const [flipped, setFlipped] = useState(false);
  // Only the card actually on screen (the present one) reacts to Space/Enter,
  // so a keypress mid-swipe doesn't flip the card that's leaving.
  const isPresent = useIsPresent();

  useEffect(() => {
    if (!isPresent) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setFlipped((f) => !f);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isPresent]);

  const onDragEnd = (_e: unknown, info: PanInfo) => {
    const forward =
      info.offset.x < -SWIPE_DISTANCE || info.velocity.x < -SWIPE_VELOCITY;
    const back =
      info.offset.x > SWIPE_DISTANCE || info.velocity.x > SWIPE_VELOCITY;
    if (forward) onSwipe(1);
    else if (back) onSwipe(-1);
  };

  return (
    <motion.div
      ref={ref}
      custom={dir}
      initial={{ opacity: 0, x: dir * 60, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: dir * -60, scale: 0.96 }}
      transition={{ type: "spring", stiffness: 320, damping: 34 }}
      drag="x"
      dragSnapToOrigin
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.4}
      onDragEnd={onDragEnd}
      onTap={() => setFlipped((f) => !f)}
      role="button"
      tabIndex={0}
      aria-label="Flip card; swipe left or right to navigate"
      className="cursor-grab touch-pan-y active:cursor-grabbing"
    >
      <motion.div
        className="pointer-events-none relative h-80 w-full [transform-style:preserve-3d]"
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 26 }}
      >
        {/* Front (question) */}
        <div className="absolute inset-0 flex flex-col rounded-3xl border border-border/60 bg-card p-7 shadow-lg [backface-visibility:hidden]">
          <Badge
            variant="secondary"
            className="self-start text-[10px] font-semibold uppercase tracking-wider"
          >
            Question
          </Badge>
          <div className="learning-content flex flex-1 items-center justify-center">
            <p className="text-balance text-center text-xl font-semibold leading-snug">
              <MathText>{card.front}</MathText>
            </p>
          </div>
          <p className="text-center text-xs text-muted-foreground">
            Tap to reveal answer
          </p>
        </div>
        {/* Back (answer) */}
        <div className="absolute inset-0 flex flex-col overflow-auto rounded-3xl border border-brand-1/40 bg-gradient-to-br from-brand-1/[0.06] to-brand-2/[0.1] p-7 shadow-glow [backface-visibility:hidden] [transform:rotateY(180deg)]">
          <Badge className="self-start bg-brand-gradient text-[10px] font-semibold uppercase tracking-wider text-white">
            Answer
          </Badge>
          <div className="learning-content flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <p className="text-balance text-lg font-medium leading-snug">
              <MathText>{card.back}</MathText>
            </p>
            {card.example && (
              <p className="rounded-xl bg-background/60 p-3 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Example: </span>
                <MathText>{card.example}</MathText>
              </p>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
});

function StatTile({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Layers;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-3 text-center">
      <Icon className="mx-auto h-4 w-4 text-brand-1" />
      <p className="mt-1.5 font-display text-lg font-bold tabular-nums leading-none">
        {value}
      </p>
      <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
    </div>
  );
}
