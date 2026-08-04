// Developer Mode diagnostics, rendered under an assistant answer — only ever
// mounted for admin-flagged debug users (gate on `useAuth().isDebugUser`
// before rendering). Collapsed by default so debugging never crowds the
// conversation.

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bug, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ResponseDebugInfo } from "@/types";

/** Human explanation of how the orchestrator picked the tool. */
const PLAN_SOURCE_LABEL: Record<string, string> = {
  planner: "planner LLM decision",
  fast_path: "deterministic fast path (no planner call)",
  continuation: "repeat of the previous generator tool",
  forced: "forced by user action (file choice / setup form)",
  media_choice: "resolved from a file clarification",
};

/** Keys given labeled rows below; anything else renders in "Other". */
const KNOWN_KEYS = new Set([
  "tool",
  "model",
  "model_config_key",
  "plan_source",
  "plan_action",
  "clarification_round",
  "history_messages",
  "media_count",
  "planning_ms",
  "tool_ms",
  "total_ms",
  "streamed",
]);

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="truncate text-right font-medium">{value}</dd>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
        {title}
      </p>
      <dl className="space-y-1">{children}</dl>
    </div>
  );
}

const ms = (v?: number) => (typeof v === "number" ? `${v} ms` : undefined);
const bool = (v?: boolean) =>
  typeof v === "boolean" ? (v ? "yes" : "no") : undefined;

export function DebugInfoPanel({ debug }: { debug: ResponseDebugInfo }) {
  const [open, setOpen] = useState(false);

  const extras = Object.entries(debug).filter(
    ([k, v]) => !KNOWN_KEYS.has(k) && v !== undefined && v !== null,
  );
  const planSource = debug.plan_source
    ? (PLAN_SOURCE_LABEL[debug.plan_source] ?? debug.plan_source)
    : undefined;

  return (
    <div className="mt-3 rounded-xl border border-dashed border-amber-500/40 bg-amber-500/[0.04] text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left font-medium text-amber-600 transition-colors hover:text-amber-500 dark:text-amber-400"
      >
        <Bug className="h-3.5 w-3.5 shrink-0" />
        Developer
        {debug.total_ms != null && (
          <span className="font-normal text-muted-foreground">
            · {debug.total_ms} ms
          </span>
        )}
        {debug.model && (
          <span className="hidden truncate font-normal text-muted-foreground sm:inline">
            · {debug.model}
          </span>
        )}
        <ChevronDown
          className={cn(
            "ml-auto h-3.5 w-3.5 shrink-0 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="grid gap-3 border-t border-dashed border-amber-500/30 px-3 py-2.5 font-mono text-[11px] sm:grid-cols-2">
              <Section title="Response">
                <Row label="Tool" value={debug.tool} />
                <Row label="Model" value={debug.model} />
                <Row label="Config key" value={debug.model_config_key} />
                <Row label="Streamed" value={bool(debug.streamed)} />
              </Section>
              <Section title="Orchestrator">
                <Row label="Tool chosen via" value={planSource} />
                <Row label="Plan action" value={debug.plan_action} />
                <Row
                  label="Clarification round"
                  value={bool(debug.clarification_round)}
                />
              </Section>
              <Section title="Context">
                <Row
                  label="History messages"
                  value={debug.history_messages}
                />
                <Row label="Media attached" value={debug.media_count} />
              </Section>
              <Section title="Timing">
                <Row label="Planning" value={ms(debug.planning_ms)} />
                <Row label="Tool run" value={ms(debug.tool_ms)} />
                <Row label="Total" value={ms(debug.total_ms)} />
              </Section>
              {extras.length > 0 && (
                <div className="sm:col-span-2">
                  <Section title="Other">
                    {extras.map(([k, v]) => (
                      <Row
                        key={k}
                        label={k}
                        value={
                          typeof v === "object" ? JSON.stringify(v) : String(v)
                        }
                      />
                    ))}
                  </Section>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
