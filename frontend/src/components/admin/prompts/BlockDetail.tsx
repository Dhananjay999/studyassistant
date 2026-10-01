// One shared block: its text, and every template that embeds it. Editing a
// block is the widest-reaching prompt change, so the list of templates (and
// the pipeline steps that render them) comes before the text.

import { useMemo } from "react";
import { Blocks, FileText, Zap } from "lucide-react";
import type { AdminPromptBlock } from "@/types/adminTrace";
import { DetailSection, HashChip, LiveBadge, TextPanel } from "./parts";
import {
  placeholderKinds,
  plural,
  timeAgo,
  type BlastRadius,
  type CatalogIndex,
  type PlaceholderKind,
} from "./promptMapModel";

export function BlockDetail({
  block,
  index,
  radius,
  statsAvailable,
  days,
  onSelectTemplate,
}: {
  block: AdminPromptBlock;
  index: CatalogIndex;
  radius: BlastRadius;
  statsAvailable: boolean;
  days: number;
  onSelectTemplate: (name: string) => void;
}) {
  // Placeholders inside a block are resolved by the embedding template;
  // style them the way the first template that knows the name does.
  const kinds = useMemo(() => {
    const merged = new Map<string, PlaceholderKind>();
    for (const name of radius.templates) {
      const template = index.templateByName.get(name);
      if (!template) continue;
      for (const [placeholder, kind] of placeholderKinds(template)) {
        if (!merged.has(placeholder)) merged.set(placeholder, kind);
      }
    }
    return merged;
  }, [index, radius.templates]);

  const chars = block.chars ?? block.text?.length ?? 0;

  return (
    <article className="space-y-6 rounded-xl border p-4 sm:p-5">
      <header className="space-y-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Shared block
          </p>
          <h2 className="break-all font-mono text-lg font-semibold leading-tight">
            {block.name}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          <span className="tabular-nums">{chars.toLocaleString()} chars</span>
          {block.source && (
            <span className="break-all font-mono">
              defined at {block.source}
            </span>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          A block of prompt text that templates embed by placeholder. A
          change here goes into every template below the next time it is
          rendered, and gives each of them a new version.
        </p>
      </header>


      <DetailSection
        title={`Templates that embed it (${radius.templates.length})`}
        icon={Zap}
      >
        {radius.templates.length ? (
          <ul className="divide-y rounded-lg border bg-background">
            {radius.templates.map((name) => {
              const template = index.templateByName.get(name);
              const steps = index.nodesByPrompt.get(name) ?? [];
              const live = template?.usage?.live !== false;
              return (
                <li key={name}>
                  <button
                    type="button"
                    disabled={!template}
                    onClick={() => onSelectTemplate(name)}
                    data-analytics-name="Select prompt template"
                    className="flex min-h-12 w-full flex-col gap-1 px-3 py-2.5 text-left enabled:hover:bg-accent/50 enabled:active:bg-accent/60 disabled:cursor-default"
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <FileText
                        className="h-3.5 w-3.5 shrink-0 text-primary"
                        aria-hidden
                      />
                      <span className="min-w-0 break-all font-mono text-sm font-medium">
                        {name}
                      </span>
                      {template && <LiveBadge live={live} />}
                      {template && <HashChip hash={template.hash} />}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {!template
                        ? "Listed by the block, but not in the catalog."
                        : !live
                          ? "Not rendered by any code path."
                          : steps.length
                            ? `Rendered by ${steps
                                .map((ref) => ref.node.label)
                                .join(", ")}`
                            : "Rendered outside the chat pipeline (no step on the map)."}
                      {template && live && statsAvailable && (
                        <span className="tabular-nums">
                          {" · "}
                          {plural(template.stats?.uses ?? 0, "use")} in{" "}
                          {days} days
                          {template.stats?.last_used
                            ? `, last used ${timeAgo(template.stats.last_used)}`
                            : ""}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            No template embeds this block.
          </p>
        )}
      </DetailSection>

      <DetailSection title="Block text" icon={Blocks}>
        <TextPanel
          title={block.name}
          note="Inserted verbatim wherever a template embeds it."
          text={block.text ?? ""}
          what="Block text"
          kinds={kinds}
          emptyText="This block is empty."
        />
      </DetailSection>
    </article>
  );
}
