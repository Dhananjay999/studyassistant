// The two pick lists of the Prompt Map: every prompt template (version,
// where it runs, which model config selects its model, whether any code
// path renders it, and how often it ran) and every shared block (how many
// templates embed it). Rows affected by the current selection are marked.

import { Blocks, FileText, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AdminPromptBlock, AdminPromptTemplate } from "@/types/adminTrace";
import { HashChip, LiveBadge } from "./parts";
import {
  plural,
  timeAgo,
  type CatalogIndex,
  type PromptSelection,
} from "./promptMapModel";

const ROW =
  "flex min-h-12 w-full flex-col gap-1 border-l-2 border-transparent px-3 py-2.5 text-left transition-colors hover:bg-accent/50 active:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
const ROW_SELECTED = "border-primary bg-primary/10 hover:bg-primary/10";

function AffectedMark({ label }: { label: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-primary/15 px-1.5 py-px text-[10px] font-semibold text-primary">
      <Zap className="h-2.5 w-2.5" aria-hidden />
      {label}
    </span>
  );
}

function TemplateRow({
  template,
  stageTitle,
  selected,
  affected,
  statsAvailable,
  days,
  onSelect,
}: {
  template: AdminPromptTemplate;
  stageTitle: string;
  selected: boolean;
  /** Embeds the selected shared block. */
  affected: boolean;
  statsAvailable: boolean;
  days: number;
  onSelect: () => void;
}) {
  const usage = template.usage;
  const stats = template.stats;
  const live = usage?.live !== false;
  const where = [
    stageTitle,
    usage?.tool ? `tool ${usage.tool}` : null,
  ].filter(Boolean);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-analytics-name="Select prompt template"
      className={cn(ROW, selected && ROW_SELECTED)}
    >
      <span className="flex items-center gap-2">
        <FileText
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            live ? "text-primary" : "text-muted-foreground",
          )}
          aria-hidden
        />
        <span
          className={cn(
            "min-w-0 flex-1 truncate font-mono text-sm font-medium",
            !live && "text-muted-foreground",
          )}
        >
          {template.name}
        </span>
        {affected && <AffectedMark label="changes" />}
        <LiveBadge live={live} />
      </span>

      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
        {where.length > 0 && <span>{where.join(" · ")}</span>}
        {usage?.config_key && (
          <span
            className="font-mono text-[11px]"
            title="Config key that selects the model"
          >
            {usage.config_key}
          </span>
        )}
      </span>

      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        <HashChip hash={template.hash} />
        {!live ? (
          <span className="text-amber-600 dark:text-amber-400">
            Not rendered by any code path
          </span>
        ) : !statsAvailable ? (
          <span>usage not recorded</span>
        ) : (
          <span
            className="tabular-nums"
            title={`Last ${days} days`}
          >
            {plural(stats?.uses ?? 0, "use")} ·{" "}
            {plural(stats?.traces ?? 0, "trace")} ·{" "}
            {stats?.last_used
              ? `last used ${timeAgo(stats.last_used)}`
              : "never used"}
          </span>
        )}
      </span>
    </button>
  );
}

export function TemplateList({
  index,
  selection,
  affectedTemplates,
  statsAvailable,
  days,
  onSelect,
}: {
  index: CatalogIndex;
  selection: PromptSelection | null;
  /** Templates in the blast radius of the selection. */
  affectedTemplates: Set<string>;
  statsAvailable: boolean;
  days: number;
  onSelect: (name: string) => void;
}) {
  if (!index.templates.length) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        No prompt templates registered.
      </p>
    );
  }
  // Live templates first; the unused ones sink to the bottom.
  const ordered = [
    ...index.templates.filter((t) => t.usage?.live !== false),
    ...index.templates.filter((t) => t.usage?.live === false),
  ];
  return (
    <ul className="divide-y">
      {ordered.map((template) => (
        <li key={template.name}>
          <TemplateRow
            template={template}
            stageTitle={
              index.stageById.get(template.usage?.stage)?.title ??
              template.usage?.stage ??
              ""
            }
            selected={
              selection?.kind === "template" && selection.name === template.name
            }
            affected={
              selection?.kind === "block" &&
              affectedTemplates.has(template.name)
            }
            statsAvailable={statsAvailable}
            days={days}
            onSelect={() => onSelect(template.name)}
          />
        </li>
      ))}
    </ul>
  );
}

function BlockRow({
  block,
  embedders,
  selected,
  embedded,
  onSelect,
}: {
  block: AdminPromptBlock;
  embedders: number;
  selected: boolean;
  /** The selected template embeds this block. */
  embedded: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-analytics-name="Select shared block"
      className={cn(ROW, selected && ROW_SELECTED)}
    >
      <span className="flex items-center gap-2">
        <Blocks className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
        <span className="min-w-0 flex-1 truncate font-mono text-sm font-medium">
          {block.name}
        </span>
        {embedded && <AffectedMark label="embedded" />}
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
            embedders > 1
              ? "bg-primary/15 text-primary"
              : "bg-muted text-muted-foreground",
          )}
        >
          {plural(embedders, "template")}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        <span className="tabular-nums">
          {(block.chars ?? block.text?.length ?? 0).toLocaleString()} chars
        </span>
        {block.source && (
          <span className="break-all font-mono">{block.source}</span>
        )}
      </span>
    </button>
  );
}

export function BlockList({
  index,
  selection,
  onSelect,
}: {
  index: CatalogIndex;
  selection: PromptSelection | null;
  onSelect: (name: string) => void;
}) {
  if (!index.blocks.length) {
    return (
      <p className="p-4 text-sm text-muted-foreground">No shared blocks.</p>
    );
  }
  const embeddedHere =
    selection?.kind === "template"
      ? new Set(
          (index.embedded.get(selection.name) ?? [])
            .map((e) => e.block?.name)
            .filter(Boolean),
        )
      : new Set<string>();
  // Widest blast radius first.
  const ordered = [...index.blocks].sort(
    (a, b) =>
      (index.embedders.get(b.name)?.length ?? 0) -
      (index.embedders.get(a.name)?.length ?? 0),
  );
  return (
    <ul className="divide-y">
      {ordered.map((block) => (
        <li key={block.name}>
          <BlockRow
            block={block}
            embedders={index.embedders.get(block.name)?.length ?? 0}
            selected={
              selection?.kind === "block" && selection.name === block.name
            }
            embedded={embeddedHere.has(block.name)}
            onSelect={() => onSelect(block.name)}
          />
        </li>
      ))}
    </ul>
  );
}
