// The ways from the conversation viewer (SessionDialog) into the AI execution
// traces: a "Trace" button on an assistant turn that has one (what the engine
// did to produce it) and a "Traces" button for the whole conversation.
//
// Both look the session's traces up themselves and navigate by URL, so the
// dialog only places them. They render nothing while the lookup is loading,
// when it fails, when the admin may not view traces, or when the trace tables
// do not exist: the dialog then looks exactly as it did before tracing.

import { ListTree } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAdminSessionTraces } from "@/hooks/adminTraceApi";
import type { AdminMessage } from "@/types/admin";
import type { AdminTraceSummary } from "@/types/adminTrace";
import { useTraceNavigation } from "./traceRoutes";

// The backend returns at most this many traces per session (newest first).
const SESSION_TRACE_LIMIT = 200;

/** The session's stored traces, or `null` when none can be shown. */
function useShownSessionTraces(
  sessionId: string | null | undefined,
): AdminTraceSummary[] | null {
  const { data } = useAdminSessionTraces(sessionId || null);
  if (!data || data.available === false || !Array.isArray(data.traces)) {
    return null;
  }
  return data.traces;
}

/** Trace id stamped on the message when its turn was traced. */
function stampedTraceId(message: AdminMessage): string | null {
  const id = message.metadata?.trace_id;
  return typeof id === "string" && id ? id : null;
}

/**
 * The stored trace of the turn that produced `message`. A stamped id alone is
 * not enough: the trace may have been purged since, or never stored. It is
 * trusted unseen only when the session has more traces than one lookup
 * returns.
 */
function traceIdOf(
  message: AdminMessage,
  traces: AdminTraceSummary[],
): string | null {
  const stamped = stampedTraceId(message);
  const stored = traces.find(
    (trace) =>
      trace.assistant_message_id === message.id || trace.id === stamped,
  );
  if (stored) return stored.id;
  return stamped && traces.length >= SESSION_TRACE_LIMIT ? stamped : null;
}

/** The conversation a message row belongs to (the rows are sent whole). */
function sessionIdOf(message: AdminMessage): string | null {
  const id = (message as AdminMessage & { session_id?: unknown }).session_id;
  return typeof id === "string" && id ? id : null;
}

/** "Trace" beside an assistant message's "Raw data" toggle. */
export function MessageTraceLink({ message }: { message: AdminMessage }) {
  const { openTrace } = useTraceNavigation();
  const traces = useShownSessionTraces(sessionIdOf(message));
  if (!traces || message.role === "user") return null;
  const traceId = traceIdOf(message, traces);
  if (!traceId) return null;
  return (
    <button
      type="button"
      onClick={() => openTrace(traceId)}
      data-analytics-name="Open message trace"
      title="Open the AI execution trace of this turn"
      className="ml-4 inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      <ListTree className="h-3 w-3" />
      Trace
    </button>
  );
}

/** "Traces (n)" in the dialog header: the Traces list for this session. */
export function SessionTracesButton({
  sessionId,
}: {
  sessionId: string | null;
}) {
  const { openTraces } = useTraceNavigation();
  const traces = useShownSessionTraces(sessionId);
  if (!sessionId || !traces || traces.length === 0) return null;
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-9 gap-1.5 text-xs text-muted-foreground sm:h-7"
      data-analytics-name="Open session traces"
      title="AI execution traces of this conversation"
      onClick={() => openTraces({ session: sessionId })}
    >
      <ListTree className="h-3 w-3" />
      Traces ({traces.length}
      {traces.length >= SESSION_TRACE_LIMIT && "+"})
    </Button>
  );
}
