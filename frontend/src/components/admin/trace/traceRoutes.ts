// Where the AI tracing views live in the admin URL, and how to get to them.
//
// AdminApp only knows two more view names, `traces` and `prompts`; everything
// else those views keep in the URL is owned here, so they can be linked to:
//
//   ?v=traces&q=…&prompt=…&tool=…&status=…&session=…&source=…&user=…&page=…
//       the Traces list and its filters
//   ?v=traces&id=<trace id>&span=<span id>
//       one trace, with the selected step
//   ?v=prompts&p=<template name | block:NAME>
//       the Prompt Map, with the open template or shared block
//
// No React components in here (hooks only), so it can be imported anywhere.

import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { ListTree, Workflow } from "lucide-react";
import type { AdminNavItem } from "@/components/admin/AdminNavPanel";
import {
  EMPTY_TRACE_FILTERS,
  parseTraceFilters,
  traceFiltersToParams,
  type TraceFilters,
} from "./traceFilters";

export type TraceView =
  | { name: "traces"; filters: TraceFilters }
  | { name: "trace"; id: string; span: string | null }
  | { name: "prompts"; selected: string | null };

/** Sidebar entries of the tracing views (keys are AdminApp view names). */
export const TRACE_NAV: AdminNavItem[] = [
  { key: "traces", label: "Traces", icon: ListTree },
  { key: "prompts", label: "Prompt Map", icon: Workflow },
];

/** The tracing view the URL names; `null` for every other admin view. */
export function parseTraceView(params: URLSearchParams): TraceView | null {
  const v = params.get("v");
  if (v === "traces") {
    const id = params.get("id");
    return id
      ? { name: "trace", id, span: params.get("span") || null }
      : { name: "traces", filters: parseTraceFilters(params) };
  }
  if (v === "prompts") {
    return { name: "prompts", selected: params.get("p") || null };
  }
  return null;
}

export function traceViewToParams(view: TraceView): Record<string, string> {
  if (view.name === "traces") {
    return { v: "traces", ...traceFiltersToParams(view.filters) };
  }
  if (view.name === "trace") {
    return view.span
      ? { v: "traces", id: view.id, span: view.span }
      : { v: "traces", id: view.id };
  }
  return view.selected ? { v: "prompts", p: view.selected } : { v: "prompts" };
}

export interface TraceNavigation {
  /** Go to a tracing view; `replace` keeps Back from replaying the step. */
  show: (view: TraceView, options?: { replace?: boolean }) => void;
  /** One trace, on its first step. */
  openTrace: (traceId: string) => void;
  /** The Traces list with only the given filters set. */
  openTraces: (filter: Partial<TraceFilters>) => void;
  /** The Prompt Map on a template or shared block. */
  openPrompt: (name: string | null) => void;
  /** A user's page (AdminApp's `?v=user&id=…`). */
  openUser: (userId: string) => void;
}

/**
 * Navigation to the tracing views from anywhere inside the admin panel (the
 * conversation viewer, a trace, the Prompt Map) by writing the URL AdminApp
 * reads, so no callback has to be threaded through the pages in between.
 */
export function useTraceNavigation(): TraceNavigation {
  const [, setSearchParams] = useSearchParams();
  return useMemo(() => {
    const show: TraceNavigation["show"] = (view, options) =>
      setSearchParams(traceViewToParams(view), { replace: options?.replace });
    return {
      show,
      openTrace: (id) => show({ name: "trace", id, span: null }),
      openTraces: (filter) =>
        show({
          name: "traces",
          filters: { ...EMPTY_TRACE_FILTERS, ...filter },
        }),
      openPrompt: (selected) => show({ name: "prompts", selected }),
      openUser: (id) => setSearchParams({ v: "user", id }),
    };
  }, [setSearchParams]);
}
