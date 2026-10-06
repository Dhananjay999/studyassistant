// Overflow actions for one topic: Open lesson, Quiz, Flashcards and the three
// status choices. A bottom sheet on phones, a dialog on desktop.

import {
  GraduationCap,
  Layers,
  ListChecks,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ResponsiveModal,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "@/components/ui/responsive-modal";
import {
  STATUS_LABEL,
  STATUS_ORDER,
  STATUS_TONE,
  formatMinutes,
} from "@/components/exam/examFormat";
import type { TopicActions } from "@/components/exam/useTopicActions";
import { useBackClose } from "@/hooks/useBackClose";
import { cn } from "@/lib/utils";
import type { ExamTopic } from "@/types";

export function TopicActionSheet({
  open,
  onOpenChange,
  topic,
  actions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  topic: ExamTopic;
  actions: TopicActions;
}) {
  useBackClose(open, () => onOpenChange(false));
  const close = () => onOpenChange(false);

  const rows: {
    key: string;
    label: string;
    hint: string;
    icon: LucideIcon;
    busy?: boolean;
    onClick: () => void;
  }[] = [
    {
      key: "open",
      label: "Open lesson",
      hint: topic.has_lesson
        ? "Aeva's lesson, practice and your doubts"
        : "Aeva teaches this topic step by step",
      icon: GraduationCap,
      onClick: () => {
        close();
        actions.open();
      },
    },
    {
      key: "quiz",
      label: topic.quiz_id ? "Take quiz" : "Create a quiz",
      hint: topic.quiz_id
        ? "Practice with your saved quiz"
        : "Exam-style questions on this topic",
      icon: ListChecks,
      busy: actions.quizBusy,
      onClick: () => {
        close();
        void actions.quiz("sheet");
      },
    },
    {
      key: "flashcards",
      label: topic.flashcard_set_id ? "Study flashcards" : "Create flashcards",
      hint: topic.flashcard_set_id
        ? "Review your saved deck"
        : "Key facts and definitions to memorise",
      icon: Layers,
      busy: actions.flashcardsBusy,
      onClick: () => {
        close();
        void actions.flashcards("sheet");
      },
    },
  ];

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      analyticsName="Exam topic actions"
    >
      <ResponsiveModalContent className="sm:max-w-md">
        <ResponsiveModalHeader data-analytics-private>
          {/* The accessible title is static: click analytics name the popup
              after it, so the topic (user content) stays out of events. */}
          <ResponsiveModalTitle className="sr-only">Topic actions</ResponsiveModalTitle>
          <p className="font-display text-lg font-semibold leading-snug tracking-tight [overflow-wrap:anywhere]">
            {topic.title}
          </p>
          <ResponsiveModalDescription>
            {topic.subject}
            {topic.est_minutes ? ` · ${formatMinutes(topic.est_minutes)}` : ""}
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>

        <div className="flex flex-col gap-1.5">
          {rows.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={r.onClick}
              disabled={r.busy}
              data-analytics-name={`Exam topic ${r.key}`}
              className="flex min-h-[52px] w-full items-center gap-3 rounded-xl border border-border/50 bg-card/40 px-3 py-2 text-left transition-colors hover:bg-accent/60 active:scale-[0.99] disabled:opacity-60"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-1/10 text-brand-1">
                {r.busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <r.icon className="h-4 w-4" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{r.label}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {r.hint}
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="pt-1">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Mark as
          </p>
          <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-3">
            {STATUS_ORDER.map((s) => {
              const active = actions.status === s;
              const tone = STATUS_TONE[s];
              return (
                <Button
                  key={s}
                  type="button"
                  variant="outline"
                  data-analytics-name={`Exam topic mark ${s}`}
                  aria-pressed={active}
                  onClick={() => {
                    actions.setStatus(s, "sheet");
                    close();
                  }}
                  className={cn(
                    "h-11 px-2 text-xs font-medium",
                    active && cn(tone.bg, tone.text, tone.ring, "border"),
                  )}
                >
                  <span className={cn("mr-1.5 h-2 w-2 rounded-full", tone.dot)} />
                  <span className="truncate">{STATUS_LABEL[s]}</span>
                </Button>
              );
            })}
          </div>
        </div>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}
