// Types for AI execution traces in the Super Admin panel (Traces and Prompt
// Map). Kept out of `types/admin.ts` so that file stays as it was.

// ---------------------------------------------------------------------------
// AI execution traces (Admin → Traces / Prompt map).
// One trace = one chat turn; spans are its steps, nested by `parent_id`.
// ---------------------------------------------------------------------------

export type AdminTraceStatus =
  | "completed"
  /** Answered and saved, but a step failed or timed out. */
  | "partial"
  | "clarification"
  | "quiz_setup"
  | "error"
  | "aborted";

export type AdminSpanKind =
  | "turn"
  | "context"
  | "router"
  | "decision"
  | "tool"
  | "prompt"
  | "llm"
  | "embedding"
  | "retrieval"
  | "persist";

export type AdminSpanStatus =
  "ok" | "error" | "aborted" | "timeout" | "skipped" | "unfinished";

/** One row of the trace list (and the header of the detail view). */
export interface AdminTraceSummary {
  id: string;
  kind: string;
  user_id: string | null;
  session_id: string | null;
  run_id: string | null;
  user_message_id: string | null;
  assistant_message_id: string | null;
  endpoint: string | null;
  status: AdminTraceStatus | string;
  error: string | null;
  /** The user's message (truncated). */
  query: string | null;
  /** forced | media_choice | continuation | fast_path | planner | … */
  plan_source: string | null;
  plan_action: string | null;
  tools: string[];
  models: string[];
  prompt_names: string[];
  span_count: number;
  llm_calls: number;
  duration_ms: number | null;
  started_at: string;
  git_sha: string | null;
  created_at: string;
  owner_id?: string | null;
  owner_email?: string | null;
  owner_name?: string | null;
  meta?: Record<string, unknown>;
}

/** One recorded step. `input` / `output` / `meta` shapes depend on `kind`. */
export interface AdminTraceSpan {
  id: string;
  trace_id: string;
  parent_id: string | null;
  /** Creation order within the trace; siblings render in this order. */
  seq: number;
  kind: AdminSpanKind | string;
  name: string;
  status: AdminSpanStatus | string;
  /** Offset from the start of the trace. */
  start_ms: number;
  duration_ms: number | null;
  provider: string | null;
  model: string | null;
  prompt_name: string | null;
  /** Content hash of the prompt template: its version. */
  prompt_hash: string | null;
  input: unknown;
  output: unknown;
  meta: Record<string, unknown>;
  error: string | null;
}

export interface AdminTraceList {
  items: AdminTraceSummary[];
  total: number;
  page: number;
  page_size: number;
  /** False until migration 024 is applied (the trace tables are missing). */
  available: boolean;
}

export interface AdminTraceDetail {
  trace: AdminTraceSummary;
  spans: AdminTraceSpan[];
}

/** Traces of one conversation, newest first (links messages to traces). */
export interface AdminSessionTraces {
  traces: AdminTraceSummary[];
  /** False when traces cannot be shown: the tables are missing (migration
   * 024), or this admin lacks the permission to view them. */
  available?: boolean;
}

export interface AdminTracesParams {
  /** Free text (matches the query) or any id: trace, session, user,
   * message, run. */
  q: string;
  user_id: string;
  session_id: string;
  status: string;
  tool: string;
  prompt: string;
  plan_source: string;
  page: number;
  page_size: number;
}

/** Where a prompt template sits in the pipeline (static, from the code). */
export interface AdminPromptUsage {
  /** Pipeline stage id (matches a `flow.stages[].id`). */
  stage: string;
  /** Tool that renders it, when it belongs to one. */
  tool: string | null;
  /** `path:line` of the build() call. */
  call_site: string | null;
  /** generate_stream | generate_structured | generate_image | … */
  llm_method: string | null;
  /** Config key that selects the model, e.g. LLM_MEDIA_MODEL. */
  config_key: string | null;
  /** False for templates no code path renders. */
  live: boolean;
  description: string;
  /** What runs before / after this prompt (human-readable step names). */
  upstream: string[];
  downstream: string[];
}

export interface AdminPromptVersionStat {
  hash: string;
  uses: number;
  traces: number;
  first_used: string | null;
  last_used: string | null;
}

export interface AdminPromptTemplate {
  name: string;
  /** Hash of the template as deployed now. */
  hash: string;
  system: string;
  user: string;
  /** Shared blocks it embeds: placeholder name → block text. */
  defaults: Record<string, string>;
  placeholders: {
    required: string[];
    optional: string[];
    markers: string[];
    blocks: string[];
  };
  uses_history: boolean;
  uses_attachments: boolean;
  /** Python constant that defines it, e.g. GENERAL_ANSWER_TEMPLATE. */
  constant?: string | null;
  /** `path:line` of the template definition. */
  source?: string | null;
  usage: AdminPromptUsage;
  stats: {
    uses: number;
    traces: number;
    last_used: string | null;
    versions: AdminPromptVersionStat[];
  };
}

/** A shared block and every template that embeds it (its blast radius). */
export interface AdminPromptBlock {
  name: string;
  /** `path:line` where the block is defined. */
  source: string | null;
  chars: number;
  text: string;
  used_by: string[];
}

export interface AdminFlowNode {
  id: string;
  label: string;
  description: string;
  /** entry | context | rule | llm | outcome | tool | retrieval | persist */
  kind: string;
  /** Prompt template this node renders, if any. */
  prompt: string | null;
  tool: string | null;
  /** When this node is taken. */
  condition: string | null;
  /** `path:line` in the backend. */
  code: string | null;
}

export interface AdminFlowStage {
  id: string;
  title: string;
  description: string;
  nodes: AdminFlowNode[];
}

/** A stored version of a template (text fetched on demand). */
export interface AdminPromptVersionRef {
  name: string;
  hash: string;
  git_sha: string | null;
  /** Null for the deployed version when no trace has stored it yet. */
  first_seen_at: string | null;
}

export interface AdminPromptVersion extends AdminPromptVersionRef {
  system_template: string;
  user_template: string;
  defaults: Record<string, string>;
}

export interface AdminPromptCatalog {
  templates: AdminPromptTemplate[];
  blocks: AdminPromptBlock[];
  flow: { stages: AdminFlowStage[] };
  versions: AdminPromptVersionRef[];
  stats_days: number;
  /** False until migration 024 is applied (usage counts are then zero). */
  stats_available: boolean;
}
