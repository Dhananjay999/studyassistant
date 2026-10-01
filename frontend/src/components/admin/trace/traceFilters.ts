// The Traces list keeps its filters in the URL (`?v=traces&q=…&prompt=…`),
// so a filtered list can be linked to from a session, a prompt or a tool.
// This module is the single mapping between those params, the filter object
// the page works with, and the query the API expects.

import type { AdminTracesParams } from "@/types/adminTrace";

export interface TraceFilters {
  /** Free text, or any id: trace, session, message, user, run. */
  q: string;
  prompt: string;
  tool: string;
  status: string;
  /** Session id. */
  session: string;
  /** Route taken (`plan_source`): planner, fast_path, … */
  source: string;
  /** User id. */
  user: string;
  page: number;
}

export const EMPTY_TRACE_FILTERS: TraceFilters = {
  q: "",
  prompt: "",
  tool: "",
  status: "",
  session: "",
  source: "",
  user: "",
  page: 1,
};

const TEXT_KEYS = [
  "q",
  "prompt",
  "tool",
  "status",
  "session",
  "source",
  "user",
] as const;

export const TRACE_PAGE_SIZE = 25;

export function parseTraceFilters(params: URLSearchParams): TraceFilters {
  const filters: TraceFilters = { ...EMPTY_TRACE_FILTERS };
  for (const key of TEXT_KEYS) filters[key] = params.get(key) ?? "";
  const page = Number.parseInt(params.get("page") ?? "", 10);
  filters.page = Number.isFinite(page) && page > 1 ? page : 1;
  return filters;
}

/** Only the filters that are set, so a plain list keeps a clean URL. */
export function traceFiltersToParams(
  filters: TraceFilters,
): Record<string, string> {
  const params: Record<string, string> = {};
  for (const key of TEXT_KEYS) {
    if (filters[key]) params[key] = filters[key];
  }
  if (filters.page > 1) params.page = String(filters.page);
  return params;
}

export function traceFiltersToQuery(filters: TraceFilters): AdminTracesParams {
  return {
    q: filters.q.trim(),
    user_id: filters.user,
    session_id: filters.session,
    status: filters.status,
    tool: filters.tool,
    prompt: filters.prompt,
    plan_source: filters.source,
    page: filters.page,
    page_size: TRACE_PAGE_SIZE,
  };
}
