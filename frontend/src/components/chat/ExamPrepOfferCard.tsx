// Exam-soon hand-off in chat (feature flag `exam_prep`).
//
// When a student says "my exam is tomorrow", the backend adds an offer to
// the answer (`content.exam_prep_offer`, see orchestration/exam_offer.py).
// This card is the whole setup on one screen: exam name, date and subjects
// prefilled from the message, one button. It creates the plan through the
// same API and the same rules as the three-step setup form
// (components/exam/examPlanRules.ts); an exam today or tomorrow gets a
// one-day cram plan, and skips the online syllabus research so the plan is
// ready in well under a minute.
//
// It never nags: nothing renders while the student already has a plan, for
// an exam Aeva's plans do not cover, or for 24 hours after "Not now".

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  CalendarCheck,
  Check,
  Loader2,
  Plus,
  Sparkles,
  Target,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GlassCard } from "@/components/common/GlassCard";
import { RotatingStatus } from "@/components/common/RotatingStatus";
import { formatPlanDate, isoToday } from "@/components/exam/examFormat";
import {
  EXAM_NAME_LEN,
  SUBJECT_LEN,
  SUBJECT_MAX,
  defaultSubjectsFor,
  withSubject,
} from "@/components/exam/examPlanRules";
import {
  UNSUPPORTED_EXAM_NOTE,
  unsupportedExamName,
} from "@/components/exam/examSetupOptions";
import { useAuth } from "@/contexts/AuthContext";
import {
  useCreateExamPlan,
  useExamDashboard,
  useLearningProfile,
} from "@/hooks/api";
import { useFeature } from "@/hooks/useFeature";
import { analytics, AnalyticsEvent } from "@/lib/analytics";
import { errorKind, friendlyErrorMessage } from "@/lib/errorMessage";
import {
  daysUntil,
  isOfferSnoozed,
  markOfferSeen,
  resolveOfferDate,
  snoozeOffers,
} from "@/lib/examOffer";
import { hasExamPlanHint, setExamPlanHint } from "@/lib/examPrepHome";
import { cn } from "@/lib/utils";
import {
  hasExamPlan,
  type CreateExamPlanRequest,
  type ExamPrepOffer,
} from "@/types";

// The backend's default daily study time (CreateExamPlanSchema).
const DAILY_MINUTES = 120;
// Subject suggestions shown as chips (the message's own come first).
const SUGGESTION_MAX = 6;
// Up to this many days away the plan is a single cram day, built without
// the online syllabus research (which adds a minute or two).
const CRAM_DAYS = 1;
const BUILD_MESSAGES = [
  "Reading your subjects and date…",
  "Picking what matters most…",
  "Almost there — polishing the plan…",
];
const ENTER = { duration: 0.22, ease: [0.22, 1, 0.36, 1] as const };

type Phase = "form" | "creating" | "created" | "error";

function initialName(offer: ExamPrepOffer): string {
  if (offer.exam_name) return offer.exam_name.slice(0, EXAM_NAME_LEN);
  return offer.subjects.length === 1 ? `${offer.subjects[0]} exam` : "";
}

export function ExamPrepOfferCard({
  offer,
  messageId,
}: {
  offer: ExamPrepOffer;
  /** Persisted id of the answer the offer came with (impression de-dupe). */
  messageId: string;
}) {
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const { user } = useAuth();
  const enabled = useFeature("exam_prep", false);
  const dashboard = useExamDashboard(enabled);
  const profile = useLearningProfile();
  const create = useCreateExamPlan();

  const today = isoToday();
  const [phase, setPhase] = useState<Phase>("form");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  // Read once: a snooze set elsewhere must not pull the card away mid-use.
  const [snoozed] = useState(() => isOfferSnoozed());
  // What this browser last knew about the student's plan (lib/examPrepHome).
  const [planHint] = useState(() => !!user?.id && hasExamPlanHint(user.id));
  const prefilledDate = useMemo(
    () => resolveOfferDate(offer, today),
    [offer, today],
  );
  const prefilledName = useMemo(() => initialName(offer), [offer]);
  const [examName, setExamName] = useState(prefilledName);
  const [examDate, setExamDate] = useState(prefilledDate);
  const [subjects, setSubjects] = useState<string[]>(() =>
    offer.subjects.slice(0, SUBJECT_MAX),
  );
  const [customSubject, setCustomSubject] = useState("");

  const hasPlan = hasExamPlan(dashboard.data);
  // The backend only offers when there is no active plan, so the card shows
  // with the answer instead of popping in after the dashboard query (which
  // would push the action chips down under the student's thumb). It waits
  // for the query only when this browser remembers a plan (an older answer
  // reopened), and hides if the query does report one.
  const noPlan =
    dashboard.data !== undefined
      ? !hasPlan
      : dashboard.isError || !planHint;
  const days = examDate ? daysUntil(examDate, today) : null;
  const unsupported = unsupportedExamName(examName);
  const cram = days !== null && days <= CRAM_DAYS;

  const suggestions = useMemo(() => {
    const focus = profile.data?.focus_areas ?? [];
    return Array.from(
      new Set([
        ...offer.subjects,
        ...subjects,
        ...defaultSubjectsFor(examName),
        ...focus,
      ]),
    ).slice(0, Math.max(SUGGESTION_MAX, subjects.length));
  }, [offer.subjects, subjects, examName, profile.data?.focus_areas]);

  // What "Make my plan" is still waiting for (same wording as the form).
  const missing: string[] = [];
  if (!examName.trim()) missing.push("the exam name");
  if (!examDate) missing.push("the exam date");
  else if (days !== null && days < 0) missing.push("a date from today onwards");
  if (subjects.length === 0) missing.push("at least one subject");
  const valid = missing.length === 0 && !unsupported;

  // Nothing to offer: flag off, a plan already exists (creating one would
  // archive it), "Not now" earlier, or an exam the plans do not cover. Once
  // the student has tapped "Make my plan" the card stays: the plan it is
  // building (or built) is the one the dashboard query then reports.
  const visible =
    enabled &&
    !dismissed &&
    !snoozed &&
    (phase !== "form" || noPlan) &&
    !unsupportedExamName(prefilledName);

  // One impression per offer per device, however often the chat is reopened.
  useEffect(() => {
    if (!visible || !markOfferSeen(messageId)) return;
    analytics.track(AnalyticsEvent.EXAM_PREP_OFFER_SHOWN, {
      date_hint_kind: offer.date_hint,
      days_until: daysUntil(prefilledDate),
      has_exam_name: !!offer.exam_name,
      subject_count: offer.subjects.length,
    });
  }, [visible, messageId, offer, prefilledDate]);

  if (!visible) return null;

  const toggleSubject = (s: string) =>
    setSubjects((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : withSubject(prev, s),
    );

  const addCustomSubject = () => {
    setSubjects((prev) => withSubject(prev, customSubject));
    setCustomSubject("");
  };

  const dismiss = () => {
    analytics.track(AnalyticsEvent.EXAM_PREP_OFFER_DISMISSED, {
      date_hint_kind: offer.date_hint,
      days_until: days ?? 0,
    });
    snoozeOffers();
    setDismissed(true);
  };

  const submit = async () => {
    setTouched(true);
    if (!valid || days === null || phase === "creating") return;
    analytics.track(AnalyticsEvent.EXAM_PREP_OFFER_ACCEPTED, {
      date_hint_kind: offer.date_hint,
      days_until: days,
      subject_count: subjects.length,
      date_edited: examDate !== prefilledDate,
      name_edited: examName.trim() !== prefilledName.trim(),
    });
    const research = !cram;
    const body: CreateExamPlanRequest = {
      exam_name: examName.trim().slice(0, EXAM_NAME_LEN),
      exam_date: examDate,
      exam_kind: "other",
      subjects,
      daily_minutes: DAILY_MINUTES,
      research,
      target_score: null,
      syllabus_text: null,
      material_media_ids: [],
    };
    setPhase("creating");
    setErrorMsg(null);
    const t0 = performance.now();
    try {
      const made = await create.mutateAsync(body);
      analytics.track(AnalyticsEvent.EXAM_PREP_OFFER_PLAN_CREATED, {
        plan_id: made.plan.id,
        days_remaining: made.days_remaining,
        total_days: made.plan.total_days,
        subject_count: subjects.length,
        research,
        latency_ms: Math.round(performance.now() - t0),
      });
      if (user?.id) setExamPlanHint(user.id, true);
      setPhase("created");
    } catch (err) {
      analytics.track(AnalyticsEvent.EXAM_PREP_OFFER_PLAN_FAILED, {
        error_kind: errorKind(err),
        latency_ms: Math.round(performance.now() - t0),
      });
      setErrorMsg(friendlyErrorMessage(err));
      setPhase("error");
    }
  };

  const motionProps = {
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: ENTER,
  };

  if (phase === "created") {
    return (
      <motion.div {...motionProps} className="mt-3 w-full max-w-md">
        <GlassCard
          role="status"
          className="flex flex-col gap-3 border-brand-1/20 p-3 sm:p-4"
        >
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <CalendarCheck className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="font-display text-sm font-bold leading-snug">
                Your plan is ready
              </p>
              <p className="text-xs text-muted-foreground">
                Topics, quizzes and flashcards for{" "}
                {cram ? "your last day" : "every day until the exam"}.
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="brand"
            onClick={() => navigate("/exam")}
            data-analytics-name="Open exam plan from chat"
            className="h-11 w-full gap-2 rounded-xl"
          >
            Open my plan <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        </GlassCard>
      </motion.div>
    );
  }

  const creating = phase === "creating";
  return (
    <motion.div {...motionProps} className="mt-3 w-full max-w-md">
      <GlassCard
        className="border-brand-1/20 p-3 sm:p-4"
        data-analytics-section="exam_prep_offer"
      >
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-1/10 text-brand-1">
            <Target className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="font-display text-sm font-bold leading-snug">
              {cram ? "Want a last-day plan?" : "Want a plan for this exam?"}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {cram
                ? "One focused day: what to revise, in what order, with quick quizzes."
                : "A day-by-day plan up to your exam date."}
            </p>
          </div>
        </div>

        <fieldset disabled={creating} className="mt-3 min-w-0 space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
              Exam
            </span>
            <Input
              value={examName}
              onChange={(e) => setExamName(e.target.value)}
              maxLength={EXAM_NAME_LEN}
              placeholder="e.g. Physics unit test"
              className="h-11 text-base sm:text-sm"
              data-analytics-private
            />
          </label>
          {unsupported && (
            <p
              role="alert"
              className="flex items-start gap-1.5 text-xs leading-snug text-amber-700 dark:text-amber-400"
            >
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>
                {unsupported} preparation isn't available yet.{" "}
                {UNSUPPORTED_EXAM_NOTE}
              </span>
            </p>
          )}

          <div>
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
              Exam date
            </span>
            <Input
              type="date"
              min={today}
              value={examDate}
              onChange={(e) => setExamDate(e.target.value)}
              aria-label="Exam date"
              className="h-11 min-w-0 max-w-full text-base sm:text-sm"
            />
            {days !== null && days >= 0 && (
              <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                {days === 0
                  ? "That's today."
                  : days === 1
                    ? `Tomorrow, ${formatPlanDate(examDate)}.`
                    : `${formatPlanDate(examDate)} · ${days} days from today.`}
              </p>
            )}
          </div>

          <div>
            <span className="mb-1 block text-xs font-medium text-muted-foreground">
              Subjects{" "}
              <span className="tabular-nums">
                ({subjects.length}/{SUBJECT_MAX})
              </span>
            </span>
            {suggestions.length > 0 && (
              <div
                className="mb-2 flex flex-wrap gap-2"
                data-analytics-private
              >
                {suggestions.map((s) => {
                  const active = subjects.includes(s);
                  return (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleSubject(s)}
                      data-analytics-name="Exam offer subject"
                      className={cn(
                        "inline-flex h-10 max-w-full items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors touch:min-h-[44px] active:scale-[0.98]",
                        active
                          ? "border-brand-1 bg-brand-1/10 text-brand-1"
                          : "border-border bg-background text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {active && <Check className="h-3.5 w-3.5 shrink-0" />}
                      <span className="truncate">{s}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex gap-2">
              <Input
                value={customSubject}
                onChange={(e) => setCustomSubject(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustomSubject();
                  }
                }}
                maxLength={SUBJECT_LEN}
                placeholder="Add a subject"
                aria-label="Add a subject"
                enterKeyHint="done"
                className="h-11 min-w-0 flex-1 text-base sm:text-sm"
                data-analytics-private
              />
              <Button
                type="button"
                variant="outline"
                onClick={addCustomSubject}
                disabled={
                  !customSubject.trim() || subjects.length >= SUBJECT_MAX
                }
                data-analytics-name="Exam offer add subject"
                className="h-11 shrink-0 gap-1 px-3"
              >
                <Plus className="h-4 w-4" aria-hidden /> Add
              </Button>
            </div>
          </div>
        </fieldset>

        {touched && missing.length > 0 && !creating && (
          <p
            role="status"
            aria-live="polite"
            className="mt-3 flex items-start gap-1.5 text-xs leading-snug text-red-600 [overflow-wrap:anywhere] dark:text-red-400"
          >
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>Still needed: {missing.join(", ")}.</span>
          </p>
        )}
        {phase === "error" && errorMsg && (
          <p
            role="alert"
            className="mt-3 text-xs leading-snug text-red-600 [overflow-wrap:anywhere] dark:text-red-400"
          >
            {errorMsg}
          </p>
        )}

        <div className="mt-3 flex flex-col gap-1">
          <Button
            type="button"
            variant="brand"
            onClick={() => void submit()}
            disabled={creating || !!unsupported}
            data-analytics-name="Make my plan"
            className="h-11 w-full gap-2 rounded-xl"
          >
            {creating ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="h-4 w-4" aria-hidden />
            )}
            {creating
              ? "Building your plan…"
              : phase === "error"
                ? "Try again"
                : "Make my plan"}
          </Button>
          {creating ? (
            <p
              role="status"
              aria-live="polite"
              className="min-h-[2.75rem] py-1 text-center text-xs text-muted-foreground"
            >
              <RotatingStatus messages={BUILD_MESSAGES} intervalMs={3200} />
              <span className="block">
                {cram
                  ? "Usually under a minute. You can keep chatting."
                  : "Usually one to two minutes. You can keep chatting."}
              </span>
            </p>
          ) : (
            <button
              type="button"
              onClick={dismiss}
              data-analytics-name="Exam offer not now"
              className="mx-auto h-11 min-w-[44px] rounded-lg px-4 text-xs font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              Not now
            </button>
          )}
        </div>
      </GlassCard>
    </motion.div>
  );
}
