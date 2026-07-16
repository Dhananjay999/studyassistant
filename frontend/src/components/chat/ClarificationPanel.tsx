// Clarification 2.0: the planner returns its COMPLETE question plan in one
// response; this panel walks it one question at a time (progress, Back /
// Next / Skip), renders each answer input from the question's declared
// `input_type`, always offers an "Other" escape hatch, and submits every
// collected answer together in ONE request. No clarification business logic
// lives here — the panel just renders the schema it was given.

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronLeft, ChevronRight, HelpCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type {
  ClarificationAnswer,
  ClarificationData,
  ClarificationQuestion,
} from "@/types";

const OTHER = "__other__";

/** Normalized widget for a question: how options + custom input behave. */
type Widget =
  | "text"
  | "textarea"
  | "number"
  | "single" // one choice from options (chips/select/radio/dropdown)
  | "multi" // several choices from options
  | "binary"; // toggle / true-false

function widgetFor(q: ClarificationQuestion): Widget {
  switch (q.input_type) {
    case "long_text":
      return "textarea";
    case "number":
      return "number";
    case "multi_select":
      return "multi";
    case "toggle":
    case "true_false":
      return "binary";
    case "short_text":
      return "text";
    default:
      // single_select / dropdown / radio / chips — and any future type —
      // render as tappable options when options exist, else free text.
      return q.options?.length ? "single" : "text";
  }
}

/** Options for a binary question (fall back to Yes/No or True/False). */
function binaryOptions(q: ClarificationQuestion): string[] {
  if (q.options && q.options.length >= 2) return q.options.slice(0, 2);
  return q.input_type === "true_false" ? ["True", "False"] : ["Yes", "No"];
}

interface Draft {
  /** Selected option(s); may include the OTHER sentinel. */
  picked: string[];
  /** Free text (text widgets, or the Other input). */
  text: string;
}

const EMPTY_DRAFT: Draft = { picked: [], text: "" };

/** Final answer string for a question, or "" when unanswered. */
function draftAnswer(draft: Draft | undefined): string {
  if (!draft) return "";
  const picks = draft.picked
    .map((p) => (p === OTHER ? draft.text.trim() : p))
    .filter(Boolean);
  if (picks.length > 0) return picks.join(", ");
  return draft.picked.length > 0 ? "" : draft.text.trim();
}

export function ClarificationPanel({
  data,
  busy,
  onSubmit,
}: {
  data: ClarificationData;
  busy?: boolean;
  /** Called ONCE with all collected answers — or a skip when the user
   * dismisses/skips everything. Either way the turn proceeds to answer. */
  onSubmit: (answer: ClarificationAnswer) => void;
}) {
  const questions = data.questions;
  const total = questions.length;
  const [idx, setIdx] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const q = questions[idx];
  const widget = q ? widgetFor(q) : "text";
  const draft = (q && drafts[q.id]) || EMPTY_DRAFT;
  const otherOpen = draft.picked.includes(OTHER);
  const answered = draftAnswer(draft) !== "";
  const last = idx === total - 1;

  const patch = (partial: Partial<Draft>) => {
    if (!q) return;
    setDrafts((prev) => ({
      ...prev,
      [q.id]: { ...(prev[q.id] ?? EMPTY_DRAFT), ...partial },
    }));
  };

  /** Collected answers → one submission. All-empty means the user skipped. */
  const finish = (all: Record<string, Draft>) => {
    if (busy) return;
    const answers: Record<string, string> = {};
    for (const question of questions) {
      const value = draftAnswer(all[question.id]);
      if (value) answers[question.id] = value;
    }
    if (Object.keys(answers).length === 0) {
      onSubmit({ action: "skip" });
    } else {
      onSubmit({ action: "answer", answers });
    }
  };

  const next = (all: Record<string, Draft>) => {
    if (last) finish(all);
    else setIdx((i) => i + 1);
  };

  const pickSingle = (option: string) => {
    if (busy || !q) return;
    const all = {
      ...drafts,
      [q.id]: { ...(drafts[q.id] ?? EMPTY_DRAFT), picked: [option] },
    };
    setDrafts(all);
    // Choosing an option answers the question — flow straight on. "Other"
    // stays put so the user can type their own answer first.
    if (option !== OTHER) next(all);
  };

  const toggleMulti = (option: string) =>
    patch({
      picked: draft.picked.includes(option)
        ? draft.picked.filter((p) => p !== option)
        : [...draft.picked, option],
    });

  const skipQuestion = () => {
    if (busy || !q) return;
    const all = { ...drafts, [q.id]: EMPTY_DRAFT };
    setDrafts(all);
    next(all);
  };

  if (!q) return null;

  const optionButton = (
    option: string,
    active: boolean,
    onClick: () => void,
    extra?: string,
  ) => (
    <button
      key={option}
      type="button"
      disabled={busy}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60",
        active
          ? "border-amber-500 bg-amber-500/15 text-amber-800 dark:text-amber-200"
          : "border-border bg-background hover:border-amber-500/60 hover:bg-amber-500/10",
        extra,
      )}
    >
      {active && <Check className="mr-1 inline h-3 w-3" />}
      {option === OTHER ? "Other…" : option}
    </button>
  );

  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4">
      {/* Header: reason + progress + dismiss (dismiss = skip, per spec) */}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-300">
            <HelpCircle className="h-4 w-4 shrink-0" />
            Quick question{total > 1 ? "s" : ""}
            {total > 1 && (
              <span className="font-normal text-muted-foreground">
                · {idx + 1} of {total}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{data.reason}</p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => finish(drafts)}
          aria-label="Dismiss and answer anyway"
          className="-mr-1 -mt-1 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {total > 1 && (
        <Progress value={((idx + 1) / total) * 100} className="mt-2 h-1" />
      )}

      {/* One question at a time */}
      <AnimatePresence mode="wait">
        <motion.div
          key={q.id}
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.16, ease: "easeOut" }}
          className="mt-3 space-y-2"
        >
          <label className="text-sm font-medium">{q.text}</label>

          {widget === "single" && q.options && (
            <div className="flex flex-wrap gap-2">
              {q.options.map((opt) =>
                optionButton(opt, draft.picked.includes(opt), () =>
                  pickSingle(opt),
                ),
              )}
              {optionButton(OTHER, otherOpen, () => pickSingle(OTHER))}
            </div>
          )}

          {widget === "multi" && q.options && (
            <div className="flex flex-wrap gap-2">
              {q.options.map((opt) =>
                optionButton(opt, draft.picked.includes(opt), () =>
                  toggleMulti(opt),
                ),
              )}
              {optionButton(OTHER, otherOpen, () => toggleMulti(OTHER))}
            </div>
          )}

          {widget === "binary" && (
            <div className="flex gap-2">
              {binaryOptions(q).map((opt) =>
                optionButton(
                  opt,
                  draft.picked.includes(opt),
                  () => pickSingle(opt),
                  "flex-1 py-2",
                ),
              )}
            </div>
          )}

          {(widget === "text" || widget === "number") && (
            <Input
              autoFocus
              type={widget === "number" ? "number" : "text"}
              inputMode={widget === "number" ? "numeric" : undefined}
              value={draft.text}
              disabled={busy}
              placeholder="Type your answer…"
              onChange={(e) => patch({ text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && answered) {
                  e.preventDefault();
                  next(drafts);
                }
              }}
              className="h-9"
            />
          )}

          {widget === "textarea" && (
            <Textarea
              autoFocus
              value={draft.text}
              disabled={busy}
              placeholder="Type your answer…"
              onChange={(e) => patch({ text: e.target.value })}
              rows={3}
              className="resize-none text-sm"
            />
          )}

          {/* "Other" free-text for option widgets */}
          {(widget === "single" || widget === "multi") && otherOpen && (
            <Input
              autoFocus
              value={draft.text}
              disabled={busy}
              placeholder="Enter your own answer…"
              onChange={(e) => patch({ text: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && answered) {
                  e.preventDefault();
                  next(drafts);
                }
              }}
              className="h-9"
            />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Footer nav: Back / Skip / Next-Submit */}
      <div className="mt-3 flex items-center gap-2">
        {idx > 0 && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => setIdx((i) => i - 1)}
            className="gap-1"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Back
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={skipQuestion}
          className="text-muted-foreground"
        >
          Skip
        </Button>
        <Button
          size="sm"
          disabled={busy || !answered}
          onClick={() => next(drafts)}
          className="ml-auto gap-1"
        >
          {last ? "Submit" : "Next"}
          {!last && <ChevronRight className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}
