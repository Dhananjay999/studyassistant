// "Edit plan": change the exam name, date, class, stream, subjects or daily
// time of the active plan, and tick topics already covered, without losing
// progress. A bottom sheet on phones, a dialog on desktop (ResponsiveModal,
// like TopicActionSheet). Submitting sends only what changed to
// PATCH /exam-prep/plan/:id; the backend regenerates the roadmap in place
// (one to two minutes, shown with the same "Building your plan…" screen as
// the setup form) and keeps the status, lesson and quiz links of topics
// whose subject + title still exist.
//
// The form lives in an inner component that mounts with the sheet content,
// so every open starts from the plan as it is now.

import {
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type FormEvent,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, ChevronDown, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ResponsiveModal,
  ResponsiveModalBody,
  ResponsiveModalClose,
  ResponsiveModalContent,
  ResponsiveModalDescription,
  ResponsiveModalFooter,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "@/components/ui/responsive-modal";
import { isoToday, parsePlanDate } from "@/components/exam/examFormat";
import {
  EXAM_NAME_LEN,
  MAX_MINUTES,
  MIN_MINUTES,
  SUBJECT_LEN,
  SUBJECT_MAX,
  withSubject,
} from "@/components/exam/examPlanRules";
import { SCHOOL_CLASSES, STREAMS } from "@/components/exam/examSetupOptions";
import { PlanBuildingScreen } from "@/components/exam/PlanBuildingScreen";
import { useUpdateExamPlan } from "@/hooks/api";
import { useBackClose } from "@/hooks/useBackClose";
import {
  analytics,
  AnalyticsEvent,
  type ExamPlanEditField,
} from "@/lib/analytics";
import { errorKind, friendlyErrorMessage } from "@/lib/errorMessage";
import { cn } from "@/lib/utils";
import type { ExamDashboard, ExamTopic, UpdateExamPlanRequest } from "@/types";

const MINUTE_CHIPS = [30, 60, 90, 120, 180, 240];
const CLASS_CHIPS = SCHOOL_CLASSES.map((c) => `Class ${c}`);
/** Classes where the stream chips are offered (also when a stream is set). */
const SENIOR_RE = /\b1[12]\b/;

export function EditPlanSheet({
  open,
  onOpenChange,
  dashboard,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dashboard: ExamDashboard;
}) {
  const [building, setBuilding] = useState(false);
  // While the roadmap is being rebuilt the sheet must not be dismissed (a
  // closed sheet would drop the result's toast and analytics).
  useBackClose(open && !building, () => onOpenChange(false));
  const block = (e: Event) => {
    if (building) e.preventDefault();
  };

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(next) => {
        if (!next && building) return;
        onOpenChange(next);
      }}
      dismissible={!building}
      analyticsName="Exam edit plan"
    >
      <ResponsiveModalContent
        className="sm:max-w-lg"
        onEscapeKeyDown={block}
        onPointerDownOutside={block}
      >
        <ResponsiveModalHeader>
          <ResponsiveModalTitle>Edit plan</ResponsiveModalTitle>
          <ResponsiveModalDescription>
            Fix anything that's wrong. Topics you've finished stay done.
          </ResponsiveModalDescription>
        </ResponsiveModalHeader>
        <EditPlanForm
          dashboard={dashboard}
          building={building}
          setBuilding={setBuilding}
          close={() => onOpenChange(false)}
        />
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}

/* --------------------------------- form --------------------------------- */

function groupTopics(dashboard: ExamDashboard) {
  const bySubject = new Map<string, ExamTopic[]>();
  for (const s of dashboard.plan.subjects) bySubject.set(s, []);
  for (const day of dashboard.days) {
    for (const group of day.subjects) {
      for (const topic of group.topics) {
        const list = bySubject.get(topic.subject);
        if (list) list.push(topic);
        else bySubject.set(topic.subject, [topic]);
      }
    }
  }
  return Array.from(bySubject.entries())
    .filter(([, topics]) => topics.length > 0)
    .map(([subject, topics]) => ({ subject, topics }));
}

function EditPlanForm({
  dashboard,
  building,
  setBuilding,
  close,
}: {
  dashboard: ExamDashboard;
  building: boolean;
  setBuilding: (b: boolean) => void;
  close: () => void;
}) {
  const { plan } = dashboard;
  const update = useUpdateExamPlan();
  const reduce = useReducedMotion();
  const today = isoToday();

  const [examName, setExamName] = useState(plan.exam_name);
  const [examDate, setExamDate] = useState(plan.exam_date);
  const [classLevel, setClassLevel] = useState(plan.class_level);
  const [stream, setStream] = useState(plan.stream);
  const [subjects, setSubjects] = useState<string[]>(plan.subjects);
  const [customSubject, setCustomSubject] = useState("");
  const [minutesText, setMinutesText] = useState(String(plan.daily_minutes));
  const [covered, setCovered] = useState<Set<string>>(() => new Set());
  const [coveredOpen, setCoveredOpen] = useState(false);
  const [touched, setTouched] = useState(false);
  const subjectInput = useRef<HTMLInputElement>(null);

  const groups = useMemo(() => groupTopics(dashboard), [dashboard]);
  const completedCount = dashboard.progress.completed;
  const minutes = Number(minutesText);
  const minutesValid =
    Number.isFinite(minutes) && minutes >= MIN_MINUTES && minutes <= MAX_MINUTES;
  const daysUntil = examDate
    ? Math.round(
        (parsePlanDate(examDate).getTime() - parsePlanDate(today).getTime()) /
          86_400_000,
      )
    : null;
  const dateValid = daysUntil !== null && daysUntil >= 0;
  const nameValid = examName.trim().length > 0;
  const valid = nameValid && dateValid && subjects.length > 0 && minutesValid;
  const showStream = SENIOR_RE.test(classLevel) || !!stream;

  /* What actually changed (the request carries only these). */
  const { body, fields } = useMemo(() => {
    const body: UpdateExamPlanRequest = {};
    const fields: ExamPlanEditField[] = [];
    const name = examName.trim().slice(0, EXAM_NAME_LEN);
    if (name && name !== plan.exam_name) {
      body.exam_name = name;
      fields.push("exam_name");
    }
    if (examDate && examDate !== plan.exam_date) {
      body.exam_date = examDate;
      fields.push("exam_date");
    }
    if (classLevel.trim() !== plan.class_level) {
      body.class_level = classLevel.trim();
      fields.push("class_level");
    }
    const nextStream = showStream ? stream : "";
    if (nextStream !== plan.stream) {
      body.stream = nextStream;
      fields.push("stream");
    }
    if (subjects.join("\u0000") !== plan.subjects.join("\u0000")) {
      body.subjects = subjects;
      fields.push("subjects");
    }
    if (minutesValid && minutes !== plan.daily_minutes) {
      body.daily_minutes = minutes;
      fields.push("daily_minutes");
    }
    if (covered.size) body.covered_topic_ids = Array.from(covered);
    return { body, fields };
  }, [
    examName,
    examDate,
    classLevel,
    stream,
    showStream,
    subjects,
    minutes,
    minutesValid,
    covered,
    plan,
  ]);
  const hasChanges = fields.length > 0 || covered.size > 0;

  const toggleSubject = (s: string) =>
    setSubjects((prev) => prev.filter((x) => x !== s));
  const addSubject = () => {
    const next = withSubject(subjects, customSubject);
    if (next === subjects) {
      if (subjects.length >= SUBJECT_MAX) {
        toast.info(`You can have up to ${SUBJECT_MAX} subjects.`);
      }
      setCustomSubject("");
      return;
    }
    setSubjects(next);
    setCustomSubject("");
    subjectInput.current?.focus();
  };
  const toggleCovered = (id: string) =>
    setCovered((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!valid) {
      setTouched(true);
      return;
    }
    if (!hasChanges) {
      toast.info("Nothing to change yet.");
      return;
    }
    const coveredCount = covered.size;
    setBuilding(true);
    const t0 = performance.now();
    try {
      const next = await update.mutateAsync({ planId: plan.id, body });
      analytics.track(AnalyticsEvent.EXAM_PLAN_EDIT_COMPLETED, {
        plan_id: plan.id,
        fields_changed: fields,
        covered_count: coveredCount,
        subject_count: next.plan.subjects.length,
        latency_ms: Math.round(performance.now() - t0),
        total_days: next.plan.total_days,
        days_remaining: next.days_remaining,
      });
      toast.success(
        coveredCount
          ? "Plan updated. Covered topics are marked done."
          : "Plan updated. Your progress is kept.",
      );
      close();
    } catch (err) {
      analytics.track(AnalyticsEvent.EXAM_PLAN_EDIT_FAILED, {
        plan_id: plan.id,
        fields_changed: fields,
        covered_count: coveredCount,
        error_kind: errorKind(err),
        latency_ms: Math.round(performance.now() - t0),
      });
      toast.error(friendlyErrorMessage(err));
      setBuilding(false);
    }
  };

  // Changing what the exam is makes the backend research the syllabus
  // again (about a minute more); the building screen says so.
  const researching = fields.some((f) =>
    ["exam_name", "class_level", "stream"].includes(f),
  );

  return (
    <>
      <form
        id="exam-edit-plan"
        onSubmit={(e) => void submit(e)}
        className="contents"
        noValidate
      >
        <ResponsiveModalBody className="-mx-4 space-y-4 px-4 pb-2 sm:-mx-6 sm:px-6">
          {/* Exam name */}
          <Field label="Exam" htmlFor="edit-exam-name">
            <Input
              id="edit-exam-name"
              value={examName}
              maxLength={EXAM_NAME_LEN}
              onChange={(e) => setExamName(e.target.value)}
              autoComplete="off"
              className="h-11"
              data-analytics-private
            />
            {touched && !nameValid && <FieldError>Enter the exam name.</FieldError>}
          </Field>

          {/* Exam date */}
          <Field label="Exam date" htmlFor="edit-exam-date">
            <Input
              id="edit-exam-date"
              type="date"
              min={today}
              value={examDate}
              onChange={(e) => setExamDate(e.target.value)}
              className="h-11 max-w-xs"
            />
            {dateValid && daysUntil !== null && (
              <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
                {daysUntil === 0
                  ? "That's today — Aeva plans a focused last-day revision."
                  : `${daysUntil} day${daysUntil === 1 ? "" : "s"} from today${daysUntil > 60 ? " — the plan covers the next 60 days first" : ""}.`}
              </p>
            )}
            {touched && !dateValid && (
              <FieldError>Pick a date from today onwards.</FieldError>
            )}
          </Field>

          {/* Class and stream */}
          <Field label="Class / level" htmlFor="edit-class">
            <Input
              id="edit-class"
              value={classLevel}
              maxLength={60}
              placeholder="e.g. Class 8, B.Sc Semester 3"
              onChange={(e) => setClassLevel(e.target.value)}
              autoComplete="off"
              className="h-11"
              data-analytics-private
            />
            <ChipRow className="mt-2.5">
              {CLASS_CHIPS.map((c) => (
                <Chip
                  key={c}
                  active={classLevel.trim() === c}
                  onClick={() => setClassLevel(c)}
                  data-analytics-name="Exam edit class chip"
                >
                  {c}
                </Chip>
              ))}
            </ChipRow>
            <AnimatePresence initial={false}>
              {showStream && (
                <motion.div
                  key="stream"
                  initial={reduce ? false : { opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
                  transition={{ duration: 0.18 }}
                  className="mt-3"
                >
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Stream
                  </p>
                  <ChipRow>
                    {[...STREAMS, ...(stream && !STREAMS.includes(stream) ? [stream] : [])].map(
                      (s) => (
                        <Chip
                          key={s}
                          active={stream === s}
                          onClick={() => setStream(stream === s ? "" : s)}
                          data-analytics-name="Exam edit stream chip"
                        >
                          {s}
                        </Chip>
                      ),
                    )}
                  </ChipRow>
                </motion.div>
              )}
            </AnimatePresence>
          </Field>

          {/* Subjects */}
          <Field
            label="Subjects"
            hint={`${subjects.length}/${SUBJECT_MAX}`}
            htmlFor="edit-subject-add"
          >
            <ChipRow data-analytics-private>
              {subjects.map((s) => (
                <Chip
                  key={s}
                  active
                  onClick={() => toggleSubject(s)}
                  data-analytics-name="Exam edit remove subject"
                  title="Remove"
                >
                  {s}
                  <X className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
                </Chip>
              ))}
              {subjects.length === 0 && (
                <span className="text-sm text-muted-foreground">
                  Add at least one subject.
                </span>
              )}
            </ChipRow>
            <div className="mt-2.5 flex gap-2">
              <Input
                id="edit-subject-add"
                ref={subjectInput}
                value={customSubject}
                maxLength={SUBJECT_LEN}
                placeholder="Add a subject"
                onChange={(e) => setCustomSubject(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addSubject();
                  }
                }}
                autoComplete="off"
                enterKeyHint="done"
                className="h-11 min-w-0 flex-1"
                data-analytics-private
              />
              <Button
                type="button"
                variant="outline"
                onClick={addSubject}
                disabled={!customSubject.trim()}
                data-analytics-name="Exam edit add subject"
                className="h-11 w-11 shrink-0 px-0"
                aria-label="Add subject"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            {touched && subjects.length === 0 && (
              <FieldError>Add at least one subject.</FieldError>
            )}
          </Field>

          {/* Daily minutes */}
          <Field label="Study time per day" htmlFor="edit-minutes">
            <ChipRow>
              {MINUTE_CHIPS.map((m) => (
                <Chip
                  key={m}
                  active={minutes === m}
                  onClick={() => setMinutesText(String(m))}
                  data-analytics-name="Exam edit minutes chip"
                >
                  {m < 60 ? `${m} min` : `${m / 60} h`}
                </Chip>
              ))}
            </ChipRow>
            <div className="mt-2.5 flex items-center gap-2">
              <Input
                id="edit-minutes"
                type="number"
                inputMode="numeric"
                min={MIN_MINUTES}
                max={MAX_MINUTES}
                step={5}
                value={minutesText}
                onChange={(e) => setMinutesText(e.target.value)}
                className="h-11 w-28"
              />
              <span className="text-sm text-muted-foreground">minutes a day</span>
            </div>
            {touched && !minutesValid && (
              <FieldError>
                Choose between {MIN_MINUTES} and {MAX_MINUTES} minutes a day.
              </FieldError>
            )}
          </Field>

          {/* Already covered */}
          {groups.length > 0 && (
            <section className="rounded-2xl border border-border/60 bg-card/40">
              <button
                type="button"
                aria-expanded={coveredOpen}
                aria-controls="edit-covered-list"
                onClick={() => setCoveredOpen((o) => !o)}
                data-analytics-name="Exam edit covered toggle"
                className="flex min-h-[56px] w-full items-center gap-3 px-4 py-3 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-sm font-bold">
                    Already covered
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Tick chapters you've finished outside Aeva ·{" "}
                    <span className="tabular-nums">
                      {completedCount + covered.size} of {dashboard.progress.total_topics} done
                    </span>
                  </span>
                </span>
                <ChevronDown
                  className={cn(
                    "h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200",
                    coveredOpen && "rotate-180",
                  )}
                />
              </button>
              <AnimatePresence initial={false}>
                {coveredOpen && (
                  <motion.div
                    id="edit-covered-list"
                    key="covered"
                    initial={reduce ? false : { opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="space-y-3 border-t border-border/50 px-2 pb-2 pt-2"
                    data-analytics-private
                  >
                    {groups.map(({ subject, topics }) => (
                      <div key={subject}>
                        <p className="px-2 pb-1 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground [overflow-wrap:anywhere]">
                          {subject}
                        </p>
                        <ul>
                          {topics.map((t) => {
                            const done = t.status === "completed";
                            const checked = done || covered.has(t.id);
                            return (
                              <li key={t.id}>
                                <label
                                  className={cn(
                                    "flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 py-1.5 text-sm transition-colors active:bg-accent/60",
                                    done && "cursor-default text-muted-foreground",
                                  )}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    disabled={done}
                                    onChange={() => toggleCovered(t.id)}
                                    data-analytics-name="Exam edit covered topic"
                                    className="h-5 w-5 shrink-0 rounded border-border accent-[hsl(var(--primary))]"
                                  />
                                  <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                                    {t.title}
                                  </span>
                                  {done && (
                                    <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                                      <Check className="h-3.5 w-3.5" /> Done
                                    </span>
                                  )}
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </section>
          )}
        </ResponsiveModalBody>

        <ResponsiveModalFooter className="gap-2 sm:items-center">
          <p className="text-xs text-muted-foreground sm:mr-auto sm:text-left">
            {hasChanges
              ? fields.length
                ? "Aeva rebuilds your days in about a minute. Finished topics stay done."
                : "Marks the ticked topics as done and replans the rest."
              : "Change something above to update the plan."}
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <ResponsiveModalClose asChild>
              <Button
                type="button"
                variant="ghost"
                className="h-11"
                data-analytics-name="Exam edit cancel"
              >
                Cancel
              </Button>
            </ResponsiveModalClose>
            <Button
              type="submit"
              variant="brand"
              disabled={update.isPending || !hasChanges}
              data-analytics-name="Exam edit save"
              className="h-12 px-6 sm:h-11"
            >
              Update plan
            </Button>
          </div>
        </ResponsiveModalFooter>
      </form>

      {building &&
        createPortal(
          <PlanBuildingScreen
            title="Updating your plan…"
            research={researching}
            className="z-[60]"
          />,
          document.body,
        )}
    </>
  );
}

/* -------------------------------- pieces -------------------------------- */

function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="font-display text-sm font-bold">
          {label}
        </label>
        {hint && (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {hint}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function FieldError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="mt-1.5 text-xs text-red-600 dark:text-red-400">
      {children}
    </p>
  );
}

function ChipRow({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)} {...rest}>
      {children}
    </div>
  );
}

function Chip({
  active,
  children,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "inline-flex h-10 max-w-full items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors touch:min-h-[44px] active:scale-[0.98]",
        active
          ? "border-brand-1 bg-brand-1/10 text-brand-1"
          : "border-border bg-background text-muted-foreground hover:bg-muted",
        className,
      )}
      {...rest}
    >
      <span className="truncate">{children}</span>
    </button>
  );
}
