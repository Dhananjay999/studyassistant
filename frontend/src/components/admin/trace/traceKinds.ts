// How each span kind and status looks in the trace explorer: an icon, a
// short label and a tone. Colour is spent on the steps a prompt author looks
// for (route, tool, prompt, LLM, retrieval); bookkeeping steps stay neutral,
// and red / amber are reserved for statuses.

import type { CSSProperties } from "react";
import {
  Ban,
  Binary,
  CircleAlert,
  CircleDashed,
  CircleSlash,
  ClockAlert,
  Database,
  FileCode2,
  FileSearch,
  type LucideIcon,
  MessageSquareText,
  Save,
  Signpost,
  Sparkles,
  Split,
  Wrench,
} from "lucide-react";

export interface KindMeta {
  label: string;
  icon: LucideIcon;
  /** Icon chip: text + tinted background. */
  chip: string;
  /** Timing bar fill. */
  bar: string;
}

const NEUTRAL_CHIP = "bg-muted text-muted-foreground";
const NEUTRAL_BAR = "bg-foreground/35";

const KINDS: Record<string, KindMeta> = {
  turn: {
    label: "Turn",
    icon: MessageSquareText,
    chip: "bg-foreground/10 text-foreground",
    bar: NEUTRAL_BAR,
  },
  context: {
    label: "Context",
    icon: Database,
    chip: NEUTRAL_CHIP,
    bar: NEUTRAL_BAR,
  },
  router: {
    label: "Router",
    icon: Split,
    chip: "bg-pink-500/15 text-pink-600 dark:text-pink-400",
    bar: "bg-pink-500",
  },
  decision: {
    label: "Decision",
    icon: Signpost,
    chip: NEUTRAL_CHIP,
    bar: NEUTRAL_BAR,
  },
  tool: {
    label: "Tool",
    icon: Wrench,
    chip: "bg-teal-500/15 text-teal-600 dark:text-teal-400",
    bar: "bg-teal-500",
  },
  prompt: {
    label: "Prompt",
    icon: FileCode2,
    chip: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
    bar: "bg-sky-500",
  },
  llm: {
    label: "LLM",
    icon: Sparkles,
    chip: "bg-violet-500/15 text-violet-600 dark:text-violet-400",
    bar: "bg-violet-500",
  },
  embedding: {
    label: "Embedding",
    icon: Binary,
    chip: "bg-lime-500/15 text-lime-700 dark:text-lime-400",
    bar: "bg-lime-500",
  },
  retrieval: {
    label: "Retrieval",
    icon: FileSearch,
    chip: "bg-lime-500/15 text-lime-700 dark:text-lime-400",
    bar: "bg-lime-500",
  },
  persist: {
    label: "Persist",
    icon: Save,
    chip: NEUTRAL_CHIP,
    bar: NEUTRAL_BAR,
  },
};

/** Falls back to a neutral entry labelled with the raw kind. */
export function kindMeta(kind: string): KindMeta {
  return (
    KINDS[kind] ?? {
      label: kind || "Step",
      icon: CircleDashed,
      chip: NEUTRAL_CHIP,
      bar: NEUTRAL_BAR,
    }
  );
}

export interface StatusMeta {
  label: string;
  icon: LucideIcon;
  /** Badge classes (background + text). */
  badge: string;
  bar: string;
}

const RED = "bg-red-500/15 text-red-600 dark:text-red-400";
const AMBER = "bg-amber-500/15 text-amber-600 dark:text-amber-400";

const SPAN_STATUSES: Record<string, StatusMeta> = {
  error: { label: "error", icon: CircleAlert, badge: RED, bar: "bg-red-500" },
  timeout: {
    label: "timeout",
    icon: ClockAlert,
    badge: AMBER,
    bar: "bg-amber-500",
  },
  aborted: { label: "aborted", icon: Ban, badge: AMBER, bar: "bg-amber-500" },
  unfinished: {
    label: "unfinished",
    icon: CircleDashed,
    badge: AMBER,
    bar: "bg-amber-500",
  },
  running: {
    label: "unfinished",
    icon: CircleDashed,
    badge: AMBER,
    bar: "bg-amber-500",
  },
  skipped: {
    label: "skipped",
    icon: CircleSlash,
    badge: "bg-muted text-muted-foreground",
    bar: "bg-foreground/20",
  },
};

/** `null` for "ok": a clean step carries no badge. */
export function spanStatusMeta(status: string): StatusMeta | null {
  if (!status || status === "ok") return null;
  return (
    SPAN_STATUSES[status] ?? {
      label: status,
      icon: CircleDashed,
      badge: "bg-muted text-muted-foreground",
      bar: NEUTRAL_BAR,
    }
  );
}

const TRACE_STATUS_TONE: Record<string, string> = {
  completed: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  partial: AMBER,
  clarification: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  quiz_setup: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  error: RED,
  aborted: AMBER,
};

export function traceStatusTone(status: string): string {
  return TRACE_STATUS_TONE[status] ?? "";
}

export const TRACE_STATUSES = [
  "completed",
  "partial",
  "clarification",
  "quiz_setup",
  "error",
  "aborted",
] as const;

// What each trace status means, in the words used wherever one is shown.
const TRACE_STATUS_NOTE: Record<string, string> = {
  completed: "answered",
  partial: "answered, but a step failed or timed out",
  clarification: "asked the user to clarify",
  quiz_setup: "opened the quiz setup",
  error: "the turn failed",
  aborted: "stopped before it finished",
};

/** `null` for a status this build does not know. */
export function traceStatusNote(status: string): string | null {
  return TRACE_STATUS_NOTE[status] ?? null;
}

/** Statuses whose trace carries an `error` text worth showing beside it. */
export function traceStatusHasProblem(status: string): boolean {
  return status === "partial" || status === "error" || status === "aborted";
}

/** Routes the orchestrator can take (`plan_source`), in cascade order. */
export const PLAN_SOURCES: { value: string; label: string }[] = [
  { value: "forced", label: "forced (user action)" },
  { value: "media_choice", label: "media_choice (file clarification)" },
  { value: "continuation", label: "continuation (repeat generator)" },
  { value: "fast_path", label: "fast_path (no planner call)" },
  { value: "planner", label: "planner (LLM decision)" },
  { value: "planner+media_guard", label: "planner+media_guard" },
];

/**
 * Scrollbars are hidden app-wide (`index.css`). A scrollable pane in the
 * trace explorer opts back in with this inline style so it is visibly
 * scrollable: long prompts are read here.
 */
export const VISIBLE_SCROLLBAR: CSSProperties = {
  scrollbarWidth: "thin",
  scrollbarColor: "hsl(var(--muted-foreground) / 0.5) transparent",
};
