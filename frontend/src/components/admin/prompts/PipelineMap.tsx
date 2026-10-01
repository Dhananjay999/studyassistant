// The execution pipeline, top to bottom: one band per stage, its steps side
// by side, an arrow between stages. With a prompt or shared block selected,
// the steps that would change are lit and every other step is dimmed: that
// lit set is the blast radius.

import {
  ArrowDown,
  ArrowDownRight,
  ArrowUpRight,
  Database,
  FileText,
  Flag,
  GitBranch,
  LogIn,
  Save,
  Search,
  Sparkles,
  Square,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AdminFlowNode, AdminFlowStage } from "@/types/adminTrace";
import {
  nodeKey,
  type CatalogIndex,
  type FlowRelation,
  type PromptSelection,
} from "./promptMapModel";

const KIND_ICON: Record<string, LucideIcon> = {
  entry: LogIn,
  context: Database,
  rule: GitBranch,
  llm: Sparkles,
  outcome: Flag,
  tool: Wrench,
  retrieval: Search,
  persist: Save,
};

const KIND_LABEL: Record<string, string> = {
  entry: "Entry",
  context: "Context",
  rule: "Rule",
  llm: "LLM call",
  outcome: "Outcome",
  tool: "Tool",
  retrieval: "Retrieval",
  persist: "Persist",
};

type NodeState = "idle" | "affected" | "dimmed";

function FlowNodeCard({
  nodeId,
  node,
  state,
  isSelected,
  relation,
  via,
  unused,
  showDetails,
  onSelect,
}: {
  /** Map-wide key, also the scroll target (`data-flow-node`). */
  nodeId: string;
  node: AdminFlowNode;
  state: NodeState;
  /** This node renders the selected template. */
  isSelected: boolean;
  relation: FlowRelation | undefined;
  /** Shared block through which this node is affected, if any. */
  via: string | null;
  /** The node's prompt is known and not rendered by any code path. */
  unused: boolean;
  showDetails: boolean;
  onSelect: ((prompt: string) => void) | null;
}) {
  const Icon = KIND_ICON[node.kind] ?? Square;
  const clickable = !!node.prompt && !!onSelect;
  const tooltip = [
    node.condition ? `When ${node.condition}` : null,
    node.description,
    node.code,
  ]
    .filter(Boolean)
    .join("\n");

  const body = (
    <>
      <div className="flex items-start gap-1.5">
        <Icon
          className={cn(
            "mt-0.5 h-3.5 w-3.5 shrink-0",
            node.prompt ? "text-primary" : "text-muted-foreground",
          )}
          aria-hidden
        />
        <span className="min-w-0 flex-1 break-words text-sm font-medium leading-snug">
          {node.label}
        </span>
        {state === "affected" && (
          <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-primary px-1.5 py-px text-[10px] font-semibold text-primary-foreground">
            <Zap className="h-2.5 w-2.5" aria-hidden />
            {isSelected ? "selected" : "affected"}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        <span className="font-semibold">
          {KIND_LABEL[node.kind] ?? node.kind}
        </span>
        {node.tool && (
          <span
            className="font-mono normal-case tracking-normal"
            title={`Tool ${node.tool}`}
          >
            {node.kind === "tool" ? node.tool : `in ${node.tool}`}
          </span>
        )}
      </div>

      {node.condition && (
        // Two lines keep the map compact; the switch (or hover) gives all.
        <p
          className={cn(
            "text-[11px] leading-snug text-muted-foreground",
            !showDetails && "line-clamp-2",
          )}
        >
          <span className="font-semibold text-foreground/80">When </span>
          {node.condition}
        </p>
      )}

      {node.prompt && (
        <span
          className={cn(
            "mt-0.5 inline-flex max-w-full items-center gap-1 self-start rounded-md border px-1.5 py-0.5 font-mono text-[11px]",
            state === "affected"
              ? "border-primary bg-primary/20 text-primary"
              : "border-primary/30 bg-primary/10 text-primary",
          )}
        >
          <FileText className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">{node.prompt}</span>
          {unused && (
            <span className="shrink-0 font-sans text-[10px] font-semibold text-amber-600 dark:text-amber-400">
              unused
            </span>
          )}
        </span>
      )}

      {via && (
        <p className="text-[11px] font-medium leading-snug text-primary">
          embeds {via}
        </p>
      )}

      {relation && (
        <span className="inline-flex items-center gap-1 self-start rounded-full border border-dashed border-foreground/40 px-1.5 py-px text-[10px] font-medium">
          {relation === "upstream" ? (
            <ArrowUpRight className="h-2.5 w-2.5" aria-hidden />
          ) : (
            <ArrowDownRight className="h-2.5 w-2.5" aria-hidden />
          )}
          {relation === "upstream" ? "runs before" : "runs after"}
        </span>
      )}

      {showDetails && (node.description || node.code) && (
        <div className="mt-0.5 space-y-0.5 border-t border-border/50 pt-1">
          {node.description && (
            <p className="text-[11px] leading-snug text-muted-foreground">
              {node.description}
            </p>
          )}
          {node.code && (
            <p className="break-all font-mono text-[10px] text-muted-foreground/80">
              {node.code}
            </p>
          )}
        </div>
      )}
    </>
  );

  const className = cn(
    "flex min-w-[9.5rem] flex-1 basis-44 scroll-mt-40 flex-col gap-1 rounded-lg border bg-background px-3 py-2 text-left transition-[opacity,box-shadow,border-color,background-color] sm:max-w-[19rem]",
    clickable &&
      "cursor-pointer hover:border-primary/60 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:bg-accent/60",
    state === "affected" &&
      "border-primary bg-primary/10 shadow-[0_0_0_2px_hsl(var(--primary)/0.55)]",
    state === "dimmed" && !relation && "opacity-40",
    state === "dimmed" && relation && "opacity-80",
  );

  return clickable ? (
    <button
      type="button"
      data-flow-node={nodeId}
      className={className}
      title={tooltip || undefined}
      aria-pressed={isSelected}
      data-analytics-name="Select pipeline prompt"
      onClick={() => onSelect(node.prompt as string)}
    >
      {body}
    </button>
  ) : (
    <div
      data-flow-node={nodeId}
      className={className}
      title={tooltip || undefined}
    >
      {body}
    </div>
  );
}

function StageConnector() {
  return (
    <div
      aria-hidden
      className="flex flex-col items-center py-0.5 text-muted-foreground"
    >
      <span className="h-3 w-px bg-muted-foreground/50" />
      <ArrowDown className="-mt-1 h-4 w-4" />
    </div>
  );
}

export function PipelineMap({
  index,
  selection,
  affected,
  related,
  showDetails,
  onSelectTemplate,
}: {
  index: CatalogIndex;
  selection: PromptSelection | null;
  /** Keys of the nodes in the blast radius. */
  affected: Set<string>;
  related: Map<string, FlowRelation>;
  showDetails: boolean;
  onSelectTemplate: (name: string) => void;
}) {
  const active = selection !== null;
  // Which shared block lights a node up (shown on the node), by template.
  const via = (stage: AdminFlowStage, node: AdminFlowNode) =>
    selection?.kind === "block" && affected.has(nodeKey(stage, node))
      ? selection.name
      : null;

  if (!index.stages.length) {
    return (
      <p className="text-sm text-muted-foreground">
        The catalog did not include a pipeline.
      </p>
    );
  }

  return (
    <ol className="flex flex-col">
      {index.stages.map((stage, i) => {
        const nodes = stage.nodes ?? [];
        const hits = nodes.filter((n) => affected.has(nodeKey(stage, n))).length;
        return (
          <li key={stage.id} className="flex flex-col">
            {i > 0 && <StageConnector />}
            <div
              className={cn(
                "rounded-xl border p-3 transition-colors",
                active && hits > 0
                  ? "border-primary/50 bg-primary/[0.04]"
                  : "bg-muted/20",
              )}
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-muted text-[10px] font-semibold tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                <h3 className="text-sm font-semibold">{stage.title}</h3>
                {active && (
                  <span
                    className={cn(
                      "ml-auto whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium",
                      hits > 0
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {hits > 0
                      ? `${hits} of ${nodes.length} affected`
                      : "not affected"}
                  </span>
                )}
              </div>
              {stage.description && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {stage.description}
                </p>
              )}
              <div className="mt-2.5 flex flex-wrap gap-2">
                {nodes.map((node) => {
                  const key = nodeKey(stage, node);
                  const isAffected = affected.has(key);
                  const template = node.prompt
                    ? index.templateByName.get(node.prompt)
                    : undefined;
                  return (
                    <FlowNodeCard
                      key={key}
                      nodeId={key}
                      node={node}
                      state={
                        !active ? "idle" : isAffected ? "affected" : "dimmed"
                      }
                      isSelected={
                        selection?.kind === "template" &&
                        node.prompt === selection.name
                      }
                      relation={related.get(key)}
                      via={via(stage, node)}
                      unused={!!template && template.usage?.live === false}
                      showDetails={showDetails}
                      onSelect={onSelectTemplate}
                    />
                  );
                })}
                {nodes.length === 0 && (
                  <p className="text-xs text-muted-foreground">No steps.</p>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
