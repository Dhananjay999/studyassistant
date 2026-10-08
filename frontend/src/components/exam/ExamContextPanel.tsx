// Study material the exam coach answers from, shown above the topic page's
// doubt box. Selected uploads (the plan's material by default) are the
// active context; every other upload sits in an accordion so the student can
// add or swap files without leaving the page. Phone first: full-width rows,
// 44px tap targets, nothing hover-only.

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, FileText, FolderOpen, Image as ImageIcon, Loader2 } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { MediaItem } from "@/types";
import type { ExamContextMedia } from "./useExamContextMedia";

function isIndexing(m: MediaItem): boolean {
  const status = m.processing_status ?? "ready";
  return !m.mime_type.startsWith("image/") && status !== "ready";
}

function FileGlyph({ item }: { item: MediaItem }) {
  const Icon = item.mime_type.startsWith("image/") ? ImageIcon : FileText;
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-1/10 text-brand-1">
      <Icon className="h-4 w-4" />
    </span>
  );
}

function MediaRow({
  item,
  checked,
  fromPlan,
  onToggle,
}: {
  item: MediaItem;
  checked: boolean;
  fromPlan: boolean;
  onToggle: () => void;
}) {
  const indexing = isIndexing(item);
  const detail = indexing
    ? "Indexing… answers use the whole file until done"
    : item.page_count
      ? `${item.page_count} page${item.page_count === 1 ? "" : "s"}${fromPlan ? " · plan material" : ""}`
      : fromPlan
        ? "Plan material"
        : undefined;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onToggle}
      data-analytics-name="Exam context material toggle"
      className={cn(
        "flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors",
        checked ? "bg-brand-1/5" : "hover:bg-accent/50",
      )}
    >
      <FileGlyph item={item} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{item.file_name}</span>
        {detail && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            {indexing && <Loader2 className="h-3 w-3 animate-spin" />}
            <span className="truncate">{detail}</span>
          </span>
        )}
      </span>
      <span
        className={cn(
          "grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors",
          checked ? "border-brand-1 bg-brand-1 text-white" : "border-border",
        )}
      >
        {checked && <Check className="h-3.5 w-3.5" />}
      </span>
    </button>
  );
}

export function ExamContextPanel({ context }: { context: ExamContextMedia }) {
  const reduce = useReducedMotion();
  const { selectedItems, otherItems, planIds, loading, toggle } = context;

  if (loading) {
    return (
      <div className="space-y-2" aria-busy>
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-10 w-2/3 rounded-xl" />
      </div>
    );
  }
  if (selectedItems.length === 0 && otherItems.length === 0) return null;

  return (
    <div
      className="glass rounded-2xl p-2"
      data-analytics-section="exam_topic_context"
      data-analytics-private
    >
      <div className="flex items-center justify-between gap-2 px-2 pb-1 pt-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Answering from
        </p>
        <span className="text-xs tabular-nums text-muted-foreground">
          {selectedItems.length} selected
        </span>
      </div>

      {selectedItems.length === 0 ? (
        <p className="px-3 pb-2 text-sm text-muted-foreground">
          No material selected. Aeva answers from the lesson and general
          knowledge; pick a file below to answer from it.
        </p>
      ) : (
        <ul className="space-y-0.5">
          <AnimatePresence initial={false}>
            {selectedItems.map((m) => (
              <motion.li
                key={m.id}
                layout={!reduce}
                initial={reduce ? false : { opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
                transition={{ duration: 0.18 }}
              >
                <MediaRow
                  item={m}
                  checked
                  fromPlan={planIds.has(m.id)}
                  onToggle={() => toggle(m.id)}
                />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      {otherItems.length > 0 && (
        <Accordion type="single" collapsible className="mt-1">
          <AccordionItem value="other" className="border-0">
            <AccordionTrigger
              className="min-h-[44px] rounded-xl px-3 py-2 text-sm font-medium hover:bg-accent/50 hover:no-underline"
              data-analytics-name="Exam context other uploads"
            >
              <span className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-muted-foreground" />
                Other uploads
                <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">
                  {otherItems.length}
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent className="pb-1">
              <ul className="space-y-0.5">
                {otherItems.map((m) => (
                  <li key={m.id}>
                    <MediaRow
                      item={m}
                      checked={false}
                      fromPlan={planIds.has(m.id)}
                      onToggle={() => toggle(m.id)}
                    />
                  </li>
                ))}
              </ul>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}
    </div>
  );
}
