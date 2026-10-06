// Small formatting helpers for the Exam Prep screens. Class maps are literal
// strings so Tailwind's JIT keeps them (see lib/spaces.ts for the same rule).

import type {
  ExamDashboard,
  ExamDaySummary,
  ExamTopic,
  ExamTopicStatus,
} from "@/types";

/** Parse a `yyyy-mm-dd` plan date as a LOCAL date (no timezone shift). */
export function parsePlanDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return new Date(iso);
  return new Date(y, m - 1, d);
}

/** Today's date as `yyyy-mm-dd` in the device's timezone (date inputs). */
export function isoToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** "Mon, 12 Oct" (short) or "Monday, 12 October 2026" (long). */
export function formatPlanDate(
  iso: string,
  style: "short" | "long" = "short",
): string {
  const date = parsePlanDate(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(
    undefined,
    style === "long"
      ? { weekday: "long", day: "numeric", month: "long", year: "numeric" }
      : { weekday: "short", day: "numeric", month: "short" },
  );
}

export type ExamDayState = "upcoming" | "today" | "passed";

/** Whether the exam is ahead, today, or already behind the student. */
export function examDayState(
  examDate: string,
  daysRemaining: number,
): ExamDayState {
  if (daysRemaining > 0) return "upcoming";
  return parsePlanDate(examDate) < parsePlanDate(isoToday())
    ? "passed"
    : "today";
}

/** Hero copy for the countdown: "12 days left" / "Exam day!" / "Exam passed". */
export function daysRemainingLabel(
  daysRemaining: number,
  state: ExamDayState,
): string {
  if (state === "today") return "Exam day!";
  if (state === "passed") return "Exam passed";
  return `${daysRemaining} day${daysRemaining === 1 ? "" : "s"} left`;
}

/** "45 min" / "1 h 30 min" / "2 h". */
export function formatMinutes(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export const STATUS_ORDER: readonly ExamTopicStatus[] = [
  "not_started",
  "in_progress",
  "completed",
];

/** The status a tap on the indicator moves to (a 3-step cycle). */
export function nextStatus(status: ExamTopicStatus): ExamTopicStatus {
  const i = STATUS_ORDER.indexOf(status);
  return STATUS_ORDER[(i + 1) % STATUS_ORDER.length];
}

export const STATUS_LABEL: Record<ExamTopicStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Completed",
};

/** Tone classes per status (literal strings for the JIT). */
export const STATUS_TONE: Record<
  ExamTopicStatus,
  { dot: string; text: string; bg: string; ring: string }
> = {
  not_started: {
    dot: "bg-muted-foreground/40",
    text: "text-muted-foreground",
    bg: "bg-muted/60",
    ring: "border-border",
  },
  in_progress: {
    dot: "bg-amber-500",
    text: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-500/15",
    ring: "border-amber-500/40",
  },
  completed: {
    dot: "bg-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-500/15",
    ring: "border-emerald-500/40",
  },
};

/** Stable per-subject accent from a fixed palette (literal strings). */
const SUBJECT_TONES = [
  { text: "text-brand-1", bg: "bg-brand-1/10", bar: "bg-brand-1" },
  { text: "text-sky-500", bg: "bg-sky-500/10", bar: "bg-sky-500" },
  { text: "text-emerald-500", bg: "bg-emerald-500/10", bar: "bg-emerald-500" },
  { text: "text-amber-500", bg: "bg-amber-500/10", bar: "bg-amber-500" },
  { text: "text-rose-500", bg: "bg-rose-500/10", bar: "bg-rose-500" },
  { text: "text-violet-500", bg: "bg-violet-500/10", bar: "bg-violet-500" },
  { text: "text-teal-500", bg: "bg-teal-500/10", bar: "bg-teal-500" },
] as const;

export function subjectTone(subject: string) {
  let h = 0;
  for (let i = 0; i < subject.length; i++) {
    h = (h * 31 + subject.charCodeAt(i)) | 0;
  }
  return SUBJECT_TONES[Math.abs(h) % SUBJECT_TONES.length];
}

/** Percent completed, guarded against an empty denominator. */
export function percentOf(done: number, total: number): number {
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

/** "12:34" (mm:ss), or "1:02:03" past an hour, for the study timer. */
export function formatTimer(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** The day's topics flattened in display order (subject groups, plan order),
 * the same order the step numbers follow on every screen. */
export function dayTopics(day: ExamDaySummary): ExamTopic[] {
  return day.subjects.flatMap((s) => s.topics);
}

/** Minutes planned for a day (sum of its topics' estimates). */
export function dayMinutes(day: ExamDaySummary): number {
  return dayTopics(day).reduce((sum, t) => sum + (t.est_minutes || 0), 0);
}

/** The first topic of a day that is not completed, or null when the day is
 * done. `excludeTopicId` treats one topic as already completed (used right
 * after marking it, before the server copy catches up). */
export function nextTopicInDay(
  day: ExamDaySummary,
  excludeTopicId?: string,
): ExamTopic | null {
  for (const t of dayTopics(day)) {
    if (t.status !== "completed" && t.id !== excludeTopicId) return t;
  }
  return null;
}

export interface NextTopic {
  topic: ExamTopic;
  day: ExamDaySummary;
  isToday: boolean;
}

/** The next topic to study: today's first unfinished topic, else the first
 * unfinished topic of the next day in the plan (null when all are done).
 * `preferDayId` is tried first (the day the student is already in). */
export function nextTopic(
  dashboard: ExamDashboard,
  opts: { preferDayId?: string; excludeTopicId?: string } = {},
): NextTopic | null {
  const todayId = dashboard.today?.id ?? null;
  const pick = (day: ExamDaySummary | undefined | null): NextTopic | null => {
    if (!day) return null;
    const topic = nextTopicInDay(day, opts.excludeTopicId);
    return topic ? { topic, day, isToday: day.id === todayId } : null;
  };
  if (opts.preferDayId) {
    const found = pick(dashboard.days.find((d) => d.id === opts.preferDayId));
    if (found) return found;
  }
  const today = pick(dashboard.today);
  if (today) return today;
  // Days after today, then the whole plan (it may start later than today).
  for (const d of dashboard.upcoming) {
    const found = pick(d);
    if (found) return found;
  }
  for (const d of dashboard.days) {
    if (d.id === todayId) continue;
    const found = pick(d);
    if (found) return found;
  }
  return null;
}

/** "Today" / "Tomorrow" / "Day n" for a plan day relative to the device date. */
export function dayLabel(day: ExamDaySummary, isToday: boolean): string {
  if (isToday) return "Today";
  const date = parsePlanDate(day.date);
  const tomorrow = parsePlanDate(isoToday());
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (
    date.getFullYear() === tomorrow.getFullYear() &&
    date.getMonth() === tomorrow.getMonth() &&
    date.getDate() === tomorrow.getDate()
  ) {
    return "Tomorrow";
  }
  return `Day ${day.day_number}`;
}
