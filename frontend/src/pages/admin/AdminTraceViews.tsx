// The AI tracing pages of the admin panel (Traces, one trace, Prompt Map),
// mounted by AdminApp with a single line. AdminApp knows `traces` and
// `prompts` as view names (and takes their sidebar entries from
// `traceRoutes`); which page that is, and everything else those pages keep in
// the URL (filters, the open trace and its selected step, the open prompt),
// is read and written through `traceRoutes`.
//
// Renders nothing on every other admin view, and stays mounted across them so
// "Back to traces" can return to the list as it was last filtered.

import { useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  EMPTY_TRACE_FILTERS,
  type TraceFilters,
} from "@/components/admin/trace/traceFilters";
import {
  parseTraceView,
  useTraceNavigation,
} from "@/components/admin/trace/traceRoutes";
import { AdminPromptMap } from "@/pages/admin/AdminPromptMap";
import { AdminTraceDetail } from "@/pages/admin/AdminTraceDetail";
import { AdminTraces } from "@/pages/admin/AdminTraces";

export function AdminTraceViews() {
  const [searchParams] = useSearchParams();
  const view = useMemo(() => parseTraceView(searchParams), [searchParams]);
  const { show, openTrace, openTraces, openPrompt, openUser } =
    useTraceNavigation();
  const lastFilters = useRef<TraceFilters>(EMPTY_TRACE_FILTERS);
  if (view?.name === "traces") lastFilters.current = view.filters;

  if (!view) return null;
  if (view.name === "traces") {
    return (
      <AdminTraces
        filters={view.filters}
        // Replace: typing in the search box must not fill the history.
        onFiltersChange={(filters) =>
          show({ name: "traces", filters }, { replace: true })
        }
        onOpenTrace={openTrace}
      />
    );
  }
  if (view.name === "trace") {
    return (
      <AdminTraceDetail
        key={view.id}
        traceId={view.id}
        spanId={view.span}
        // Replace: Back leaves the trace instead of replaying selections.
        onSelectSpan={(span) =>
          show({ name: "trace", id: view.id, span }, { replace: true })
        }
        onBack={() => show({ name: "traces", filters: lastFilters.current })}
        onOpenPrompt={openPrompt}
        onOpenTraces={openTraces}
        onOpenUser={openUser}
      />
    );
  }
  return (
    <AdminPromptMap
      selected={view.selected}
      onSelect={openPrompt}
      onOpenTraces={openTraces}
    />
  );
}
