// /exam/topic/:topicId — one topic of the plan, taught by Aeva. A sticky
// StudyBar (status, study timer, Quiz / Cards / Done) sits under the header;
// then the lesson (markdown, generated lazily and streamed on the first open),
// practice (quiz, flashcards, mark complete), and the doubt box: a chat scoped
// to this topic, with its composer pinned above the bottom nav. Marking the
// topic done opens the next-up sheet that leads to the next topic.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Layers,
  ListChecks,
  Loader2,
  MessageCircleQuestion,
  MoreHorizontal,
  RefreshCw,
  Sparkles,
  Trophy,
} from "lucide-react";
import { toast } from "sonner";
import { PageContainer } from "@/components/layout/PageContainer";
import { GlassCard } from "@/components/common/GlassCard";
import { RotatingStatus } from "@/components/common/RotatingStatus";
import { Seo } from "@/components/common/Seo";
import { useConfirm } from "@/components/common/ConfirmProvider";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { ChatMessages } from "@/components/chat/ChatMessages";
import { MarkdownContent } from "@/components/chat/MarkdownContent";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { NextUpSheet } from "@/components/exam/NextUpSheet";
import { StudyBar } from "@/components/exam/StudyBar";
import { formatMinutes, subjectTone } from "@/components/exam/examFormat";
import {
  ExamArtifactsProvider,
  useExamArtifacts,
} from "@/components/exam/useExamArtifacts";
import { useExamConversation } from "@/components/exam/useExamConversation";
import { useStudyTimer } from "@/components/exam/useStudyTimer";
import { useTopicActions } from "@/components/exam/useTopicActions";
import {
  patchExamTopic,
  qk,
  useExamDashboard,
  useExamTopicLesson,
} from "@/hooks/api";
import { useAssistantStream } from "@/hooks/useAssistantStream";
import { useFeature } from "@/hooks/useFeature";
import { analytics, AnalyticsEvent } from "@/lib/analytics";
import { examLessonStreamUrl } from "@/lib/api";
import { errorKind, friendlyErrorMessage } from "@/lib/errorMessage";
import { cn } from "@/lib/utils";
import {
  hasExamPlan,
  type ExamDashboard,
  type ExamLessonStreamRequest,
  type ExamTopic,
  type ExamTopicLesson,
} from "@/types";

const PREPARING = [
  "Aeva is preparing your lesson…",
  "Breaking the topic into clear steps…",
  "Adding worked examples and exam tips…",
];

const SUGGESTIONS = [
  "Explain the worked example again",
  "Give me 3 more practice questions",
  "Why does this matter for the exam?",
];

const SEO = <Seo title="Topic lesson — Aeva" noindex path="/exam" />;

export default function ExamTopicPage() {
  const { topicId } = useParams<{ topicId: string }>();
  const navigate = useNavigate();
  const enabled = useFeature("exam_prep", false);
  const dashboard = useExamDashboard(enabled);
  const plan = hasExamPlan(dashboard.data) ? dashboard.data : null;
  const lessonQ = useExamTopicLesson(enabled ? topicId : undefined);

  // The dashboard cache usually already has the topic: the header renders
  // instantly while the lesson loads. Its copy also carries status edits.
  const fromDashboard = useMemo(() => {
    if (!plan || !topicId) return null;
    for (const day of plan.days) {
      for (const subject of day.subjects) {
        const topic = subject.topics.find((t) => t.id === topicId);
        if (topic) return { topic, dayNumber: day.day_number };
      }
    }
    return null;
  }, [plan, topicId]);

  const lesson = lessonQ.data;
  const topic: ExamTopic | null = fromDashboard
    ? {
        ...fromDashboard.topic,
        has_lesson:
          lesson?.topic.has_lesson ?? fromDashboard.topic.has_lesson,
      }
    : (lesson?.topic ?? null);
  const dayNumber = fromDashboard?.dayNumber ?? lesson?.day?.day_number ?? null;

  if (dashboard.isLoading || !enabled || (!topic && lessonQ.isPending)) {
    return (
      <PageContainer title="Topic">
        {SEO}
        <div className="mx-auto max-w-3xl space-y-4 lg:p-4">
          <Skeleton className="h-10 w-40 rounded" />
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
        </div>
      </PageContainer>
    );
  }

  if (dashboard.isError) {
    return (
      <PageContainer title="Topic">
        {SEO}
        <div className="mx-auto max-w-3xl lg:p-4">
          <GlassCard className="grid place-items-center gap-3 p-10 text-center">
            <p className="text-sm text-muted-foreground">
              Couldn't load your exam plan.
            </p>
            <Button variant="outline" onClick={() => dashboard.refetch()}>
              Retry
            </Button>
          </GlassCard>
        </div>
      </PageContainer>
    );
  }

  if (!plan) return <Navigate to="/exam" replace />;

  if (!topic) {
    return (
      <PageContainer title="Topic">
        {SEO}
        <div className="mx-auto max-w-3xl lg:p-4">
          <GlassCard className="grid place-items-center gap-3 p-10 text-center">
            <p className="font-display font-bold">
              This topic isn't in your plan
            </p>
            <p className="text-sm text-muted-foreground">
              It may belong to an older plan.
            </p>
            <Button variant="brand" onClick={() => navigate("/exam")}>
              Back to Exam Prep
            </Button>
          </GlassCard>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer title="Topic">
      {SEO}
      <ExamArtifactsProvider>
        {/* Keyed so timer, sheet and stream state start fresh per topic
            (the next-up sheet navigates topic → topic). */}
        <TopicView
          key={topic.id}
          dashboard={plan}
          topic={topic}
          dayNumber={dayNumber}
          lesson={lesson ?? null}
          lessonPending={lessonQ.isPending}
          lessonError={lessonQ.isError}
          refetchLesson={() => void lessonQ.refetch()}
        />
      </ExamArtifactsProvider>
    </PageContainer>
  );
}

function TopicView({
  dashboard,
  topic,
  dayNumber,
  lesson,
  lessonPending,
  lessonError,
  refetchLesson,
}: {
  dashboard: ExamDashboard;
  topic: ExamTopic;
  dayNumber: number | null;
  lesson: ExamTopicLesson | null;
  lessonPending: boolean;
  lessonError: boolean;
  refetchLesson: () => void;
}) {
  const plan = dashboard.plan;
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const artifacts = useExamArtifacts();
  const actions = useTopicActions(topic, plan.exam_name, "topic");
  const convo = useExamConversation({
    planId: plan.id,
    topicId: topic.id,
    dayId: topic.day_id,
  });
  const tone = subjectTone(topic.subject);
  const done = actions.status === "completed";
  const best = topic.quiz_summary?.best_score;
  const threadEndRef = useRef<HTMLDivElement>(null);

  /* ------------------------------ study timer ---------------------------- */

  // Studying starts when the page opens; a completed topic never auto-starts.
  const timer = useStudyTimer(topic.id, { autoStart: !done });
  const [nextUpOpen, setNextUpOpen] = useState(false);
  const [studySeconds, setStudySeconds] = useState(0);

  const markDone = () => {
    if (done) return;
    const seconds = timer.stop();
    setStudySeconds(seconds);
    actions.setStatus("completed", "topic", { study_seconds: seconds });
    setNextUpOpen(true);
  };

  /* ------------------------------- lesson -------------------------------- */

  const { start, streaming } = useAssistantStream(
    examLessonStreamUrl(topic.id),
  );
  // Markdown streamed so far (null when not generating).
  const [draft, setDraft] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const startedFor = useRef<string | null>(null);

  const generate = useCallback(
    (regenerate: boolean) => {
      setGenError(null);
      setDraft("");
      const t0 = performance.now();
      const body: ExamLessonStreamRequest = { regenerate };
      void start(body, {
        onChunk: (delta) => setDraft((prev) => (prev ?? "") + delta),
        onComplete: (full, meta) => {
          const content = meta.content as
            | { lesson_md?: unknown; topic?: unknown }
            | undefined;
          const md =
            typeof content?.lesson_md === "string" && content.lesson_md
              ? content.lesson_md
              : full;
          analytics.track(AnalyticsEvent.EXAM_PREP_LESSON_GENERATED, {
            plan_id: plan.id,
            topic_id: topic.id,
            latency_ms: Math.round(performance.now() - t0),
            lesson_length: md.length,
          });
          // The done frame carries the saved topic (a fresh topic is now
          // in progress): patch it into the dashboard caches right away.
          const updated = content?.topic as ExamTopic | undefined;
          if (updated && typeof updated === "object" && updated.id === topic.id) {
            patchExamTopic(qc, updated);
          }
          // Seed the cache so the lesson stays on screen, then refresh it
          // and the plan (the topic row now shows "Open lesson").
          qc.setQueryData<ExamTopicLesson>(qk.examTopicLesson(topic.id), (cur) =>
            cur
              ? {
                  ...cur,
                  lesson_md: md,
                  lesson_generated_at: new Date().toISOString(),
                  topic: { ...cur.topic, has_lesson: true },
                }
              : cur,
          );
          void qc.invalidateQueries({ queryKey: qk.examTopicLesson(topic.id) });
          void qc.invalidateQueries({ queryKey: qk.examPrep });
          setDraft(null);
        },
        onClarification: () => setDraft(null),
        onQuizSetup: () => setDraft(null),
        onError: (msg) => {
          analytics.track(AnalyticsEvent.EXAM_PREP_LESSON_FAILED, {
            plan_id: plan.id,
            topic_id: topic.id,
            error_kind: errorKind(msg),
          });
          setGenError(friendlyErrorMessage(msg));
          setDraft(null);
        },
      });
    },
    [plan.id, qc, start, topic.id],
  );

  // No stored lesson yet: teach it on the first open (once per topic).
  useEffect(() => {
    if (lessonPending || lessonError || lesson?.lesson_md) return;
    if (startedFor.current === topic.id) return;
    startedFor.current = topic.id;
    generate(false);
  }, [lessonPending, lessonError, lesson?.lesson_md, topic.id, generate]);

  // Once per topic, after the lesson query settled (so `had_lesson` is right).
  const openedFor = useRef<string | null>(null);
  useEffect(() => {
    if (lessonPending || openedFor.current === topic.id) return;
    openedFor.current = topic.id;
    analytics.track(AnalyticsEvent.EXAM_PREP_TOPIC_OPENED, {
      plan_id: plan.id,
      topic_id: topic.id,
      had_lesson: !!lesson?.lesson_md || !!topic.has_lesson,
    });
  }, [lessonPending, lesson?.lesson_md, plan.id, topic.id, topic.has_lesson]);

  const regenerate = async () => {
    const ok = await confirm({
      title: "Teach this topic again?",
      description:
        "Aeva will write a fresh lesson and replace the current one. Your doubts and practice stay.",
      confirmText: "Regenerate",
    });
    if (ok) generate(true);
  };

  const shownMarkdown = draft !== null ? draft : (lesson?.lesson_md ?? null);
  const generating = draft !== null;

  /* -------------------------------- doubts ------------------------------- */

  const send = useCallback(
    (...args: Parameters<typeof convo.send>) => {
      convo.send(...args);
      // Bring the new turn into view: the thread sits below the lesson.
      requestAnimationFrame(() => {
        threadEndRef.current?.scrollIntoView({
          behavior: reduce ? "auto" : "smooth",
          block: "end",
        });
      });
    },
    [convo, reduce],
  );

  const goBack = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else navigate("/exam");
  };

  const showEmptyThread =
    convo.messages.length === 0 && !convo.streaming && !convo.historyLoading;

  return (
    <div className="mx-auto max-w-3xl space-y-5 lg:p-4 lg:pb-0">
      {/* Header: back arrow on the eyebrow line (subject · Day n); the title
          takes the full width below so it never wraps beside the button. */}
      <header data-analytics-private>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Back"
            onClick={goBack}
            data-analytics-name="Exam topic back"
            className="-ml-2 h-11 w-11 shrink-0"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className={cn("truncate font-semibold", tone.text)}>
              {topic.subject}
            </span>
            {dayNumber !== null && (
              <span className="shrink-0 rounded-full bg-muted/60 px-2 py-0.5 font-medium text-muted-foreground tabular-nums">
                Day {dayNumber}
              </span>
            )}
          </div>
        </div>
        <h2 className="mt-1 line-clamp-2 font-display text-xl font-extrabold leading-tight [overflow-wrap:anywhere]">
          {topic.title}
        </h2>
        {topic.description && (
          <p className="mt-1 text-sm text-muted-foreground [overflow-wrap:anywhere]">
            {topic.description}
          </p>
        )}
        {topic.est_minutes > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2.5 py-1 font-medium text-muted-foreground tabular-nums">
              <Clock className="h-3.5 w-3.5" /> {formatMinutes(topic.est_minutes)}{" "}
              planned
            </span>
          </div>
        )}
      </header>

      {/* Status · timer · Quiz / Cards / Done, stuck to the top while the
          lesson scrolls. `space-y-5` gives it its margin; the negative
          horizontal margin bleeds it to the page edges. */}
      <StudyBar topic={topic} actions={actions} timer={timer} onDone={markDone} />

      {/* Lesson */}
      <GlassCard strong className="overflow-hidden">
        <div className="flex items-center gap-2 px-4 pt-3">
          <p className="flex min-w-0 flex-1 items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-brand-1" />
            <span className="truncate">Aeva teaches</span>
          </p>
          {shownMarkdown !== null && !generating && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Lesson options"
                  data-analytics-name="Exam lesson options"
                  className="-mr-2 -mt-1 grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent active:scale-95"
                >
                  <MoreHorizontal className="h-5 w-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[12rem]">
                <DropdownMenuItem
                  // Let the menu finish closing before the confirm sheet opens.
                  onSelect={() => window.setTimeout(() => void regenerate(), 0)}
                  data-analytics-name="Exam lesson regenerate"
                  className="min-h-[44px] gap-2"
                >
                  <RefreshCw className="h-4 w-4" /> Regenerate lesson
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {generating && (
          <div className="px-4 pt-3">
            <p className="flex items-center gap-2 text-sm font-medium text-brand-1">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              <RotatingStatus messages={PREPARING} intervalMs={2600} />
            </p>
            <ProgressLine />
          </div>
        )}

        {genError ? (
          <LessonError
            message={genError}
            onRetry={() => generate(false)}
          />
        ) : lessonError && !generating ? (
          <LessonError
            message="Your topic is still here. Try again in a moment."
            onRetry={refetchLesson}
          />
        ) : shownMarkdown !== null && shownMarkdown.length > 0 ? (
          <motion.div
            initial={reduce || generating ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="learning-content prose prose-sm max-w-none px-4 pb-4 pt-3 dark:prose-invert prose-headings:font-display prose-p:my-2 prose-pre:my-2"
            data-analytics-private
          >
            <MarkdownContent content={shownMarkdown} />
          </motion.div>
        ) : generating || lessonPending ? (
          <div className="space-y-2 px-4 pb-4 pt-3">
            <Skeleton className="h-3.5 w-full rounded" />
            <Skeleton className="h-3.5 w-11/12 rounded" />
            <Skeleton className="h-3.5 w-2/3 rounded" />
          </div>
        ) : (
          <div className="px-4 pb-4 pt-3" />
        )}
      </GlassCard>

      {/* Practice */}
      <section>
        <h3 className="mb-2 px-1 font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Practice
        </h3>
        <GlassCard className="p-3">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={topic.quiz_id ? "brand" : "outline"}
              disabled={actions.quizBusy}
              onClick={() => void actions.quiz("topic")}
              data-analytics-name="Exam topic quiz"
              className="h-11 min-w-[7.5rem] flex-1 gap-1.5 px-3 text-sm"
            >
              {actions.quizBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ListChecks className="h-4 w-4" />
              )}
              {actions.quizBusy
                ? topic.quiz_id
                  ? "Opening…"
                  : "Creating…"
                : topic.quiz_id
                  ? "Take quiz"
                  : "Quiz"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={actions.flashcardsBusy}
              onClick={() => void actions.flashcards("topic")}
              data-analytics-name="Exam topic flashcards"
              className="h-11 min-w-[7.5rem] flex-1 gap-1.5 px-3 text-sm"
            >
              {actions.flashcardsBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Layers className="h-4 w-4" />
              )}
              {actions.flashcardsBusy ? "Creating…" : "Flashcards"}
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {done ? (
              <span className="inline-flex h-11 flex-1 items-center gap-1.5 px-1 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-4 w-4" /> Completed
              </span>
            ) : (
              <Button
                type="button"
                variant="outline"
                disabled={actions.statusBusy}
                onClick={markDone}
                data-analytics-name="Exam topic mark completed"
                className="h-11 flex-1 gap-1.5 px-3 text-sm"
              >
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                Mark as completed
              </Button>
            )}
            {typeof best === "number" && (
              <Badge
                variant="outline"
                className="h-7 gap-1 border-0 bg-emerald-500/15 px-2.5 text-emerald-600 tabular-nums dark:text-emerald-400"
              >
                <Trophy className="h-3 w-3" /> Best {Math.round(best)}%
              </Badge>
            )}
          </div>
        </GlassCard>
      </section>

      {/* Doubts */}
      <section data-analytics-section="exam_topic_doubts">
        <h3 className="mb-1 flex items-center gap-1.5 px-1 font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">
          <MessageCircleQuestion className="h-4 w-4 text-brand-1" />
          Ask Aeva about this topic
        </h3>
        <p className="mb-3 px-1 text-xs text-muted-foreground">
          Doubts you ask here stay with this topic.
        </p>

        {convo.historyLoading && convo.messages.length === 0 ? (
          <div className="space-y-3">
            <Skeleton className="ml-auto h-10 w-1/2 rounded-2xl" />
            <Skeleton className="h-16 w-5/6 rounded-2xl" />
          </div>
        ) : showEmptyThread ? (
          <div className="flex flex-col gap-2" data-analytics-private>
            {SUGGESTIONS.map((s, i) => (
              <motion.button
                key={s}
                type="button"
                initial={reduce ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: reduce ? 0 : i * 0.05 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => send(s)}
                data-analytics-name={`Exam topic suggestion ${i + 1}`}
                className="glass min-h-[44px] w-full rounded-xl px-4 py-2.5 text-left text-sm font-medium transition-colors hover:bg-accent/60"
              >
                {s}
              </motion.button>
            ))}
          </div>
        ) : (
          // ChatMessages pads itself (px-4): pull it out to the page edge so
          // the bubbles line up with the cards above.
          <div className="-mx-4" data-analytics-private>
            <ChatMessages
              messages={convo.messages}
              mediaAvailable={false}
              quizBusy={convo.streaming}
              thinkingHint={convo.thinkingHint}
              followOnLoad={false}
              onAction={(message, sourceContent) =>
                send(
                  sourceContent
                    ? `${message}\n\n> ${sourceContent.replace(/\n/g, "\n> ")}`
                    : message,
                  { displayText: message },
                )
              }
              onFollowup={(prompt, title) =>
                send(prompt, { intent: "followup", displayText: title || prompt })
              }
              onGenerateQuiz={(quizTopic, options) =>
                send(`Create a quiz on ${quizTopic || topic.title}`, {
                  quizOptions: options,
                })
              }
              onCreateFlashcards={() =>
                send("Create flashcards on this", { flashcardOptions: {} })
              }
              onOpenQuiz={artifacts.openQuiz}
              onOpenFlashcards={artifacts.openFlashcards}
              onSaveNote={async () => {
                toast.info("Saving notes from the exam coach is coming soon.");
                return false;
              }}
              onRetry={convo.retry}
              onRetryAgent={(messageId) => convo.retry(messageId)}
            />
          </div>
        )}
        <div ref={threadEndRef} />
      </section>

      <NextUpSheet
        open={nextUpOpen}
        onOpenChange={setNextUpOpen}
        dashboard={dashboard}
        topic={topic}
        studySeconds={studySeconds}
      />

      {/* Composer: pinned above the bottom nav (or the keyboard). The
          composer pads itself (px-4 pb-4). */}
      <div
        className={cn(
          "sticky z-10 -mx-4 border-t border-border/50 bg-background/85 pt-2 backdrop-blur",
          "bottom-[calc(3.75rem+env(safe-area-inset-bottom))] lg:bottom-0",
          "[[data-kb-open='1']_&]:bottom-0",
        )}
      >
        <ChatComposer
          onSend={(t) => send(t)}
          onUpload={() => toast.info("Add study material from the plan setup.")}
          disabled={convo.streaming}
          hasMedia={false}
        />
      </div>
    </div>
  );
}

/** Thin indeterminate bar (transform only) under the "preparing" line. */
function ProgressLine() {
  const reduce = useReducedMotion();
  return (
    <div
      role="progressbar"
      aria-label="Preparing lesson"
      className="mt-2 h-0.5 w-full overflow-hidden rounded-full bg-brand-1/15"
    >
      <motion.span
        className="block h-full w-1/3 rounded-full bg-gradient-to-r from-brand-1 to-brand-2"
        animate={reduce ? { x: 0 } : { x: ["-100%", "300%"] }}
        transition={
          reduce
            ? undefined
            : { duration: 1.4, repeat: Infinity, ease: "easeInOut" }
        }
      />
    </div>
  );
}

function LessonError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-start gap-3 px-4 pb-4 pt-3 sm:flex-row sm:items-center">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
        <AlertTriangle className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-display text-sm font-bold">
          Aeva couldn't prepare the lesson
        </p>
        <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {message}
        </p>
      </div>
      <Button
        variant="outline"
        onClick={onRetry}
        data-analytics-name="Exam lesson retry"
        className="h-11 w-full sm:w-auto"
      >
        Retry
      </Button>
    </div>
  );
}
