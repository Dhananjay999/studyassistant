// Pure logic behind the trace explorer: turn the flat span list of one trace
// into a tree, decide what is open by default, and derive the one-line facts
// each row shows. No React in here so it can be checked in isolation.

import type { AdminTraceSpan, AdminTraceSummary } from "@/types/adminTrace";

export interface TraceNode {
  span: AdminTraceSpan;
  /** Ordered by `seq` (creation order). */
  children: TraceNode[];
  parent: TraceNode | null;
  depth: number;
  /** Its recorded parent is not in the trace; shown under the root instead. */
  orphan: boolean;
  /** This step, or one below it, did not finish cleanly. */
  problem: boolean;
}

export interface TraceTree {
  roots: TraceNode[];
  byId: Map<string, TraceNode>;
  /** Scale of the timing bars: the trace duration, or the last span's end. */
  totalMs: number;
  orphans: number;
}

/** One hop of the path summary shown above the tree. */
export interface PathStep {
  label: string;
  spanId: string | null;
  kind: string;
  /** Overlapped in time with the step before it (ran concurrently). */
  parallel: boolean;
}

type Loose = Record<string, unknown>;

// "running" never reaches the database (open spans are stored as
// "unfinished"), but treat it the same if it ever does.
const PROBLEM_STATUSES = new Set([
  "error",
  "timeout",
  "aborted",
  "unfinished",
  "running",
]);

// Kinds whose children are shown without a click: the turn itself, the
// routing cascade and each executed tool. Retrieval internals stay folded.
const OPEN_BY_DEFAULT = new Set(["turn", "router", "tool"]);

export function isProblemStatus(status: string | null | undefined): boolean {
  return PROBLEM_STATUSES.has(status ?? "");
}

export function asRecord(value: unknown): Loose | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Loose)
    : null;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** A scalar as display text; `null` for empty, missing or structured values. */
export function asText(value: unknown): string | null {
  if (typeof value === "string") return value === "" ? null : value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

/**
 * The recorder replaces an oversized input/output with
 * `{_truncated, _chars, preview}` (see `cap_field` in the backend).
 */
export function cappedPreview(
  value: unknown,
): { chars: number; preview: string } | null {
  const record = asRecord(value);
  if (!record || record._truncated !== true) return null;
  return {
    chars: typeof record._chars === "number" ? record._chars : 0,
    preview: typeof record.preview === "string" ? record.preview : "",
  };
}

/** Pretty JSON for display; never throws on odd values. */
export function prettyJson(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/** The keys of `record` not listed in `known`; `null` when none are left. */
export function omitKeys(
  record: Loose | null | undefined,
  known: readonly string[],
): Loose | null {
  if (!record) return null;
  const rest: Loose = {};
  let any = false;
  for (const key of Object.keys(record)) {
    if (known.includes(key)) continue;
    rest[key] = record[key];
    any = true;
  }
  return any ? rest : null;
}

/** Null, an empty array or an object with no keys. */
export function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

/**
 * Local date and time to the second (turns are correlated with logs).
 * `compact` drops the year and uses a 24-hour clock, for table cells.
 */
export function formatTimestamp(
  iso: string | null | undefined,
  compact = false,
): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: compact ? undefined : "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: compact ? false : undefined,
  });
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  return `${minutes}m ${String(total % 60).padStart(2, "0")}s`;
}

/**
 * Length in characters the way the backend counts them (code points), so a
 * size shown here agrees with the sizes the recorder stored. A JS string
 * length counts UTF-16 units: one more for every emoji or maths symbol.
 */
export function charLength(text: string): number {
  let pairs = 0;
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    // A high surrogate opens a two-unit character.
    if (unit >= 0xd800 && unit <= 0xdbff) pairs += 1;
  }
  return text.length - pairs;
}

/** 1234 → "1.2k": token and character counts in row facts. */
export function compactNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function shortHash(hash: string | null | undefined): string {
  return (hash ?? "").slice(0, 7);
}

export function shortId(id: string | null | undefined): string {
  if (!id) return "—";
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

const bySeq = (a: TraceNode, b: TraceNode) =>
  a.span.seq - b.span.seq || a.span.start_ms - b.span.start_ms;

/**
 * Nest spans by `parent_id`, siblings in `seq` order.
 *
 * Nothing is ever dropped: a span whose parent was not stored (the span
 * insert is best-effort and batched) or that is part of a parent cycle is
 * attached to the root and flagged `orphan`. Without a root at all, every
 * parentless span becomes a top-level row.
 */
export function buildTraceTree(
  spans: AdminTraceSpan[],
  traceDurationMs?: number | null,
): TraceTree {
  const byId = new Map<string, TraceNode>();
  for (const span of spans) {
    if (byId.has(span.id)) continue;
    byId.set(span.id, {
      span,
      children: [],
      parent: null,
      depth: 0,
      orphan: false,
      problem: false,
    });
  }
  const nodes = Array.from(byId.values()).sort(bySeq);

  const root =
    nodes.find((n) => n.span.kind === "turn" && !n.span.parent_id) ??
    nodes.find((n) => !n.span.parent_id) ??
    null;

  const loose: TraceNode[] = [];
  for (const node of nodes) {
    if (node === root) continue;
    const parent = node.span.parent_id
      ? byId.get(node.span.parent_id)
      : undefined;
    if (parent && parent !== node) {
      node.parent = parent;
      parent.children.push(node);
    } else {
      loose.push(node);
    }
  }

  // Anything not reachable from the root or a loose span sits in a parent
  // cycle: cut the first link found so the rest hangs off it.
  const reached = new Set<TraceNode>();
  const mark = (start: TraceNode) => {
    const stack = [start];
    while (stack.length) {
      const node = stack.pop() as TraceNode;
      if (reached.has(node)) continue;
      reached.add(node);
      stack.push(...node.children);
    }
  };
  if (root) mark(root);
  loose.forEach(mark);
  for (const node of nodes) {
    if (reached.has(node)) continue;
    const parent = node.parent;
    if (parent) parent.children = parent.children.filter((c) => c !== node);
    node.parent = null;
    loose.push(node);
    mark(node);
  }

  let roots: TraceNode[];
  if (root) {
    for (const node of loose) {
      node.orphan = true;
      node.parent = root;
      root.children.push(node);
    }
    roots = [root];
  } else {
    for (const node of loose) node.orphan = Boolean(node.span.parent_id);
    roots = loose.sort(bySeq);
  }

  const finish = (node: TraceNode, depth: number): boolean => {
    node.depth = depth;
    node.children.sort(bySeq);
    let problem = isProblemStatus(node.span.status);
    for (const child of node.children) {
      if (finish(child, depth + 1)) problem = true;
    }
    node.problem = problem;
    return problem;
  };
  roots.forEach((node) => finish(node, 0));

  let lastEnd = 0;
  for (const node of nodes) {
    const end = (node.span.start_ms ?? 0) + (node.span.duration_ms ?? 0);
    if (end > lastEnd) lastEnd = end;
  }

  return {
    roots,
    byId,
    totalMs: Math.max(traceDurationMs ?? 0, lastEnd, 1),
    orphans: nodes.filter((n) => n.orphan).length,
  };
}

/**
 * What is open when a trace is first shown: the turn, the route and every
 * tool step, plus the path down to anything that failed so a problem is
 * never hidden behind a closed row.
 */
export function defaultExpanded(tree: TraceTree): Set<string> {
  const open = new Set<string>();
  tree.byId.forEach((node) => {
    if (
      node.children.length > 0 &&
      (node.parent === null || OPEN_BY_DEFAULT.has(node.span.kind))
    ) {
      open.add(node.span.id);
    }
    if (isProblemStatus(node.span.status)) {
      for (let up = node.parent; up; up = up.parent) open.add(up.span.id);
    }
  });
  return open;
}

/**
 * The earliest step that itself did not finish cleanly (not a step that only
 * contains one): where to look first in a failed or partial turn.
 */
export function firstProblem(tree: TraceTree): TraceNode | null {
  let first: TraceNode | null = null;
  tree.byId.forEach((node) => {
    if (!isProblemStatus(node.span.status)) return;
    // A parent is flagged because of its child when both are: prefer the
    // innermost, then the earliest.
    if (node.children.some((child) => isProblemStatus(child.span.status))) {
      return;
    }
    if (!first || bySeq(node, first) < 0) first = node;
  });
  return first;
}

export interface FailedStep {
  name: string;
  status: string | null;
  error: string | null;
}

/**
 * `meta.failed_steps` of a partial trace: the steps that failed or timed out
 * while the turn was still answered. Read loosely (a name, or a record with
 * the tool, its status and its error); anything else is skipped.
 */
export function failedSteps(value: unknown): FailedStep[] {
  return asArray(value).flatMap((item) => {
    const name = asText(item);
    if (name) return [{ name, status: null, error: null }];
    const record = asRecord(item);
    if (!record) return [];
    const label =
      asText(record.tool) ??
      asText(record.name) ??
      asText(record.step) ??
      asText(record.id);
    if (!label) return [];
    return [
      {
        name: label,
        status: asText(record.status),
        error: asText(record.error),
      },
    ];
  });
}

/** `expanded` plus every ancestor of `spanId` (same set if already shown). */
export function revealSpan(
  tree: TraceTree,
  expanded: Set<string>,
  spanId: string | null,
): Set<string> {
  const node = spanId ? tree.byId.get(spanId) : undefined;
  if (!node) return expanded;
  let next = expanded;
  for (let up = node.parent; up; up = up.parent) {
    if (next.has(up.span.id)) continue;
    if (next === expanded) next = new Set(expanded);
    next.add(up.span.id);
  }
  return next;
}

/** Every span that has children. */
export function allExpandable(tree: TraceTree): Set<string> {
  const open = new Set<string>();
  tree.byId.forEach((node) => {
    if (node.children.length > 0) open.add(node.span.id);
  });
  return open;
}

/** The rows currently on screen, top to bottom. */
export function visibleRows(
  tree: TraceTree,
  expanded: Set<string>,
): TraceNode[] {
  const rows: TraceNode[] = [];
  const walk = (node: TraceNode) => {
    rows.push(node);
    if (expanded.has(node.span.id)) node.children.forEach(walk);
  };
  tree.roots.forEach(walk);
  return rows;
}

/** Ancestors of a node, outermost first. */
export function ancestorsOf(node: TraceNode): TraceNode[] {
  const chain: TraceNode[] = [];
  for (let up = node.parent; up; up = up.parent) chain.unshift(up);
  return chain;
}

/**
 * Orientation line above the tree: how the turn was routed, then the tools
 * that ran (`planner → media_llm → quiz_generator`). A turn that ran no tool
 * ends on its outcome instead (clarification, quiz_setup).
 */
export function pathSummary(
  tree: TraceTree,
  trace?: Pick<AdminTraceSummary, "plan_source" | "plan_action"> | null,
): PathStep[] {
  const ordered = Array.from(tree.byId.values()).sort(bySeq);
  const steps: PathStep[] = [];

  const router = ordered.find((n) => n.span.kind === "router");
  const source =
    asText(asRecord(router?.span.output)?.source) ?? trace?.plan_source ?? null;
  if (router || source) {
    steps.push({
      label: source ?? router?.span.name ?? "route",
      spanId: router?.span.id ?? null,
      kind: "router",
      parallel: false,
    });
  }

  const tools = ordered.filter((n) => n.span.kind === "tool");
  // Latest end among the earlier tools under each parent: a tool that
  // starts before it overlapped a sibling that was still running.
  const latestEnd = new Map<TraceNode | null, number>();
  for (const tool of tools) {
    const runningUntil = latestEnd.get(tool.parent);
    steps.push({
      label: tool.span.name,
      spanId: tool.span.id,
      kind: "tool",
      parallel: runningUntil !== undefined && tool.span.start_ms < runningUntil,
    });
    latestEnd.set(
      tool.parent,
      Math.max(
        runningUntil ?? 0,
        tool.span.start_ms + (tool.span.duration_ms ?? 0),
      ),
    );
  }

  if (tools.length === 0) {
    const outcome = ordered.find(
      (n) => n.span.kind === "decision" && n.span.name === "outcome",
    );
    const label =
      asText(asRecord(outcome?.span.output)?.outcome) ??
      trace?.plan_action ??
      null;
    if (label) {
      steps.push({
        label,
        spanId: outcome?.span.id ?? null,
        kind: "decision",
        parallel: false,
      });
    }
  }
  return steps;
}

/** `run_tool [media_llm, quiz_generator]`: a plan or a step, in a few words. */
export function planSummary(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const scalar = asText(value);
  if (scalar !== null) {
    return scalar.length > 80 ? `${scalar.slice(0, 80)}…` : scalar;
  }
  const record = asRecord(value);
  if (record) {
    const steps = asArray(record.steps)
      .map((step) => asText(asRecord(step)?.tool))
      .filter((tool): tool is string => tool !== null);
    const action = asText(record.action);
    if (action || steps.length) {
      return [action, steps.length ? `[${steps.join(", ")}]` : null]
        .filter(Boolean)
        .join(" ");
    }
    const tool = asText(record.tool);
    if (tool) {
      const model = asText(record.model);
      return model ? `${tool} (${model})` : tool;
    }
    const outcome = asText(record.outcome);
    if (outcome) return outcome;
  }
  let dumped: string;
  try {
    dumped = JSON.stringify(value) ?? "";
  } catch {
    return null;
  }
  return dumped.length > 80 ? `${dumped.slice(0, 80)}…` : dumped;
}

function usageFact(meta: Loose): string | null {
  const usage = asRecord(meta.usage);
  if (!usage) return null;
  const input =
    typeof usage.input_tokens === "number" ? usage.input_tokens : null;
  const output =
    typeof usage.output_tokens === "number" ? usage.output_tokens : null;
  if (input === null && output === null) return null;
  return `${input === null ? "?" : compactNumber(input)} → ${
    output === null ? "?" : compactNumber(output)
  } tok`;
}

/**
 * The few facts worth reading without opening the step: the model of an LLM
 * call, a prompt's template and version, where the route came from, why a
 * rule fired, how a tool was run.
 */
export function spanFacts(span: AdminTraceSpan): string[] {
  const meta = span.meta ?? {};
  const input = asRecord(span.input) ?? {};
  const output = asRecord(span.output) ?? {};
  const facts: Array<string | null> = [];

  switch (span.kind) {
    case "llm":
      facts.push(span.model ?? span.provider, usageFact(meta));
      break;
    case "prompt":
      facts.push(
        span.prompt_hash
          ? `${span.prompt_name ?? span.name} @ ${shortHash(span.prompt_hash)}`
          : (span.prompt_name ?? null),
      );
      break;
    case "router": {
      const source = asText(output.source);
      const action = asText(output.action);
      facts.push(
        source && action ? `${source} → ${action}` : (source ?? action),
      );
      break;
    }
    case "decision":
      if (span.name === "resolve_model") {
        const model = asText(output.model);
        const source = asText(output.source);
        facts.push(
          model && source ? `${model} (${source})` : (model ?? source),
        );
      } else {
        facts.push(
          asText(meta.reason) ??
            asText(output.outcome) ??
            asText(output.reason),
        );
      }
      break;
    case "tool": {
      const thread = asText(meta.thread);
      facts.push(
        asText(meta.step_kind),
        thread ? `${thread} thread` : null,
        asText(meta.model),
      );
      break;
    }
    case "retrieval":
      if (Array.isArray(output.chunks)) {
        facts.push(`${output.chunks.length} chunks`);
      }
      facts.push(asText(output.query_used) ?? asText(input.query));
      break;
    case "embedding": {
      const count = asText(input.count);
      facts.push(span.model, count ? `${count} texts` : null);
      break;
    }
    case "context": {
      const history = Array.isArray(output.history_messages)
        ? String(output.history_messages.length)
        : asText(output.history_messages);
      facts.push(history ? `${history} history messages` : null);
      break;
    }
    case "persist": {
      const messageId = asText(output.message_id);
      facts.push(messageId ? `message ${shortId(messageId)}` : null);
      break;
    }
    case "turn":
      facts.push(asText(meta.outcome));
      break;
    default:
      facts.push(span.model);
  }
  return facts.filter((fact): fact is string => Boolean(fact));
}
