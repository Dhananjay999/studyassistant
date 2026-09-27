// The agent workboard: what the student sees while several agents work on
// one request ("summarize my notes and make flashcards", "a quiz and
// flashcards on photosynthesis"). Instead of one spinner, every agent gets a
// card with its own status, latest progress note and timer, so it is visible
// that the quiz and the flashcards are being built at the same time, and that
// a dependent agent is waiting for the answer it will be built from.
//
// Live: expanded, with an overall progress bar. Finished: collapses to a one
// line summary ("3 agents worked together · Notes · Quiz · Flashcards · 14 s")
// that expands on demand — and is what a reloaded conversation shows, from
// the roster persisted with the message. A failed agent keeps the board open
// and offers a visible Retry.

import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clock,
  RotateCcw,
  Users,
} from "lucide-react";
import { AGENT_STATUS_LABEL, agentMeta, formatAgentTime } from "@/lib/agents";
import { cn } from "@/lib/utils";
import type { AgentInfo, AgentStatus } from "@/types";

const EASE = [0.22, 1, 0.36, 1] as const;

/** Ticks while agents are running, to drive their live timers. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

const PILL: Record<AgentStatus, string> = {
  queued: "bg-muted text-muted-foreground",
  running: "bg-brand-1/10 text-brand-1",
  done: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  failed: "bg-destructive/10 text-destructive",
};

function StatusPill({ status, reduce }: { status: AgentStatus; reduce: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
        PILL[status],
      )}
    >
      {status === "queued" && <Clock className="h-2.5 w-2.5" aria-hidden />}
      {status === "running" && (
        <span
          aria-hidden
          className={cn(
            "h-1.5 w-1.5 rounded-full bg-current",
            !reduce && "animate-pulse",
          )}
        />
      )}
      {status === "done" && (
        <motion.span
          aria-hidden
          initial={reduce ? false : { scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 420, damping: 20 }}
          className="inline-flex"
        >
          <Check className="h-2.5 w-2.5" />
        </motion.span>
      )}
      {status === "failed" && (
        <AlertTriangle className="h-2.5 w-2.5" aria-hidden />
      )}
      {AGENT_STATUS_LABEL[status]}
    </span>
  );
}

function AgentCard({
  agent,
  now,
  reduce,
  onRetry,
}: {
  agent: AgentInfo;
  now: number;
  reduce: boolean;
  onRetry?: (agent: AgentInfo) => void;
}) {
  const meta = agentMeta(agent.tool);
  const Icon = meta.icon;
  const running = agent.status === "running";
  const elapsed =
    running && agent.startedAt ? now - agent.startedAt : agent.ms;
  const line =
    agent.status === "failed"
      ? "Couldn't finish this one"
      : agent.status === "queued"
        ? agent.input === "answer"
          ? "Waiting for the answer…"
          : "Starting…"
        : agent.note || (running ? `${meta.verb}…` : meta.verb);

  return (
    <motion.li
      layout={!reduce}
      initial={reduce ? false : { opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3, ease: EASE }}
      className={cn(
        "relative overflow-hidden rounded-xl border bg-background/70 p-2.5",
        running && "border-brand-1/40",
        agent.status === "done" && "border-emerald-500/30",
        agent.status === "failed" && "border-destructive/40",
        agent.status === "queued" && "border-border/60 opacity-80",
      )}
    >
      <div className="flex items-start gap-2.5">
        <span
          className={cn(
            "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
            meta.accent,
          )}
        >
          <Icon
            aria-hidden
            className={cn("h-4 w-4", running && !reduce && "animate-pulse")}
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-xs font-semibold">{meta.label}</p>
            <StatusPill status={agent.status} reduce={reduce} />
          </div>
          <div className="mt-0.5 h-4 overflow-hidden">
            <AnimatePresence mode="wait" initial={false}>
              <motion.p
                key={line}
                initial={reduce ? false : { y: 6, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={reduce ? undefined : { y: -6, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="truncate text-[11px] text-muted-foreground"
              >
                {line}
              </motion.p>
            </AnimatePresence>
          </div>
        </div>
        {typeof elapsed === "number" && elapsed > 0 && (
          <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
            {formatAgentTime(elapsed)}
          </span>
        )}
      </div>

      {running && (
        <div
          aria-hidden
          className={cn(
            "mt-2 h-1 rounded-full bg-gradient-to-r from-brand-1/15 via-brand-1/70 to-brand-1/15 bg-[length:200%_100%]",
            !reduce && "motion-loop animate-shimmer",
          )}
        />
      )}

      {agent.status === "failed" && onRetry && (
        <button
          type="button"
          onClick={() => onRetry(agent)}
          data-analytics-name="Retry agent"
          className="touch-target mt-1.5 inline-flex items-center gap-1 rounded-full px-2 text-[11px] font-semibold text-brand-1 hover:underline"
        >
          <RotateCcw className="h-3 w-3" aria-hidden />
          Retry
        </button>
      )}
    </motion.li>
  );
}

function AgentGroup({
  title,
  agents,
  now,
  reduce,
  onRetry,
}: {
  title?: string;
  agents: AgentInfo[];
  now: number;
  reduce: boolean;
  onRetry?: (agent: AgentInfo) => void;
}) {
  if (agents.length === 0) return null;
  return (
    <div className="mt-2.5">
      {title && (
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
          {title}
        </p>
      )}
      <ul className="grid gap-2 sm:grid-cols-2">
        {agents.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            now={now}
            reduce={reduce}
            onRetry={onRetry}
          />
        ))}
      </ul>
    </div>
  );
}

/** Wall-clock estimate: the parallel group, then the dependent group. */
function teamTime(agents: AgentInfo[]): number {
  const longest = (list: AgentInfo[]) =>
    list.reduce((max, a) => Math.max(max, a.ms ?? 0), 0);
  const first = agents.filter(
    (a) => a.kind === "answer" || a.input === "message",
  );
  const next = agents.filter(
    (a) => a.kind === "generator" && a.input === "answer",
  );
  return longest(first) + longest(next);
}

export function AgentWorkboard({
  agents,
  live,
  onRetry,
}: {
  agents: AgentInfo[];
  /** The turn is still streaming (agents may still be running). */
  live: boolean;
  onRetry?: (agent: AgentInfo) => void;
}) {
  const reduce = !!useReducedMotion();
  const total = agents.length;
  const done = agents.filter((a) => a.status === "done").length;
  const failed = agents.filter((a) => a.status === "failed").length;
  const settled = done + failed;

  // Open while the team works; afterwards collapse to the summary — unless
  // an agent failed (Retry must stay visible) or the student opened it.
  const [touched, setTouched] = useState(false);
  const [expanded, setExpanded] = useState(live || failed > 0);
  useEffect(() => {
    if (live) setExpanded(true);
    else if (!touched) setExpanded(failed > 0);
  }, [live, failed, touched]);

  const now = useNow(live);
  const first = agents.filter(
    (a) => a.kind === "answer" || a.input === "message",
  );
  const next = agents.filter(
    (a) => a.kind === "generator" && a.input === "answer",
  );
  const headline = live
    ? "Aeva's team is on it"
    : failed > 0
      ? `${done} of ${total} agents finished`
      : `${total} agents worked together`;
  const names = agents.map((a) => agentMeta(a.tool).short).join(" · ");
  const wall = teamTime(agents);
  const subline = live
    ? `${settled} of ${total} done`
    : `${names}${wall > 0 ? ` · ${formatAgentTime(wall)}` : ""}`;

  return (
    <section
      aria-label="Agents working on this request"
      data-analytics-section="agent_workboard"
      className="not-prose mt-3 rounded-2xl border border-brand-1/20 bg-brand-1/[0.03] p-2.5"
    >
      <button
        type="button"
        onClick={() => {
          setTouched(true);
          setExpanded((v) => !v);
        }}
        aria-expanded={expanded}
        data-analytics-name="Toggle agent workboard"
        className="flex w-full items-center gap-2 text-left"
      >
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-gradient text-white">
          <Users className="h-3.5 w-3.5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold">
            {headline}
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {subline}
          </span>
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>

      {live && (
        <div
          role="progressbar"
          aria-label="Agents finished"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={settled}
          className="mt-2 h-1 overflow-hidden rounded-full bg-muted"
        >
          <motion.div
            className="h-full rounded-full bg-brand-gradient"
            initial={false}
            animate={{ width: `${(settled / Math.max(total, 1)) * 100}%` }}
            transition={{ duration: reduce ? 0 : 0.4, ease: EASE }}
          />
        </div>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {`${settled} of ${total} agents finished`}
      </p>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduce ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: EASE }}
            className="overflow-hidden"
          >
            <AgentGroup
              title={first.length > 1 ? "Working in parallel" : undefined}
              agents={first}
              now={now}
              reduce={reduce}
              onRetry={onRetry}
            />
            <AgentGroup
              title={next.length > 0 ? "Then, from the answer" : undefined}
              agents={next}
              now={now}
              reduce={reduce}
              onRetry={onRetry}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
