// The sticky study bar of the topic page: status + timer (play/pause, mm:ss,
// planned target, overflow with reset / status changes) and the three actions
// (Quiz, Cards, Done). One row that fits 320px: below `sm` the actions are
// 44px icon buttons with a tiny label underneath and the "/ 45m" target is
// hidden under 360px; from `sm` up the labels sit next to the icons.

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Check,
  Circle,
  Layers,
  ListChecks,
  Loader2,
  MoreHorizontal,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { STATUS_LABEL, STATUS_TONE } from "@/components/exam/examFormat";
import type { StudyTimer } from "@/components/exam/useStudyTimer";
import type { TopicActions } from "@/components/exam/useTopicActions";
import { analytics, AnalyticsEvent } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import type { ExamTopic, ExamTopicStatus } from "@/types";

/** Shorter status words for the 320px row (the full label from 360px). */
const SHORT_STATUS: Record<ExamTopicStatus, string> = {
  not_started: "To start",
  in_progress: "Ongoing",
  completed: "Done",
};

export function StudyBar({
  topic,
  actions,
  timer,
  onDone,
  className,
}: {
  topic: ExamTopic;
  actions: TopicActions;
  timer: StudyTimer;
  /** Mark completed (the page stops the timer and opens the next-up sheet). */
  onDone: () => void;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const status = actions.status;
  const tone = STATUS_TONE[status];
  const done = status === "completed";

  const track = (action: "start" | "pause" | "resume" | "reset") =>
    analytics.track(AnalyticsEvent.EXAM_PREP_TIMER_TOGGLED, {
      plan_id: topic.plan_id,
      topic_id: topic.id,
      action,
      elapsed_s: timer.elapsedSeconds,
    });

  const toggleTimer = () => {
    if (timer.running) {
      track("pause");
      timer.pause();
    } else {
      track(timer.elapsedSeconds > 0 ? "resume" : "start");
      timer.resume();
    }
  };

  const resetTimer = () => {
    track("reset");
    timer.reset();
  };

  return (
    <div
      className={cn(
        "sticky top-0 z-20 -mx-4 border-b border-border/50 bg-background/85 px-4 py-2 backdrop-blur",
        className,
      )}
      data-analytics-section="exam_study_bar"
    >
      <div className="flex items-center gap-1 sm:gap-2">
        {/* Timer group: play/pause · readout + status · overflow */}
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <button
            type="button"
            onClick={toggleTimer}
            aria-label={timer.running ? "Pause timer" : "Start timer"}
            aria-pressed={timer.running}
            data-analytics-name={timer.running ? "Exam study pause" : "Exam study play"}
            className={cn(
              "grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 transition-colors active:scale-95",
              tone.ring,
              tone.bg,
              tone.text,
            )}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={timer.running ? "pause" : "play"}
                initial={reduce ? false : { scale: 0.6, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={reduce ? undefined : { scale: 0.6, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="grid place-items-center"
              >
                {timer.running ? (
                  <Pause className="h-4 w-4 fill-current" />
                ) : (
                  <Play className="ml-0.5 h-4 w-4 fill-current" />
                )}
              </motion.span>
            </AnimatePresence>
          </button>

          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-sm font-bold tabular-nums">
              <span aria-label={`Studied ${timer.formatted}`}>{timer.formatted}</span>
              {topic.est_minutes > 0 && (
                <span className="hidden font-medium text-muted-foreground min-[360px]:inline">
                  {" "}
                  / {topic.est_minutes}m
                </span>
              )}
            </p>
            <p className={cn("flex items-center gap-1 truncate text-[11px] font-medium", tone.text)}>
              <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", tone.dot)} />
              {actions.statusBusy ? (
                <span className="truncate">Saving…</span>
              ) : (
                <>
                  <span className="truncate min-[360px]:hidden">
                    {SHORT_STATUS[status]}
                  </span>
                  <span className="hidden truncate min-[360px]:inline">
                    {STATUS_LABEL[status]}
                  </span>
                </>
              )}
            </p>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Timer and status options"
                data-analytics-name="Exam study more"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent active:scale-95"
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[13rem]">
              <DropdownMenuItem
                onSelect={resetTimer}
                data-analytics-name="Exam study reset timer"
                className="min-h-[44px] gap-2"
              >
                <RotateCcw className="h-4 w-4" /> Reset timer
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={status === "in_progress" || actions.statusBusy}
                onSelect={() => actions.setStatus("in_progress", "topic")}
                data-analytics-name="Exam topic mark in progress"
                className="min-h-[44px] gap-2"
              >
                <Play className="h-4 w-4" /> Mark in progress
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={status === "not_started" || actions.statusBusy}
                onSelect={() => actions.setStatus("not_started", "topic")}
                data-analytics-name="Exam topic mark not started"
                className="min-h-[44px] gap-2"
              >
                <Circle className="h-4 w-4" /> Mark not started
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Actions */}
        <StudyAction
          icon={
            actions.quizBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ListChecks className="h-4 w-4" />
            )
          }
          short="Quiz"
          long={topic.quiz_id ? "Take quiz" : "Quiz"}
          disabled={actions.quizBusy}
          onClick={() => void actions.quiz("topic")}
          analyticsName="Exam topic quiz"
        />
        <StudyAction
          icon={
            actions.flashcardsBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Layers className="h-4 w-4" />
            )
          }
          short="Cards"
          long="Flashcards"
          disabled={actions.flashcardsBusy}
          onClick={() => void actions.flashcards("topic")}
          analyticsName="Exam topic flashcards"
        />
        <StudyAction
          icon={<Check className="h-4 w-4" />}
          short="Done"
          long={done ? "Completed" : "Mark done"}
          disabled={done || actions.statusBusy}
          onClick={onDone}
          analyticsName="Exam topic mark completed"
          primary
          pressed={done}
        />
      </div>
    </div>
  );
}

function StudyAction({
  icon,
  short,
  long,
  disabled,
  onClick,
  analyticsName,
  primary,
  pressed,
}: {
  icon: React.ReactNode;
  short: string;
  long: string;
  disabled?: boolean;
  onClick: () => void;
  analyticsName: string;
  primary?: boolean;
  pressed?: boolean;
}) {
  return (
    <Button
      type="button"
      variant={primary ? "brand" : "outline"}
      disabled={disabled}
      onClick={onClick}
      aria-label={long}
      aria-pressed={pressed}
      data-analytics-name={analyticsName}
      className={cn(
        // Phone: a 44px square with the icon over a tiny label; sm+: a row.
        "h-11 w-11 shrink-0 flex-col gap-0 px-0 text-[10px] font-semibold leading-none",
        "sm:h-11 sm:w-auto sm:flex-row sm:gap-1.5 sm:px-3 sm:text-sm sm:font-medium",
        pressed && "bg-emerald-500 hover:bg-emerald-500 disabled:opacity-100",
      )}
    >
      {icon}
      <span className="sm:hidden">{short}</span>
      <span className="hidden sm:inline">{long}</span>
    </Button>
  );
}
