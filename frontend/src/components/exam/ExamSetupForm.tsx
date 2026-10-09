// Exam plan setup: three short steps on one scrolling page (exam → subjects &
// time → optional syllabus/material), then a full-screen "Building your plan"
// state while the backend generates the roadmap (20–60 s). Prefilled from the
// learning profile. Inputs stay keyboard-safe: the page scrolls and the action
// row is sticky above the bottom nav (or the keyboard).

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  FileText,
  Image as ImageIcon,
  Loader2,
  Plus,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { GlassCard } from "@/components/common/GlassCard";
import { RotatingStatus } from "@/components/common/RotatingStatus";
import { isoToday, parsePlanDate } from "@/components/exam/examFormat";
import {
  EXAM_NAME_LEN,
  MAX_MINUTES,
  MIN_MINUTES,
  SUBJECT_LEN,
  SUBJECT_MAX,
  defaultSubjectsFor,
} from "@/components/exam/examPlanRules";
import {
  BOARDS,
  BOARD_CLASSES,
  BOARD_EXAM_TYPES,
  COLLEGE_EXAM_TYPES,
  DEGREES,
  EMPTY_ANSWERS,
  EXAM_KINDS,
  INDIAN_STATES,
  MEDIUMS,
  SCHOOL_CLASSES,
  SCHOOL_EXAM_TYPES,
  SEMESTERS,
  SENIOR_CLASSES,
  STREAMS,
  UNIT_LEVELS,
  UNIT_SUBJECTS,
  UNSUPPORTED_EXAM_NOTE,
  boardFor,
  classLevelFor,
  composeExamName,
  detailsFor,
  kindAnswersComplete,
  streamFor,
  suggestedSubjectsFor,
  unsupportedExamName,
  type ExamKind,
  type SetupAnswers,
} from "@/components/exam/examSetupOptions";
import { useAuth } from "@/contexts/AuthContext";
import { qk, useCreateExamPlan, useLearningProfile, useMedia } from "@/hooks/api";
import { useMediaProcessing } from "@/hooks/useMediaProcessing";
import { analytics, AnalyticsEvent } from "@/lib/analytics";
import { uploadMedia } from "@/lib/api";
import { errorKind, friendlyErrorMessage } from "@/lib/errorMessage";
import { setExamPlanHint } from "@/lib/examPrepHome";
import {
  UPLOAD_ACCEPT,
  UPLOAD_FAILURES,
  exceedsUploadLimit,
  getMaxUploadMb,
  preflightUpload,
  toUploadError,
} from "@/lib/uploadErrors";
import { cn } from "@/lib/utils";
import { compressFile } from "@/utils/compress";
import {
  isMediaReady,
  type CreateExamPlanRequest,
  type LearningProfile,
  type MediaItem,
} from "@/types";

const MINUTE_CHIPS = [30, 60, 90, 120, 180, 240];
const SYLLABUS_MAX = 8000;

const RESEARCH_MESSAGE = "Researching the official syllabus and exam pattern…";
const BUILD_MESSAGES = [
  "Reading your subjects and dates…",
  "Spreading topics across your days…",
  "Adding revision and mock-test days…",
  "Almost there — polishing the plan…",
];

/** First-run answers taken from the learning profile (the student edits). */
function answersFromProfile(profile: LearningProfile): Partial<SetupAnswers> {
  const ctx = profile.context ?? {};
  const out: Partial<SetupAnswers> = {};
  if (ctx.type === "school") {
    out.kind = "school";
    const cls = /(\d{1,2})\s*[–-]\s*(\d{1,2})/.exec(ctx.class ?? "");
    // "Class 11–12" → the higher class; "Class 9–10" → 10.
    if (cls) out.schoolClass = cls[2];
    if (ctx.board && ctx.board !== "Not sure") {
      out.board = ctx.board.startsWith("CBSE")
        ? "CBSE"
        : ctx.board.startsWith("ICSE")
          ? "ICSE / ISC"
          : ctx.board.startsWith("State")
            ? "State Board"
            : "";
    }
  } else if (ctx.type === "college") {
    out.kind = "college";
    const degree = DEGREES.find(
      (d) => d.toLowerCase().split(" ")[0] === (ctx.degree ?? "").toLowerCase().split(" ")[0],
    );
    if (degree) out.degree = degree;
  }
  return out;
}

type Step = 1 | 2 | 3;
type Phase = "form" | "building" | "error";

interface UploadRow {
  id: string;
  name: string;
  status: "uploading" | "processing" | "ready" | "failed";
  pct: number;
  mediaId?: string;
  message?: string;
}

const uid = () => crypto.randomUUID();

export function ExamSetupForm() {
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const qc = useQueryClient();
  const { user } = useAuth();
  const profile = useLearningProfile();
  const media = useMedia();
  const processing = useMediaProcessing();
  const create = useCreateExamPlan();

  const [step, setStep] = useState<Step>(1);
  const [phase, setPhase] = useState<Phase>("form");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const [answers, setAnswers] = useState<SetupAnswers>(EMPTY_ANSWERS);
  const [examName, setExamName] = useState("");
  const [examDate, setExamDate] = useState("");
  const [research, setResearch] = useState(true);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [customSubject, setCustomSubject] = useState("");
  const [dailyMinutes, setDailyMinutes] = useState<number | null>(60);
  const [customMinutes, setCustomMinutes] = useState("");
  const [targetScore, setTargetScore] = useState("");
  const [syllabus, setSyllabus] = useState("");
  const [selectedMedia, setSelectedMedia] = useState<Set<string>>(new Set());
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  // Subjects / exam name the student has not edited follow the answers.
  const subjectsAuto = useRef(true);
  const nameAuto = useRef(true);
  const prefilled = useRef(false);
  // The form root: step changes scroll its scroll container (PageContainer,
  // not the window) back to the top so step 2/3 start at their first field.
  const rootRef = useRef<HTMLDivElement>(null);
  // Step 3 "completed" is reported once per pass through the form, not on
  // every retry of a failed generation.
  const step3Tracked = useRef(false);
  // Plan generation outlives the form when the user navigates away through
  // the bottom nav; the success path must not yank them back then.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Prefill once from the learning profile.
  useEffect(() => {
    if (prefilled.current || !profile.data) return;
    prefilled.current = true;
    const fromProfile = answersFromProfile(profile.data);
    if (Object.keys(fromProfile).length) {
      setAnswers((prev) => ({ ...prev, ...fromProfile }));
    }
    const focus = (profile.data.focus_areas ?? []).slice(0, SUBJECT_MAX);
    if (focus.length) {
      setSubjects(focus);
      subjectsAuto.current = false;
    }
  }, [profile.data]);

  const patch = (changes: Partial<SetupAnswers>) =>
    setAnswers((prev) => ({ ...prev, ...changes }));

  // Dependent answers follow the branch: a new kind clears the other
  // branches' answers, a junior class clears the stream.
  const pickKind = (kind: ExamKind) =>
    setAnswers((prev) =>
      prev.kind === kind ? prev : { ...EMPTY_ANSWERS, kind, details: prev.details },
    );
  const pickClass = (schoolClass: string) =>
    setAnswers((prev) => ({
      ...prev,
      schoolClass,
      stream: SENIOR_CLASSES.has(schoolClass) ? prev.stream : "",
      schoolExamType:
        prev.kind === "board" && !BOARD_CLASSES.includes(schoolClass)
          ? ""
          : prev.schoolExamType,
    }));
  // The composed name and the suggested subjects follow the answers until the
  // student edits them by hand.
  const composedName =
    answers.kind === "other" ? answers.customExamName : composeExamName(answers);
  useEffect(() => {
    if (nameAuto.current) setExamName(composedName);
  }, [composedName]);
  const branchSubjects = useMemo(() => suggestedSubjectsFor(answers), [answers]);
  useEffect(() => {
    if (!subjectsAuto.current) return;
    setSubjects(
      branchSubjects.length ? branchSubjects : defaultSubjectsFor(examName),
    );
  }, [branchSubjects, examName]);

  const today = isoToday();
  const daysUntil = useMemo(() => {
    if (!examDate) return null;
    const diff = parsePlanDate(examDate).getTime() - parsePlanDate(today).getTime();
    return Math.round(diff / 86_400_000);
  }, [examDate, today]);

  const minutes = dailyMinutes ?? Number(customMinutes);
  const minutesValid =
    Number.isFinite(minutes) && minutes >= MIN_MINUTES && minutes <= MAX_MINUTES;
  // Big entrance exams are out of scope: say so instead of a shallow plan.
  const unsupported = unsupportedExamName(
    answers.kind === "other" ? answers.customExamName : examName,
  );
  const step1Valid =
    !!answers.kind &&
    kindAnswersComplete(answers) &&
    !unsupported &&
    examName.trim().length > 0 &&
    !!examDate &&
    daysUntil !== null &&
    daysUntil >= 0;
  const step2Valid = subjects.length > 0 && minutesValid;

  // What Continue is still waiting for on this step, in form order. After a
  // refused tap it is spelled out in one line above the button (and reported
  // by id), so the tap always gets an answer the student can act on.
  const missing = useMemo(() => {
    const out: { id: string; label: string }[] = [];
    if (step === 1) {
      if (!answers.kind) {
        out.push({ id: "exam_kind", label: "the kind of exam" });
      } else if (answers.kind === "school" || answers.kind === "board") {
        if (!answers.schoolClass) out.push({ id: "class", label: "your class" });
        if (!answers.board) out.push({ id: "board", label: "your board" });
        if (SENIOR_CLASSES.has(answers.schoolClass) && !answers.stream) {
          out.push({ id: "stream", label: "your stream" });
        }
      } else if (answers.kind === "college" && !answers.degree) {
        out.push({ id: "degree", label: "your degree" });
      } else if (answers.kind === "unit" && !answers.unitSubject.trim()) {
        out.push({ id: "unit_subject", label: "the subject" });
      }
      if (unsupported) {
        out.push({
          id: "unsupported_exam",
          label: `a different exam (${unsupported} plans aren't available yet)`,
        });
      } else if (answers.kind && !examName.trim()) {
        out.push({ id: "exam_name", label: "the exam name" });
      }
      if (!examDate) {
        out.push({ id: "exam_date", label: "the exam date" });
      } else if (daysUntil !== null && daysUntil < 0) {
        out.push({ id: "exam_date_past", label: "a date from today onwards" });
      }
    } else if (step === 2) {
      if (subjects.length === 0) {
        out.push({ id: "subjects", label: "at least one subject" });
      }
      if (!minutesValid) {
        out.push({ id: "daily_minutes", label: "your daily study time" });
      }
    }
    return out;
  }, [step, answers, unsupported, examName, examDate, daysUntil, subjects.length, minutesValid]);
  const showMissing = touched && missing.length > 0;

  const toggleSubject = (s: string) => {
    subjectsAuto.current = false;
    setSubjects((prev) =>
      prev.includes(s)
        ? prev.filter((x) => x !== s)
        : prev.length < SUBJECT_MAX
          ? [...prev, s]
          : prev,
    );
  };

  const addCustomSubject = () => {
    const s = customSubject.trim().slice(0, SUBJECT_LEN);
    if (!s) return;
    if (subjects.some((x) => x.toLowerCase() === s.toLowerCase())) {
      setCustomSubject("");
      return;
    }
    if (subjects.length >= SUBJECT_MAX) {
      toast.info(`You can add up to ${SUBJECT_MAX} subjects.`);
      return;
    }
    subjectsAuto.current = false;
    setSubjects((prev) => [...prev, s]);
    setCustomSubject("");
  };

  const suggestedSubjects = useMemo(() => {
    const base = branchSubjects.length ? branchSubjects : defaultSubjectsFor(examName);
    const focus = profile.data?.focus_areas ?? [];
    return Array.from(new Set([...base, ...focus, ...subjects]));
  }, [branchSubjects, examName, profile.data?.focus_areas, subjects]);

  const scrollToTop = () => {
    const behavior: ScrollBehavior = reduce ? "auto" : "smooth";
    let el: HTMLElement | null = rootRef.current?.parentElement ?? null;
    while (el && el !== document.body) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) {
        el.scrollTo({ top: 0, behavior });
        return;
      }
      el = el.parentElement;
    }
    window.scrollTo({ top: 0, behavior });
  };

  // After a failed Continue, bring the first missing field into view (the
  // errors render on the next frame, once `touched` is set) and focus its
  // input so the student sees exactly what is missing.
  const revealFirstError = () => {
    window.requestAnimationFrame(() => {
      const alert = rootRef.current?.querySelector<HTMLElement>('[role="alert"]');
      if (!alert) return;
      const field = alert.closest<HTMLElement>("[data-field]") ?? alert;
      field.scrollIntoView({
        block: "center",
        behavior: reduce ? "auto" : "smooth",
      });
      field
        .querySelector<HTMLElement>("input:not([type='hidden']), textarea")
        ?.focus({ preventScroll: true });
    });
  };

  const next = () => {
    setTouched(true);
    if ((step === 1 && !step1Valid) || (step === 2 && !step2Valid)) {
      analytics.track(AnalyticsEvent.EXAM_PREP_SETUP_STEP_BLOCKED, {
        step,
        exam_kind: answers.kind ?? undefined,
        missing_fields: missing.map((m) => m.id),
        missing_count: missing.length,
      });
      revealFirstError();
      return;
    }
    analytics.track(AnalyticsEvent.EXAM_PREP_SETUP_STEP_COMPLETED, {
      step,
      exam_kind: answers.kind ?? undefined,
    });
    setTouched(false);
    setStep((s) => (s + 1) as Step);
    scrollToTop();
  };
  const back = () => {
    setTouched(false);
    setStep((s) => Math.max(1, s - 1) as Step);
    scrollToTop();
  };

  /* ---------------------------- material upload --------------------------- */

  const patchUpload = (id: string, patch: Partial<UploadRow>) =>
    setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));

  const onPickFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    await Promise.all(
      files.map(async (original) => {
        const rowId = uid();
        const refused = await preflightUpload(original);
        if (refused) {
          toast.error(UPLOAD_FAILURES[refused].message);
          return;
        }
        setUploads((prev) => [
          { id: rowId, name: original.name, status: "uploading", pct: 0 },
          ...prev,
        ]);
        const file = await compressFile(original);
        if (exceedsUploadLimit(file)) {
          patchUpload(rowId, {
            status: "failed",
            message: UPLOAD_FAILURES.too_large.message,
          });
          return;
        }
        let item: MediaItem;
        try {
          [item] = await uploadMedia([file]);
        } catch (err) {
          patchUpload(rowId, { status: "failed", message: toUploadError(err).message });
          return;
        }
        patchUpload(rowId, { status: "processing", mediaId: item.id, pct: 5 });
        void processing.start(item.id, {
          onFrame: (frame) => patchUpload(rowId, { pct: Math.max(5, frame.pct) }),
          onReady: () => {
            patchUpload(rowId, { status: "ready", pct: 100 });
            setSelectedMedia((prev) => new Set(prev).add(item.id));
            void qc.invalidateQueries({ queryKey: qk.media });
          },
          onError: (message) => {
            patchUpload(rowId, { status: "failed", message });
            void qc.invalidateQueries({ queryKey: qk.media });
          },
        });
      }),
    );
  };

  const readyMedia = useMemo(
    () =>
      (media.data ?? []).filter(
        (m) =>
          isMediaReady(m) &&
          (m.mime_type === "application/pdf" || m.mime_type.startsWith("image/")) &&
          // Files uploaded here show in the upload list instead.
          !uploads.some((u) => u.mediaId === m.id),
      ),
    [media.data, uploads],
  );

  const toggleMedia = (id: string) =>
    setSelectedMedia((prev) => {
      const nextSet = new Set(prev);
      if (nextSet.has(id)) nextSet.delete(id);
      else nextSet.add(id);
      return nextSet;
    });

  const uploadsInFlight = uploads.some(
    (u) => u.status === "uploading" || u.status === "processing",
  );

  /* -------------------------------- submit -------------------------------- */

  const submit = async () => {
    if (!step1Valid || !step2Valid) return;
    if (!step3Tracked.current) {
      step3Tracked.current = true;
      analytics.track(AnalyticsEvent.EXAM_PREP_SETUP_STEP_COMPLETED, {
        step: 3,
        exam_kind: answers.kind ?? undefined,
      });
    }
    const body: CreateExamPlanRequest = {
      exam_name: examName.trim().slice(0, EXAM_NAME_LEN),
      exam_date: examDate,
      exam_kind: answers.kind ?? "other",
      board: boardFor(answers) || undefined,
      class_level: classLevelFor(answers) || undefined,
      stream: streamFor(answers) || undefined,
      exam_details: detailsFor(answers) || undefined,
      research,
      subjects,
      daily_minutes: minutes,
      target_score: targetScore.trim() || null,
      syllabus_text: syllabus.trim() ? syllabus.trim().slice(0, SYLLABUS_MAX) : null,
      material_media_ids: Array.from(selectedMedia),
    };
    setPhase("building");
    setErrorMsg(null);
    const t0 = performance.now();
    try {
      const dashboard = await create.mutateAsync(body);
      analytics.track(AnalyticsEvent.EXAM_PREP_SETUP_COMPLETED, {
        exam_kind: answers.kind ?? "other",
        research,
        days_remaining: dashboard.days_remaining,
        subject_count: subjects.length,
        daily_minutes: minutes,
        has_target_score: !!body.target_score,
        has_syllabus: !!body.syllabus_text,
        material_count: body.material_media_ids?.length ?? 0,
        total_days: dashboard.plan.total_days,
        latency_ms: Math.round(performance.now() - t0),
      });
      if (user?.id) setExamPlanHint(user.id, true);
      // The dashboard cache is already seeded by useCreateExamPlan.
      if (alive.current) navigate("/exam", { replace: true });
    } catch (err) {
      analytics.track(AnalyticsEvent.EXAM_PREP_SETUP_FAILED, {
        error_kind: errorKind(err),
        latency_ms: Math.round(performance.now() - t0),
        step: 3,
        exam_kind: answers.kind ?? "other",
      });
      setErrorMsg(friendlyErrorMessage(err));
      setPhase("error");
    }
  };

  /* -------------------------------- render -------------------------------- */

  if (phase === "building") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-background px-6 text-center"
      >
        <motion.span
          initial={reduce ? false : { scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="grid h-20 w-20 place-items-center rounded-3xl bg-gradient-to-br from-brand-1 to-brand-2 text-white shadow-glow-lg"
        >
          <Sparkles className="h-9 w-9" />
        </motion.span>
        <div>
          <h2 className="font-display text-2xl font-extrabold">
            Building your plan…
          </h2>
          <p className="mt-2 min-h-[1.5rem] text-sm text-muted-foreground">
            <RotatingStatus
              messages={research ? [RESEARCH_MESSAGE, ...BUILD_MESSAGES] : BUILD_MESSAGES}
              intervalMs={3200}
            />
          </p>
        </div>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />{" "}
          {research ? "Usually one to two minutes." : "This usually takes under a minute."}
        </p>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <GlassCard className="grid place-items-center gap-3 p-8 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-red-500/15 text-red-600 dark:text-red-400">
          <AlertTriangle className="h-6 w-6" />
        </span>
        <p className="font-display font-bold">We couldn't build your plan</p>
        <p className="max-w-sm text-sm text-muted-foreground">{errorMsg}</p>
        <div className="mt-2 flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <Button variant="brand" className="h-11" onClick={() => void submit()}>
            Try again
          </Button>
          <Button
            variant="ghost"
            className="h-11"
            onClick={() => {
              step3Tracked.current = false;
              setPhase("form");
            }}
          >
            Back to the form
          </Button>
        </div>
      </GlassCard>
    );
  }

  return (
    <div
      ref={rootRef}
      className={cn("relative lg:pb-0", showMissing ? "pb-36" : "pb-24")}
    >
      <StepIndicator step={step} />

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          initial={reduce ? false : { opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={reduce ? undefined : { opacity: 0, x: -16 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="mt-4 space-y-4"
        >
          {step === 1 && (
            <>
              <Field label="What are you preparing for?" required>
                <div className="grid gap-2 sm:grid-cols-2">
                  {EXAM_KINDS.map((k) => {
                    const active = answers.kind === k.id;
                    return (
                      <button
                        key={k.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() => pickKind(k.id)}
                        data-analytics-name="Exam setup kind"
                        className={cn(
                          "flex min-h-[56px] items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors active:scale-[0.99]",
                          active
                            ? "border-brand-1 bg-brand-1/10"
                            : "border-border bg-background hover:bg-muted",
                        )}
                      >
                        <span
                          className={cn(
                            "grid h-5 w-5 shrink-0 place-items-center rounded-full border",
                            active ? "border-brand-1 bg-brand-1 text-white" : "border-border",
                          )}
                        >
                          {active && <Check className="h-3.5 w-3.5" />}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold">{k.label}</span>
                          <span className="block text-xs text-muted-foreground">{k.hint}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                {touched && !answers.kind && (
                  <FieldError>Pick the kind of exam so Aeva asks the right questions.</FieldError>
                )}
                <p className="mt-3 text-xs text-muted-foreground">{UNSUPPORTED_EXAM_NOTE}</p>
              </Field>

              {(answers.kind === "school" || answers.kind === "board") && (
                <>
                  <Field label="Which class?" required>
                    <ChipRow>
                      {(answers.kind === "board" ? BOARD_CLASSES : SCHOOL_CLASSES).map((c) => (
                        <Chip
                          key={c}
                          active={answers.schoolClass === c}
                          onClick={() => pickClass(c)}
                          data-analytics-name="Exam setup class chip"
                        >
                          Class {c}
                        </Chip>
                      ))}
                    </ChipRow>
                    {touched && !answers.schoolClass && <FieldError>Pick your class.</FieldError>}
                  </Field>

                  <Field label="Which board?" required>
                    <ChipRow>
                      {BOARDS.map((b) => (
                        <Chip
                          key={b}
                          active={answers.board === b}
                          onClick={() => patch({ board: b, state: b === "State Board" ? answers.state : "" })}
                          data-analytics-name="Exam setup board chip"
                        >
                          {b}
                        </Chip>
                      ))}
                    </ChipRow>
                    {answers.board === "State Board" && (
                      <div className="mt-3">
                        <p className="mb-2 text-xs font-medium text-muted-foreground">Which state?</p>
                        <ChipRow>
                          {INDIAN_STATES.map((st) => (
                            <Chip
                              key={st}
                              active={answers.state === st}
                              onClick={() => patch({ state: answers.state === st ? "" : st })}
                              data-analytics-name="Exam setup state chip"
                            >
                              {st}
                            </Chip>
                          ))}
                        </ChipRow>
                        <Input
                          value={answers.state}
                          maxLength={40}
                          onChange={(e) => patch({ state: e.target.value })}
                          placeholder="Or type your state"
                          className="mt-2 h-11 max-w-sm"
                          data-analytics-private
                        />
                      </div>
                    )}
                    {touched && !answers.board && <FieldError>Pick your board.</FieldError>}
                  </Field>

                  {SENIOR_CLASSES.has(answers.schoolClass) && (
                    <Field label="Which stream?" required>
                      <ChipRow>
                        {STREAMS.map((st) => (
                          <Chip
                            key={st}
                            active={answers.stream === st}
                            onClick={() => patch({ stream: st })}
                            data-analytics-name="Exam setup stream chip"
                          >
                            {st}
                          </Chip>
                        ))}
                      </ChipRow>
                      {touched && !answers.stream && <FieldError>Pick your stream.</FieldError>}
                    </Field>
                  )}

                  <Field label="Which exam exactly?" hint="optional">
                    <ChipRow>
                      {(answers.kind === "board" ? BOARD_EXAM_TYPES : SCHOOL_EXAM_TYPES).map((t) => (
                        <Chip
                          key={t}
                          active={answers.schoolExamType === t}
                          onClick={() =>
                            patch({ schoolExamType: answers.schoolExamType === t ? "" : t })
                          }
                          data-analytics-name="Exam setup exam type chip"
                        >
                          {t}
                        </Chip>
                      ))}
                    </ChipRow>
                    <p className="mt-3 mb-2 text-xs font-medium text-muted-foreground">Medium of study</p>
                    <ChipRow>
                      {MEDIUMS.map((m) => (
                        <Chip
                          key={m}
                          active={answers.medium === m}
                          onClick={() => patch({ medium: answers.medium === m ? "" : m })}
                          data-analytics-name="Exam setup medium chip"
                        >
                          {m}
                        </Chip>
                      ))}
                    </ChipRow>
                  </Field>
                </>
              )}

              {answers.kind === "college" && (
                <>
                  <Field label="Which degree?" required>
                    <ChipRow>
                      {DEGREES.map((d) => (
                        <Chip
                          key={d}
                          active={answers.degree === d}
                          onClick={() => patch({ degree: d })}
                          data-analytics-name="Exam setup degree chip"
                        >
                          {d}
                        </Chip>
                      ))}
                    </ChipRow>
                    <Input
                      value={answers.degree}
                      maxLength={40}
                      onChange={(e) => patch({ degree: e.target.value })}
                      placeholder="Or type your degree"
                      className="mt-2 h-11 max-w-sm"
                      data-analytics-private
                    />
                    {touched && !answers.degree && <FieldError>Tell Aeva your degree.</FieldError>}
                  </Field>

                  <Field label="Semester and exam" hint="optional">
                    <ChipRow>
                      {SEMESTERS.map((sem) => (
                        <Chip
                          key={sem}
                          active={answers.semester === sem}
                          onClick={() => patch({ semester: answers.semester === sem ? "" : sem })}
                          data-analytics-name="Exam setup semester chip"
                        >
                          Sem {sem}
                        </Chip>
                      ))}
                    </ChipRow>
                    <ChipRow className="mt-3">
                      {COLLEGE_EXAM_TYPES.map((t) => (
                        <Chip
                          key={t}
                          active={answers.collegeExamType === t}
                          onClick={() =>
                            patch({ collegeExamType: answers.collegeExamType === t ? "" : t })
                          }
                          data-analytics-name="Exam setup college exam type chip"
                        >
                          {t}
                        </Chip>
                      ))}
                    </ChipRow>
                    <Input
                      value={answers.university}
                      maxLength={80}
                      onChange={(e) => patch({ university: e.target.value })}
                      placeholder="University or college (helps find the exact syllabus)"
                      className="mt-3 h-11"
                      data-analytics-private
                    />
                  </Field>
                </>
              )}

              {answers.kind === "unit" && (
                <>
                  <Field label="Which subject?" required>
                    <ChipRow>
                      {UNIT_SUBJECTS.map((sub) => (
                        <Chip
                          key={sub}
                          active={answers.unitSubject === sub}
                          onClick={() => patch({ unitSubject: sub })}
                          data-analytics-name="Exam setup unit subject chip"
                        >
                          {sub}
                        </Chip>
                      ))}
                    </ChipRow>
                    <Input
                      value={answers.unitSubject}
                      maxLength={SUBJECT_LEN}
                      onChange={(e) => patch({ unitSubject: e.target.value })}
                      placeholder="Or type the subject"
                      className="mt-2 h-11 max-w-sm"
                      data-analytics-private
                    />
                    {touched && !answers.unitSubject.trim() && (
                      <FieldError>Tell Aeva the subject.</FieldError>
                    )}
                  </Field>

                  <Field label="Chapters or units to cover" hint="optional">
                    <Input
                      value={answers.unitChapters}
                      maxLength={120}
                      onChange={(e) => patch({ unitChapters: e.target.value })}
                      placeholder="e.g. Chapters 3–5: Motion, Force, Gravitation"
                      className="h-11"
                      data-analytics-private
                    />
                  </Field>

                  <Field label="Your level" hint="optional">
                    <ChipRow>
                      {UNIT_LEVELS.map((lvl) => (
                        <Chip
                          key={lvl}
                          active={answers.unitLevel === lvl}
                          onClick={() => patch({ unitLevel: answers.unitLevel === lvl ? "" : lvl })}
                          data-analytics-name="Exam setup unit level chip"
                        >
                          {lvl}
                        </Chip>
                      ))}
                    </ChipRow>
                  </Field>
                </>
              )}

              {answers.kind === "other" && (
                <Field label="Which exam is it?" required>
                  <Input
                    value={answers.customExamName}
                    maxLength={EXAM_NAME_LEN}
                    onChange={(e) => patch({ customExamName: e.target.value })}
                    placeholder="e.g. IELTS Academic, Olympiad, company placement test"
                    className="h-11"
                    data-analytics-private
                  />
                  {touched && !answers.customExamName.trim() && (
                    <FieldError>Tell Aeva the exam name.</FieldError>
                  )}
                </Field>
              )}

              {unsupported && (
                <GlassCard
                  role="alert"
                  data-field
                  className="flex gap-3 border-amber-500/30 bg-amber-500/10 p-4"
                >
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="min-w-0 text-sm">
                    <p className="font-semibold">
                      {unsupported} preparation isn't available yet
                    </p>
                    <p className="mt-1 text-muted-foreground">
                      {UNSUPPORTED_EXAM_NOTE} You can still plan one subject or
                      a few chapters of it: pick{" "}
                      <button
                        type="button"
                        onClick={() => pickKind("unit")}
                        className="font-semibold text-brand-1 underline-offset-2 hover:underline"
                        data-analytics-name="Exam setup switch to unit"
                      >
                        One subject or unit
                      </button>
                      .
                    </p>
                  </div>
                </GlassCard>
              )}

              {answers.kind && answers.kind !== "other" && kindAnswersComplete(answers) && (
                <Field label="Exam name" hint="edit if needed">
                  <Input
                    value={examName}
                    maxLength={EXAM_NAME_LEN}
                    onChange={(e) => {
                      nameAuto.current = false;
                      setExamName(e.target.value);
                    }}
                    className="h-11"
                    data-analytics-private
                  />
                  {touched && !examName.trim() && <FieldError>Tell Aeva the exam name.</FieldError>}
                </Field>
              )}

              {answers.kind && (
                <Field
                  label="Anything specific?"
                  hint="optional"
                  description="Chapters already done, weak areas, paper or attempt details — Aeva uses it to research exactly what you need."
                >
                  <Textarea
                    value={answers.details}
                    maxLength={200}
                    onChange={(e) => patch({ details: e.target.value })}
                    rows={2}
                    placeholder="e.g. Only Physics and Chemistry; Mechanics is done; weak in Organic"
                    className="min-h-[4.5rem] text-base sm:text-sm"
                    data-analytics-private
                  />
                </Field>
              )}

              <Field label="Exam date" required>
                <Input
                  type="date"
                  min={today}
                  value={examDate}
                  onChange={(e) => setExamDate(e.target.value)}
                  className="h-11 max-w-xs"
                />
                {daysUntil !== null && daysUntil >= 0 && (
                  <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
                    {daysUntil === 0
                      ? "That's today — Aeva will plan a focused last-day revision."
                      : `${daysUntil} day${daysUntil === 1 ? "" : "s"} from today${daysUntil > 60 ? " — the plan covers the next 60 days first" : ""}.`}
                  </p>
                )}
                {touched && (!examDate || (daysUntil !== null && daysUntil < 0)) && (
                  <FieldError>Pick a date from today onwards.</FieldError>
                )}
              </Field>

              <GlassCard className="flex items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="font-display text-sm font-bold">Research the official syllabus</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Aeva looks up the exact units, weightage and paper pattern for your exam online before planning. Adds about a minute.
                  </p>
                </div>
                <Switch
                  checked={research}
                  onCheckedChange={setResearch}
                  aria-label="Research the official syllabus online"
                  data-analytics-name="Exam setup research toggle"
                />
              </GlassCard>
            </>
          )}

          {step === 2 && (
            <>
              <Field
                label="Subjects to cover"
                required
                hint={`${subjects.length}/${SUBJECT_MAX}`}
              >
                <ChipRow data-analytics-private data-analytics-section="exam_setup_subjects">
                  {suggestedSubjects.map((s) => (
                    <Chip
                      key={s}
                      active={subjects.includes(s)}
                      onClick={() => toggleSubject(s)}
                      data-analytics-name="Exam setup subject chip"
                    >
                      {s}
                    </Chip>
                  ))}
                </ChipRow>
                <div className="mt-2 flex gap-2">
                  <Input
                    value={customSubject}
                    maxLength={SUBJECT_LEN}
                    onChange={(e) => setCustomSubject(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addCustomSubject();
                      }
                    }}
                    placeholder="Add a subject"
                    className="h-11 min-w-0 flex-1"
                    data-analytics-private
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={addCustomSubject}
                    disabled={!customSubject.trim()}
                    aria-label="Add subject"
                    data-analytics-name="Exam setup add subject"
                    className="h-11 w-11 shrink-0 p-0"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                {touched && subjects.length === 0 && (
                  <FieldError>Pick at least one subject.</FieldError>
                )}
              </Field>

              <Field label="Daily study time" required>
                <ChipRow>
                  {MINUTE_CHIPS.map((m) => (
                    <Chip
                      key={m}
                      active={dailyMinutes === m}
                      onClick={() => {
                        setDailyMinutes(m);
                        setCustomMinutes("");
                      }}
                      data-analytics-name="Exam setup minutes chip"
                    >
                      {m < 60 ? `${m} min` : `${m / 60} h${m % 60 ? ` ${m % 60} min` : ""}`}
                    </Chip>
                  ))}
                  <Chip
                    active={dailyMinutes === null}
                    onClick={() => setDailyMinutes(null)}
                    data-analytics-name="Exam setup minutes custom"
                  >
                    Custom
                  </Chip>
                </ChipRow>
                {dailyMinutes === null && (
                  <div className="mt-2 flex items-center gap-2">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={MIN_MINUTES}
                      max={MAX_MINUTES}
                      value={customMinutes}
                      onChange={(e) => setCustomMinutes(e.target.value)}
                      placeholder="e.g. 75"
                      className="h-11 w-32"
                    />
                    <span className="text-sm text-muted-foreground">minutes a day</span>
                  </div>
                )}
                {touched && !minutesValid && (
                  <FieldError>
                    Choose between {MIN_MINUTES} and {MAX_MINUTES} minutes a day.
                  </FieldError>
                )}
              </Field>

              <Field label="Target score" hint="optional">
                <Input
                  value={targetScore}
                  maxLength={40}
                  onChange={(e) => setTargetScore(e.target.value)}
                  placeholder="e.g. 95%, 650+, top 1000 rank"
                  className="h-11 max-w-sm"
                  data-analytics-private
                />
              </Field>
            </>
          )}

          {step === 3 && (
            <>
              <Field
                label="Syllabus or topics"
                hint={`optional · ${syllabus.length}/${SYLLABUS_MAX}`}
              >
                <Textarea
                  value={syllabus}
                  maxLength={SYLLABUS_MAX}
                  onChange={(e) => setSyllabus(e.target.value)}
                  rows={6}
                  placeholder="Paste your syllabus, chapter list or the topics you must cover. Aeva uses it to name the exact units in your plan."
                  className="min-h-[9rem] text-base sm:text-sm"
                  data-analytics-private
                />
              </Field>

              <Field
                label="Study material"
                hint="optional"
                description="Quizzes and flashcards are grounded in the files you add."
              >
                <input
                  ref={fileRef}
                  type="file"
                  accept={UPLOAD_ACCEPT}
                  multiple
                  className="hidden"
                  onChange={(e) => void onPickFiles(e)}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileRef.current?.click()}
                  data-analytics-name="Exam setup upload"
                  className="h-11 w-full gap-2 sm:w-auto"
                >
                  <Upload className="h-4 w-4" /> Upload PDF or image
                </Button>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Up to {getMaxUploadMb()} MB per file.
                </p>

                {(uploads.length > 0 || readyMedia.length > 0) && (
                  <ul
                    className="mt-3 divide-y divide-border/50 overflow-hidden rounded-xl border border-border/50"
                    data-analytics-private
                    data-analytics-section="exam_setup_material"
                  >
                    {uploads.map((u) => (
                      <li key={u.id} className="flex items-center gap-3 px-3 py-2.5">
                        <FileIcon name={u.name} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{u.name}</p>
                          <p
                            className={cn(
                              "text-xs",
                              u.status === "failed"
                                ? "text-red-600 dark:text-red-400"
                                : "text-muted-foreground",
                            )}
                          >
                            {u.status === "uploading" && "Uploading…"}
                            {u.status === "processing" && `Indexing… ${u.pct}%`}
                            {u.status === "ready" && "Ready · added to your plan"}
                            {u.status === "failed" && (u.message || "Upload failed")}
                          </p>
                          {(u.status === "uploading" || u.status === "processing") && (
                            <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-secondary">
                              <div
                                className="h-full origin-left rounded-full bg-brand-1 transition-transform duration-300"
                                style={{ transform: `scaleX(${Math.max(u.pct, 4) / 100})` }}
                              />
                            </div>
                          )}
                        </div>
                        {u.status === "ready" ? (
                          <Check className="h-4 w-4 shrink-0 text-emerald-500" />
                        ) : u.status === "failed" ? (
                          <button
                            type="button"
                            aria-label="Dismiss"
                            onClick={() =>
                              setUploads((prev) => prev.filter((x) => x.id !== u.id))
                            }
                            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-accent"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        ) : (
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                        )}
                      </li>
                    ))}
                    {readyMedia.map((m) => {
                      const checked = selectedMedia.has(m.id);
                      return (
                        <li key={m.id}>
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={checked}
                            onClick={() => toggleMedia(m.id)}
                            data-analytics-name="Exam setup material toggle"
                            className="flex min-h-[48px] w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-accent/50"
                          >
                            <FileIcon name={m.file_name} mime={m.mime_type} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">
                                {m.file_name}
                              </span>
                              {m.page_count ? (
                                <span className="block text-xs text-muted-foreground">
                                  {m.page_count} page{m.page_count === 1 ? "" : "s"}
                                </span>
                              ) : null}
                            </span>
                            <span
                              className={cn(
                                "grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors",
                                checked
                                  ? "border-brand-1 bg-brand-1 text-white"
                                  : "border-border",
                              )}
                            >
                              {checked && <Check className="h-3.5 w-3.5" />}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {uploadsInFlight && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Files still indexing are left out if you create the plan now.
                  </p>
                )}
              </Field>
            </>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Action row: fixed above the bottom nav on phones (bottom-0 when the
          keyboard is open and the nav hides); sticky at the bottom on
          desktop. The form's bottom padding keeps content clear of it. */}
      <div
        className={cn(
          "fixed inset-x-0 z-30 flex flex-wrap gap-2 border-t border-border/50 bg-background/85 px-4 pb-3 pt-3 backdrop-blur",
          "bottom-[calc(3.75rem+env(safe-area-inset-bottom))]",
          "[[data-kb-open='1']_&]:bottom-0",
          "lg:sticky lg:inset-x-auto lg:bottom-0 lg:-mx-4 lg:mt-6",
        )}
      >
        {/* Why Continue did not move on: always on screen next to the button
            (the field errors above may be scrolled out of view), on touch and
            mouse alike. */}
        {showMissing && (
          <motion.p
            role="status"
            aria-live="polite"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="flex w-full items-start gap-1.5 text-xs leading-snug text-red-600 [overflow-wrap:anywhere] dark:text-red-400"
          >
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>Still needed: {missing.map((m) => m.label).join(", ")}.</span>
          </motion.p>
        )}
        {step > 1 && (
          <Button
            type="button"
            variant="outline"
            onClick={back}
            data-analytics-name="Exam setup back"
            className="h-12 shrink-0 gap-1.5 px-4"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
        )}
        {step < 3 ? (
          <Button
            type="button"
            variant="brand"
            onClick={next}
            data-analytics-name="Exam setup continue"
            className="h-12 flex-1 gap-1.5"
          >
            Continue <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            type="button"
            variant="brand"
            onClick={() => void submit()}
            disabled={create.isPending}
            data-analytics-name="Exam setup create plan"
            className="h-12 flex-1 gap-2"
          >
            <Sparkles className="h-4 w-4" /> Create my plan
          </Button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ small pieces ------------------------------ */

const STEP_LABELS = ["Exam", "Subjects & time", "Material"];

function StepIndicator({ step }: { step: Step }) {
  const last = STEP_LABELS.length;
  return (
    <ol className="flex w-full items-start" aria-label={`Step ${step} of ${last}`}>
      {STEP_LABELS.map((label, i) => {
        const n = i + 1;
        const done = n < step;
        const active = n === step;
        return (
          <li
            key={label}
            className="relative flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center"
          >
            {/* Connector halves, so the line meets the circles exactly. */}
            {n > 1 && (
              <span
                aria-hidden
                className={cn(
                  "absolute left-0 right-1/2 top-3 h-0.5 -translate-y-1/2",
                  done || active ? "bg-emerald-500" : "bg-border",
                )}
              />
            )}
            {n < last && (
              <span
                aria-hidden
                className={cn(
                  "absolute left-1/2 right-0 top-3 h-0.5 -translate-y-1/2",
                  done ? "bg-emerald-500" : "bg-border",
                )}
              />
            )}
            <span
              className={cn(
                "relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold transition-colors",
                done
                  ? "bg-emerald-500 text-white"
                  : active
                    ? "bg-brand-1 text-white ring-4 ring-brand-1/15"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : n}
            </span>
            <span
              className={cn(
                "w-full truncate px-1 text-[11px] font-medium sm:text-xs",
                active ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Field({
  label,
  hint,
  description,
  required,
  children,
}: {
  label: string;
  hint?: string;
  description?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <GlassCard className="p-4" data-field>
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <p className="font-display text-sm font-bold">
          {label}
          {required && <span className="ml-0.5 text-brand-1">*</span>}
        </p>
        {hint && (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {hint}
          </span>
        )}
      </div>
      {description && (
        <p className="-mt-1 mb-2.5 text-xs text-muted-foreground">{description}</p>
      )}
      {children}
    </GlassCard>
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
}: React.HTMLAttributes<HTMLDivElement>) {
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
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
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
      {active && <Check className="h-3.5 w-3.5 shrink-0" />}
      <span className="truncate">{children}</span>
    </button>
  );
}

function FileIcon({ name, mime }: { name: string; mime?: string }) {
  const isImage = mime ? mime.startsWith("image/") : /\.(png|jpe?g|webp|gif)$/i.test(name);
  const Icon = isImage ? ImageIcon : FileText;
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-1/10 text-brand-1">
      <Icon className="h-4 w-4" />
    </span>
  );
}
