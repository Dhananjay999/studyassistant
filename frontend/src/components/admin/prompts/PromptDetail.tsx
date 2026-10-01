// Everything about one prompt template, in the order a developer needs it
// before an edit: what it is, where it is rendered and with which model,
// how often it runs, what runs before and after, the text itself, the
// shared blocks it pulls in (and who else uses them), and its versions.
// What the edit reaches is stated by the selection bar above this panel.

import { useMemo, useState } from "react";
import {
  Activity,
  ArrowDown,
  ArrowRight,
  Blocks,
  ChevronDown,
  FileText,
  History,
  ListTree,
  MapPin,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatNumber } from "@/lib/adminFormat";
import { cn } from "@/lib/utils";
import type {
  AdminPromptTemplate,
  AdminPromptVersionRef,
} from "@/types/adminTrace";
import {
  DetailSection,
  Fact,
  HashChip,
  LiveBadge,
  PlaceholderLegend,
  PromptText,
  ScrollPane,
  TextPanel,
} from "./parts";
import {
  placeholderKinds,
  plural,
  type CatalogIndex,
  type EmbeddedBlock,
  type PlaceholderKind,
} from "./promptMapModel";
import { VersionHistory } from "./VersionHistory";

function StepList({
  title,
  steps,
  empty,
}: {
  title: string;
  steps: string[];
  empty: string;
}) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {steps.length ? (
        <ol className="mt-1.5 space-y-1 text-sm">
          {steps.map((step, i) => (
            <li key={`${step}-${i}`} className="flex gap-2">
              <span className="w-4 shrink-0 text-right font-mono text-[11px] leading-5 text-muted-foreground">
                {i + 1}
              </span>
              <span className="min-w-0 break-words">{step}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-1.5 text-sm text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

/** Points right between columns, down when the columns stack. */
function FlowArrow() {
  return (
    <div
      aria-hidden
      className="flex items-center justify-center text-muted-foreground"
    >
      <ArrowRight className="hidden h-4 w-4 sm:block" />
      <ArrowDown className="h-4 w-4 sm:hidden" />
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words text-lg font-semibold tabular-nums">
        {value}
      </p>
    </div>
  );
}

function EmbeddedBlockRow({
  embedded,
  others,
  kinds,
  onSelectTemplate,
  onSelectBlock,
}: {
  embedded: EmbeddedBlock;
  /** Other templates that embed the same block. */
  others: string[];
  kinds: Map<string, PlaceholderKind>;
  onSelectTemplate: (name: string) => void;
  onSelectBlock: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { block } = embedded;
  const renamed = block && block.name !== embedded.placeholder;

  return (
    <li className="rounded-lg border bg-background">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          data-analytics-name="Toggle shared block text"
          className="flex min-h-9 min-w-0 flex-1 basis-48 items-center gap-2 text-left sm:min-h-0"
        >
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
            aria-hidden
          />
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="break-all font-mono text-sm font-medium">
              {`{${embedded.placeholder}}`}
            </span>
            {renamed && (
              <span className="break-all font-mono text-[11px] text-muted-foreground">
                = {block.name}
              </span>
            )}
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {embedded.text.length.toLocaleString()} chars
            </span>
          </span>
        </button>
        {block && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-9 gap-1.5 text-xs sm:h-7"
            data-analytics-name="Open shared block"
            onClick={() => onSelectBlock(block.name)}
          >
            <Blocks className="h-3 w-3" />
            Blast radius
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-border/50 px-3 py-2 text-xs">
        {others.length > 0 ? (
          <>
            <span className="font-medium text-amber-600 dark:text-amber-400">
              Also used by:
            </span>
            {others.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => onSelectTemplate(name)}
                data-analytics-name="Select prompt template"
                className="rounded-md border border-border/70 bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] hover:border-primary/60 hover:text-primary"
              >
                {name}
              </button>
            ))}
            <span className="text-muted-foreground">
              ({plural(others.length, "other template")} would change too)
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">
            Only this template embeds it.
          </span>
        )}
      </div>

      {open && (
        <div className="border-t border-border/50 p-2">
          {embedded.text ? (
            <ScrollPane
              label={`${embedded.placeholder} block text`}
              className="max-h-80"
            >
              <PromptText
                text={embedded.text}
                kinds={kinds}
                className="rounded-lg"
              />
            </ScrollPane>
          ) : (
            <p className="px-1 py-2 text-sm text-muted-foreground">
              This block is empty.
            </p>
          )}
        </div>
      )}
    </li>
  );
}

export function PromptDetail({
  template,
  index,
  versions,
  statsAvailable,
  days,
  onSelectTemplate,
  onSelectBlock,
  onOpenTraces,
}: {
  template: AdminPromptTemplate;
  index: CatalogIndex;
  versions: AdminPromptVersionRef[] | undefined;
  statsAvailable: boolean;
  days: number;
  onSelectTemplate: (name: string) => void;
  onSelectBlock: (name: string) => void;
  onOpenTraces: (filter: { prompt?: string; tool?: string }) => void;
}) {
  const usage = template.usage;
  const stats = template.stats;
  const live = usage?.live !== false;
  const kinds = useMemo(() => placeholderKinds(template), [template]);
  const embedded = index.embedded.get(template.name) ?? [];
  const stage = index.stageById.get(usage?.stage);

  /** Other templates embedding the same block (catalog block, else text). */
  const othersFor = (item: EmbeddedBlock): string[] => {
    const names = item.block
      ? (index.embedders.get(item.block.name) ?? [])
      : index.templates
          .filter((t) => t.defaults?.[item.placeholder] === item.text)
          .map((t) => t.name);
    return names.filter((name) => name !== template.name);
  };

  const openBlock = (placeholder: string) => {
    const block = embedded.find((e) => e.placeholder === placeholder)?.block;
    return block ? () => onSelectBlock(block.name) : null;
  };

  return (
    <article className="space-y-6 rounded-xl border p-4 sm:p-5">
      <header className="space-y-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Prompt template
          </p>
          <h2 className="break-all font-mono text-lg font-semibold leading-tight">
            {template.name}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <LiveBadge live={live} />
          <HashChip hash={template.hash} />
          {(stage || usage?.stage) && (
            <span className="rounded border border-border/70 px-1.5 py-px text-[11px] text-muted-foreground">
              {stage?.title ?? usage?.stage}
            </span>
          )}
          {usage?.tool && (
            <span className="rounded border border-border/70 px-1.5 py-px font-mono text-[11px] text-muted-foreground">
              tool {usage.tool}
            </span>
          )}
        </div>

        {usage?.description && (
          <p className="text-sm text-muted-foreground">{usage.description}</p>
        )}

        {!live && (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <span className="font-semibold text-amber-600 dark:text-amber-400">
              Not rendered by any code path.
            </span>{" "}
            This template is defined but nothing calls it, so editing it has
            no effect on what users see.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            className="h-10 gap-1.5 sm:h-9"
            data-analytics-name="View traces using this prompt"
            onClick={() => onOpenTraces({ prompt: template.name })}
          >
            <ListTree className="h-4 w-4" />
            View traces using this prompt
          </Button>
          {usage?.tool && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-10 gap-1.5 sm:h-9"
              data-analytics-name="View traces using this tool"
              onClick={() => onOpenTraces({ tool: usage.tool as string })}
            >
              <ListTree className="h-4 w-4" />
              Traces of tool {usage.tool}
            </Button>
          )}
        </div>
      </header>

      <DetailSection title="Where it is rendered" icon={MapPin}>
        <div className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-lg border bg-background p-3 sm:grid-cols-2">
          <Fact label="Rendered at (call site)" mono>
            {usage?.call_site || "—"}
          </Fact>
          <Fact label="Defined at" mono>
            {template.source || "—"}
            {template.constant && (
              <span className="block font-normal text-muted-foreground">
                {template.constant}
              </span>
            )}
          </Fact>
          <Fact label="Model config key" mono>
            {usage?.config_key || "—"}
          </Fact>
          <Fact label="LLM method" mono>
            {usage?.llm_method || "—"}
          </Fact>
          <Fact label="Tool" mono>
            {usage?.tool || "—"}
          </Fact>
          <Fact label="Conversation history">
            {template.uses_history
              ? "Sent alongside (not part of this text)"
              : "Not sent"}
          </Fact>
          <Fact label="Attachments">
            {template.uses_attachments ? "Sent alongside" : "Not sent"}
          </Fact>
        </div>
      </DetailSection>

      <DetailSection title={`Usage, last ${days} days`} icon={Activity}>
        {statsAvailable ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_2fr]">
            <MiniStat label="Renders" value={formatNumber(stats?.uses)} />
            <MiniStat label="Traces" value={formatNumber(stats?.traces)} />
            <div className="col-span-2 sm:col-span-1">
              <MiniStat
                label="Last used"
                value={
                  stats?.last_used ? formatDateTime(stats.last_used) : "Never"
                }
              />
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Not recorded yet: usage counts need migration{" "}
            <code className="font-mono text-xs">
              024_ai_execution_traces.sql
            </code>
            .
          </p>
        )}
      </DetailSection>

      <DetailSection title="Before and after" icon={Workflow}>
        <div className="grid items-stretch gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)]">
          <StepList
            title="Runs before"
            steps={usage?.upstream ?? []}
            empty="Nothing listed."
          />
          <FlowArrow />
          <div className="self-center rounded-lg border border-primary bg-primary/10 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">
              This prompt
            </p>
            <p className="mt-1.5 break-all font-mono text-sm font-medium">
              {template.name}
            </p>
            <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
              {[usage?.llm_method, usage?.config_key]
                .filter(Boolean)
                .join(" · ") || "—"}
            </p>
          </div>
          <FlowArrow />
          <StepList
            title="Runs after"
            steps={usage?.downstream ?? []}
            empty="Nothing listed."
          />
        </div>
      </DetailSection>

      <DetailSection title="Template text" icon={FileText}>
        <PlaceholderLegend />
        <TextPanel
          title="System channel"
          note="Sent as the system prompt."
          text={template.system ?? ""}
          what="System prompt"
          kinds={kinds}
          onOpenBlock={openBlock}
          emptyText="Empty: this template sends no system prompt."
        />
        <TextPanel
          title="User channel"
          note="Sent as the final user turn."
          text={template.user ?? ""}
          what="User prompt"
          kinds={kinds}
          onOpenBlock={openBlock}
          emptyText="Empty: this template has no user channel."
        />
      </DetailSection>

      <DetailSection
        title={`Shared blocks it embeds (${embedded.length})`}
        icon={Blocks}
      >
        {embedded.length ? (
          <ul className="space-y-2">
            {embedded.map((item) => (
              <EmbeddedBlockRow
                key={item.placeholder}
                embedded={item}
                others={othersFor(item)}
                kinds={kinds}
                onSelectTemplate={onSelectTemplate}
                onSelectBlock={onSelectBlock}
              />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            None: this template is self-contained, so only an edit to its own
            text changes it.
          </p>
        )}
      </DetailSection>

      <DetailSection title="Version history" icon={History}>
        <VersionHistory
          template={template}
          refs={versions}
          statsAvailable={statsAvailable}
          days={days}
        />
      </DetailSection>
    </article>
  );
}
