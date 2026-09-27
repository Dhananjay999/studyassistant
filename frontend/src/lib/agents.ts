// Presentation of the assistant's agents: the single place that names each
// tool for the student. The backend only reports WHICH tools run (ids); how
// they look and read — label, icon, the verb shown while working — is a
// frontend decision, shared by the agent workboard, the thinking indicator
// and the debug badges. Labels never contain user content, so they are safe
// as analytics names.

import {
  BookOpenCheck,
  FileText,
  Globe,
  Layers,
  LifeBuoy,
  ListChecks,
  Palette,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { AgentInfo, AgentStatus, ToolUsed } from "@/types";

export interface AgentMeta {
  /** Name shown on the card ("Quiz agent"). */
  label: string;
  /** Short noun for summaries ("Quiz"). */
  short: string;
  /** What it is doing, while running. */
  verb: string;
  icon: LucideIcon;
  /** Tailwind classes for the icon tile (background + text colour). */
  accent: string;
}

export const AGENT_META: Record<ToolUsed, AgentMeta> = {
  general: {
    label: "Tutor",
    short: "Answer",
    verb: "Writing the answer",
    icon: Sparkles,
    accent: "bg-brand-1/10 text-brand-1",
  },
  product_info: {
    label: "App guide",
    short: "App guide",
    verb: "Looking up the app",
    icon: LifeBuoy,
    accent: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  },
  web_search: {
    label: "Research agent",
    short: "Research",
    verb: "Searching the web",
    icon: Globe,
    accent: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  },
  media_llm: {
    label: "Notes agent",
    short: "Notes",
    verb: "Reading your files",
    icon: FileText,
    accent: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  quiz_generator: {
    label: "Quiz agent",
    short: "Quiz",
    verb: "Building your quiz",
    icon: ListChecks,
    accent: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  },
  flashcard_generator: {
    label: "Flashcard agent",
    short: "Flashcards",
    verb: "Making flashcards",
    icon: Layers,
    accent: "bg-pink-500/10 text-pink-600 dark:text-pink-400",
  },
  image_generator: {
    label: "Illustrator",
    short: "Image",
    verb: "Drawing your image",
    icon: Palette,
    accent: "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  },
};

const FALLBACK: AgentMeta = {
  label: "Agent",
  short: "Agent",
  verb: "Working",
  icon: BookOpenCheck,
  accent: "bg-muted text-muted-foreground",
};

export function agentMeta(tool: string | undefined): AgentMeta {
  return (tool && AGENT_META[tool as ToolUsed]) || FALLBACK;
}

export const AGENT_STATUS_LABEL: Record<AgentStatus, string> = {
  queued: "Queued",
  running: "Working…",
  done: "Done",
  failed: "Failed",
};

const STATUSES: ReadonlySet<string> = new Set([
  "queued",
  "running",
  "done",
  "failed",
]);

/** Normalize a backend agent roster (frames or persisted metadata). */
export function normalizeAgents(raw: unknown): AgentInfo[] {
  if (!Array.isArray(raw)) return [];
  const agents: AgentInfo[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    if (typeof a.id !== "string" || typeof a.tool !== "string") continue;
    agents.push({
      id: a.id,
      tool: a.tool as ToolUsed,
      kind: a.kind === "answer" ? "answer" : "generator",
      input: a.input === "answer" ? "answer" : "message",
      purpose: typeof a.purpose === "string" ? a.purpose : undefined,
      status:
        typeof a.status === "string" && STATUSES.has(a.status)
          ? (a.status as AgentStatus)
          : "queued",
      ms: typeof a.ms === "number" ? a.ms : undefined,
      note: typeof a.note === "string" ? a.note : undefined,
      error: typeof a.error === "string" ? a.error : undefined,
    });
  }
  return agents;
}

/** "14 s" / "1 m 05 s" for agent timers. */
export function formatAgentTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total} s`;
  const m = Math.floor(total / 60);
  const s = String(total % 60).padStart(2, "0");
  return `${m} m ${s} s`;
}
