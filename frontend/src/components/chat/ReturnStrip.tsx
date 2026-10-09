// "Waiting for you" strip at the top of the chat (return hook).
//
// Shows what the backend already knows is waiting for a returning student:
// today's exam-plan day, revision topics that are due, a quiz that was never
// attempted, a flashcard set that was never studied. One tap opens the thing.
// Data comes from GET /notifications/pending; the strip renders nothing
// while that is loading, empty, failed, or switched off on the backend, so
// the chat is unchanged for everyone else.
//
// Phone first: full width, at most two chips (short labels) so it stays one
// row at 360px and wraps to two full-width rows at 320px; every target is
// 44px high and nothing depends on hover. It can be dismissed for the rest
// of the local day.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  CalendarCheck,
  GraduationCap,
  Layers,
  Repeat2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getPendingNotifications, type PendingNotification } from "@/lib/api";
import { analytics, AnalyticsEvent } from "@/lib/analytics";

/** New key: `<user id>:<local YYYY-MM-DD>` of the last dismissal. */
const DISMISSED_KEY = "aeva_return_strip_dismissed";
/** The strip stays compact: the two most important items; opening one
 * brings up the next. */
const MAX_CHIPS = 2;

const ENTER = { duration: 0.2, ease: [0.22, 1, 0.36, 1] as const };
const EXIT = { duration: 0.15, ease: [0.4, 0, 1, 1] as const };

type Kind = PendingNotification["kind"];

function localDay(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function readDismissed(userId: string): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === `${userId}:${localDay()}`;
  } catch {
    return false;
  }
}

function writeDismissed(userId: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, `${userId}:${localDay()}`);
  } catch {
    // Private mode / storage full: the strip is hidden for this mount only.
  }
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** Icon, phone label, wider-screen label and accessible name for an item. */
function describe(item: PendingNotification): {
  Icon: LucideIcon;
  short: string;
  long: string;
} {
  switch (item.kind) {
    case "plan":
      return {
        Icon: CalendarCheck,
        short: item.day_number ? `Plan · day ${item.day_number}` : "Today's plan",
        long: item.day_number
          ? `Today's plan: day ${item.day_number}, ${plural(item.count, "topic", "topics")} to go`
          : `Today's plan: ${plural(item.count, "topic", "topics")} to go`,
      };
    case "revision":
      return {
        Icon: Repeat2,
        short: `${item.count} to revise`,
        long: `${plural(item.count, "topic", "topics")} due for revision`,
      };
    case "quiz":
      return {
        Icon: GraduationCap,
        short: item.count === 1 ? "Quiz waiting" : `${item.count} quizzes`,
        long:
          item.count === 1
            ? "A quiz is waiting"
            : `${item.count} quizzes are waiting`,
      };
    case "flashcards":
      return {
        Icon: Layers,
        short: item.count === 1 ? "Flashcards" : `${item.count} card sets`,
        long:
          item.count === 1
            ? "A flashcard set is waiting"
            : `${item.count} flashcard sets are waiting`,
      };
  }
}

export function ReturnStrip({
  onOpenQuiz,
  onOpenFlashcards,
}: {
  /** Open a quiz in place (the chat's quiz drawer). Falls back to the
   * Quizzes page deep link. */
  onOpenQuiz?: (quizId: string) => void;
  /** Open a flashcard set in place. Falls back to the Flashcards page. */
  onOpenFlashcards?: (setId: string) => void;
}) {
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const { user } = useAuth();
  const userId = user?.id ?? "";

  const { data } = useQuery({
    queryKey: ["notifications", "pending"] as const,
    queryFn: getPendingNotifications,
    enabled: !!userId,
    // Fetched when the chat opens, not while the student is reading: no
    // refetch on focus (app default) and a long stale window.
    staleTime: 10 * 60_000,
    retry: false,
  });

  // Read synchronously so a dismissed strip never flashes on mount; the
  // effect only matters when the signed-in user changes.
  const [dismissed, setDismissed] = useState(
    () => !!userId && readDismissed(userId),
  );
  useEffect(() => {
    setDismissed(!!userId && readDismissed(userId));
  }, [userId]);
  // Kinds opened from this strip: hidden at once, the server count catches
  // up on the next fetch.
  const [opened, setOpened] = useState<ReadonlySet<Kind>>(new Set());

  const pending = useMemo(
    () => (data?.items ?? []).filter((i) => i.count > 0 && !opened.has(i.kind)),
    [data, opened],
  );
  const chips = pending.slice(0, MAX_CHIPS);
  const visible = !!userId && !dismissed && chips.length > 0;

  // One impression per mount, with everything that is waiting.
  const all = data?.items;
  const shownRef = useRef(false);
  useEffect(() => {
    if (!visible || shownRef.current || !all) return;
    shownRef.current = true;
    const has = (k: Kind) => all.some((i) => i.kind === k && i.count > 0);
    analytics.track(AnalyticsEvent.NOTIFICATION_STRIP_SHOWN, {
      kind_count: all.filter((i) => i.count > 0).length,
      has_plan: has("plan"),
      has_revision: has("revision"),
      has_quiz: has("quiz"),
      has_flashcards: has("flashcards"),
      revision_due_count: all.find((i) => i.kind === "revision")?.count ?? 0,
    });
  }, [visible, all]);

  const open = (item: PendingNotification) => {
    analytics.track(AnalyticsEvent.NOTIFICATION_CLICKED, {
      kind: item.kind,
      source: "strip",
    });
    setOpened((prev) => new Set(prev).add(item.kind));
    switch (item.kind) {
      case "plan":
        navigate(item.day_id ? `/exam/day/${item.day_id}` : "/exam");
        return;
      case "revision":
        navigate("/revision");
        return;
      case "quiz":
        if (item.quiz_id && onOpenQuiz) onOpenQuiz(item.quiz_id);
        else
          navigate(item.quiz_id ? `/quizzes?quizId=${item.quiz_id}` : "/quizzes");
        return;
      case "flashcards":
        if (item.set_id && onOpenFlashcards) onOpenFlashcards(item.set_id);
        else
          navigate(
            item.set_id ? `/flashcards?setId=${item.set_id}` : "/flashcards",
          );
    }
  };

  const dismiss = () => {
    analytics.track(AnalyticsEvent.NOTIFICATION_STRIP_DISMISSED, {
      kind_count: pending.length,
    });
    if (userId) writeDismissed(userId);
    setDismissed(true);
  };

  const hidden = reduce ? { opacity: 0 } : { opacity: 0, y: -8 };

  return (
    // `initial={false}`: a strip that is already there when the chat mounts
    // (cached data) does not replay its entrance.
    <AnimatePresence initial={false}>
      {visible && (
        <motion.div
          key="return-strip"
          initial={hidden}
          animate={{ opacity: 1, y: 0, transition: ENTER }}
          exit={{ ...hidden, transition: EXIT }}
          className="mx-auto w-full max-w-4xl shrink-0 px-4 pt-2"
        >
          <div
            role="region"
            aria-label="Waiting for you"
            className="glass flex items-start gap-1 rounded-xl border-brand-1/30 bg-brand-1/5 p-1"
          >
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              <span className="hidden pl-2 text-xs font-medium text-muted-foreground sm:inline">
                Waiting for you
              </span>
              {chips.map((item) => {
                const { Icon, short, long } = describe(item);
                return (
                  <button
                    key={item.kind}
                    type="button"
                    aria-label={long}
                    data-analytics-id={`return_strip.${item.kind}`}
                    data-analytics-location="return_strip"
                    onClick={() => open(item)}
                    className="flex min-h-11 min-w-0 flex-auto items-center gap-1.5 rounded-lg border border-brand-1/20 bg-background/60 px-2.5 text-left text-xs font-medium text-foreground transition-colors hover:bg-brand-1/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-1/50 active:bg-brand-1/15 sm:flex-none"
                  >
                    <Icon className="h-4 w-4 shrink-0 text-brand-1" />
                    <span className="truncate sm:hidden">{short}</span>
                    <span className="hidden truncate sm:inline">{long}</span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              aria-label="Dismiss for today"
              data-analytics-id="return_strip.dismiss"
              data-analytics-location="return_strip"
              onClick={dismiss}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-1/50"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
