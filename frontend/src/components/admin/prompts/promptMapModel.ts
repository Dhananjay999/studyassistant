// Pure helpers behind the Prompt Map: how the catalog's templates, shared
// blocks and pipeline nodes relate, and therefore what an edit would touch
// (the "blast radius"). No React here, so the rules stay in one place and
// every panel (map, lists, detail) agrees on them.

import type {
  AdminFlowNode,
  AdminFlowStage,
  AdminPromptBlock,
  AdminPromptCatalog,
  AdminPromptTemplate,
  AdminPromptVersionRef,
} from "@/types/adminTrace";

/** What the page is focused on: one template or one shared block. */
export type PromptSelection =
  { kind: "template"; name: string } | { kind: "block"; name: string };

// The URL carries one string (`?p=<name>`). Template names are used as-is;
// a shared block is written as `block:<NAME>` so it deep-links too and can
// never collide with a template name.
const BLOCK_PREFIX = "block:";

export function blockSelectionKey(name: string): string {
  return `${BLOCK_PREFIX}${name}`;
}

export function parseSelection(
  selected: string | null,
): PromptSelection | null {
  if (!selected) return null;
  if (selected.startsWith(BLOCK_PREFIX)) {
    const name = selected.slice(BLOCK_PREFIX.length);
    return name ? { kind: "block", name } : null;
  }
  return { kind: "template", name: selected };
}

/** A shared block as one template embeds it. */
export interface EmbeddedBlock {
  /** Placeholder the block fills in the template, e.g. SYSTEM_PROMPT. */
  placeholder: string;
  text: string;
  /** The catalog block behind it, when the catalog lists one. */
  block: AdminPromptBlock | null;
}

export interface FlowNodeRef {
  /** Unique across the map (node ids are only trusted within a stage). */
  key: string;
  stage: AdminFlowStage;
  node: AdminFlowNode;
}

export interface CatalogIndex {
  templates: AdminPromptTemplate[];
  blocks: AdminPromptBlock[];
  stages: AdminFlowStage[];
  nodes: FlowNodeRef[];
  templateByName: Map<string, AdminPromptTemplate>;
  blockByName: Map<string, AdminPromptBlock>;
  stageById: Map<string, AdminFlowStage>;
  /** Template name → the shared blocks it embeds. */
  embedded: Map<string, EmbeddedBlock[]>;
  /** Block name → names of the templates that embed it. */
  embedders: Map<string, string[]>;
  /** Template name → pipeline nodes that render it. */
  nodesByPrompt: Map<string, FlowNodeRef[]>;
}

export function nodeKey(stage: AdminFlowStage, node: AdminFlowNode): string {
  return `${stage.id}/${node.id}`;
}

/**
 * Index the catalog once. The server sends both directions of the
 * template/block relation (`template.defaults` and `block.used_by`); they
 * are merged here so a gap in either still yields the full blast radius.
 * A default is matched to a catalog block by placeholder name, then by
 * identical text (the constant may be named differently from the
 * placeholder it fills).
 */
export function buildCatalogIndex(catalog: AdminPromptCatalog): CatalogIndex {
  const templates = catalog.templates ?? [];
  const blocks = catalog.blocks ?? [];
  const stages = catalog.flow?.stages ?? [];

  const templateByName = new Map(templates.map((t) => [t.name, t]));
  const blockByName = new Map(blocks.map((b) => [b.name, b]));
  const stageById = new Map(stages.map((s) => [s.id, s]));

  const embedded = new Map<string, EmbeddedBlock[]>();
  const embedderSets = new Map<string, Set<string>>(
    blocks.map((b) => [b.name, new Set<string>()]),
  );
  for (const template of templates) {
    const list: EmbeddedBlock[] = [];
    for (const [placeholder, text] of Object.entries(template.defaults ?? {})) {
      // Two templates can fill one placeholder with different text; the
      // catalog then numbers the variants (NAME, NAME#2). Match the text
      // first so a template is linked to the variant it really embeds.
      const variants = blocks.filter(
        (b) => b.name === placeholder || b.name.startsWith(`${placeholder}#`),
      );
      const block =
        variants.find((b) => !!b.text && b.text === text) ??
        blockByName.get(placeholder) ??
        blocks.find((b) => !!b.text && b.text === text) ??
        null;
      list.push({ placeholder, text: text ?? "", block });
      if (block) embedderSets.get(block.name)?.add(template.name);
    }
    embedded.set(template.name, list);
  }
  for (const block of blocks) {
    const set = embedderSets.get(block.name);
    for (const name of block.used_by ?? []) set?.add(name);
  }
  // Catalog order first, then names the catalog does not describe.
  const embedders = new Map<string, string[]>();
  for (const [name, set] of embedderSets) {
    const known = templates.filter((t) => set.has(t.name)).map((t) => t.name);
    const unknown = [...set].filter((n) => !templateByName.has(n));
    embedders.set(name, [...known, ...unknown]);
  }

  const nodes: FlowNodeRef[] = [];
  const nodesByPrompt = new Map<string, FlowNodeRef[]>();
  for (const stage of stages) {
    for (const node of stage.nodes ?? []) {
      const ref = { key: nodeKey(stage, node), stage, node };
      nodes.push(ref);
      if (node.prompt) {
        const list = nodesByPrompt.get(node.prompt) ?? [];
        list.push(ref);
        nodesByPrompt.set(node.prompt, list);
      }
    }
  }

  return {
    templates,
    blocks,
    stages,
    nodes,
    templateByName,
    blockByName,
    stageById,
    embedded,
    embedders,
    nodesByPrompt,
  };
}

/** What changes if the selection is edited. */
export interface BlastRadius {
  /** Templates whose rendered text changes (catalog order). */
  templates: string[];
  /** Pipeline nodes that render one of those templates. */
  nodes: FlowNodeRef[];
  nodeKeys: Set<string>;
  /** Affected templates that no pipeline node renders. */
  offMap: string[];
}

export function blastRadius(
  index: CatalogIndex,
  selection: PromptSelection | null,
): BlastRadius {
  const templates = !selection
    ? []
    : selection.kind === "template"
      ? [selection.name]
      : (index.embedders.get(selection.name) ?? []);
  const names = new Set(templates);
  const nodes = index.nodes.filter(
    (ref) => !!ref.node.prompt && names.has(ref.node.prompt),
  );
  return {
    templates,
    nodes,
    nodeKeys: new Set(nodes.map((ref) => ref.key)),
    offMap: templates.filter((name) => !index.nodesByPrompt.has(name)),
  };
}

export type FlowRelation = "upstream" | "downstream";

const normalise = (value: string | null | undefined) =>
  (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Pipeline nodes named in a template's `usage.upstream` / `usage.downstream`.
 * Those lists are human-readable step names, so this is an exact match on a
 * node's label, id, tool or prompt (ignoring case and punctuation): a step
 * that cannot be matched is simply not tagged on the map, and the detail
 * panel still lists it.
 */
export function relatedNodes(
  index: CatalogIndex,
  template: AdminPromptTemplate | null,
): Map<string, FlowRelation> {
  const related = new Map<string, FlowRelation>();
  if (!template) return related;
  const tag = (steps: string[] | undefined, relation: FlowRelation) => {
    const wanted = new Set((steps ?? []).map(normalise).filter(Boolean));
    if (!wanted.size) return;
    for (const ref of index.nodes) {
      if (ref.node.prompt === template.name || related.has(ref.key)) continue;
      const names = [
        ref.node.label,
        ref.node.id,
        ref.node.tool,
        ref.node.prompt,
      ];
      if (names.some((n) => !!n && wanted.has(normalise(n)))) {
        related.set(ref.key, relation);
      }
    }
  };
  tag(template.usage?.upstream, "upstream");
  tag(template.usage?.downstream, "downstream");
  return related;
}

// --- Placeholder tokens ---------------------------------------------------

/** How a `{PLACEHOLDER}` is resolved when the template is rendered. */
export type PlaceholderKind =
  "required" | "optional" | "block" | "marker" | "other";

export const PLACEHOLDER_KINDS: PlaceholderKind[] = [
  "required",
  "optional",
  "block",
  "marker",
];

export const PLACEHOLDER_INFO: Record<
  PlaceholderKind,
  { label: string; hint: string }
> = {
  required: {
    label: "Runtime value",
    hint: "Required: the caller must supply it on every render.",
  },
  optional: {
    label: "Optional",
    hint: "Optional: renders as nothing when the caller leaves it out.",
  },
  block: {
    label: "Shared block",
    hint: "Replaced by a shared block of prompt text; editing the block changes every template that embeds it.",
  },
  marker: {
    label: "Marker",
    hint: "Marker: renders as nothing. It documents where content that is passed separately (such as the conversation history) belongs.",
  },
  other: {
    label: "Placeholder",
    hint: "Resolved by the template that embeds this text.",
  },
};

/** Placeholder name → kind, for one template. */
export function placeholderKinds(
  template: AdminPromptTemplate,
): Map<string, PlaceholderKind> {
  const kinds = new Map<string, PlaceholderKind>();
  const p = template.placeholders;
  // Later writes win: a name that is both supplied and defaulted is a block.
  for (const name of p?.required ?? []) kinds.set(name, "required");
  for (const name of p?.optional ?? []) kinds.set(name, "optional");
  for (const name of p?.markers ?? []) kinds.set(name, "marker");
  for (const name of p?.blocks ?? []) kinds.set(name, "block");
  for (const name of Object.keys(template.defaults ?? {})) {
    kinds.set(name, "block");
  }
  return kinds;
}

export interface TextSegment {
  text: string;
  placeholder?: { name: string; kind: PlaceholderKind };
}

// Same rule as the backend's PromptBuilder: only `{UPPER_SNAKE}` is a
// placeholder, so JSON braces inside a prompt stay plain text.
const PLACEHOLDER_RE = /\{([A-Z_][A-Z0-9_]*)\}/g;

/** Split template text into plain runs and placeholder tokens. */
export function segmentText(
  text: string,
  kinds: Map<string, PlaceholderKind>,
): TextSegment[] {
  const segments: TextSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(PLACEHOLDER_RE)) {
    const start = match.index ?? 0;
    if (start > last) segments.push({ text: text.slice(last, start) });
    segments.push({
      text: match[0],
      placeholder: { name: match[1], kind: kinds.get(match[1]) ?? "other" },
    });
    last = start + match[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last) });
  return segments;
}

// --- Versions -------------------------------------------------------------

export interface VersionRow {
  hash: string;
  /** The version deployed now. */
  current: boolean;
  /** Usage in the selected window; null when this version did not run. */
  uses: number | null;
  traces: number | null;
  firstSeen: string | null;
  lastUsed: string | null;
  gitSha: string | null;
  /** Whether the catalog lists stored text for this version. */
  stored: boolean;
}

const earliest = (a: string | null, b: string | null) =>
  !a ? b : !b ? a : Date.parse(a) <= Date.parse(b) ? a : b;

/**
 * One row per version of a template: usage (`stats.versions`) joined with
 * the stored versions (`catalog.versions`). The deployed version is always
 * present and first; the rest are newest first.
 */
export function versionRows(
  template: AdminPromptTemplate,
  refs: AdminPromptVersionRef[] | undefined,
): VersionRow[] {
  const rows = new Map<string, VersionRow>();
  const row = (hash: string): VersionRow => {
    let found = rows.get(hash);
    if (!found) {
      found = {
        hash,
        current: hash === template.hash,
        uses: null,
        traces: null,
        firstSeen: null,
        lastUsed: null,
        gitSha: null,
        stored: false,
      };
      rows.set(hash, found);
    }
    return found;
  };

  if (template.hash) row(template.hash);
  for (const stat of template.stats?.versions ?? []) {
    if (!stat.hash) continue;
    const r = row(stat.hash);
    r.uses = (r.uses ?? 0) + (stat.uses ?? 0);
    r.traces = (r.traces ?? 0) + (stat.traces ?? 0);
    r.firstSeen = earliest(r.firstSeen, stat.first_used ?? null);
    r.lastUsed = stat.last_used ?? r.lastUsed;
  }
  for (const ref of refs ?? []) {
    if (ref.name !== template.name || !ref.hash) continue;
    const r = row(ref.hash);
    r.stored = true;
    r.gitSha = ref.git_sha ?? r.gitSha;
    r.firstSeen = earliest(r.firstSeen, ref.first_seen_at ?? null);
  }

  const recency = (r: VersionRow) =>
    Date.parse(r.lastUsed ?? r.firstSeen ?? "") || 0;
  return [...rows.values()].sort(
    (a, b) => Number(b.current) - Number(a.current) || recency(b) - recency(a),
  );
}

// --- Formatting -----------------------------------------------------------

/** Compact "3h ago" for list rows (absolute dates live in the detail). */
export function timeAgo(
  iso: string | null | undefined,
  now: number = Date.now(),
): string {
  if (!iso) return "never";
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "—";
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function plural(count: number, noun: string, many?: string): string {
  return `${count.toLocaleString()} ${count === 1 ? noun : (many ?? `${noun}s`)}`;
}
