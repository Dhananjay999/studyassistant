import { useCallback, useEffect, useRef, useState } from "react";
import { assistantStreamUrl, getAuthToken } from "@/lib/api";
import type {
  AssistantRequest,
  ExamChatRequest,
  ExamLessonStreamRequest,
} from "@/types";

/** Where a stream was when it stopped: connecting, waiting for the first
 *  answer token (tool running), or mid-answer. */
export type StreamStage = "connect" | "waiting" | "streaming";

/** Context attached to a failure or a drop, for analytics (ids/numbers only). */
export interface StreamFailureInfo {
  stage: StreamStage;
  /** ms since the last frame (or since the request) when it gave up. */
  elapsed_ms: number;
  /** Backend trace id when any frame carried one. */
  trace_id: string | null;
}

export interface StreamCallbacks {
  onChunk: (delta: string) => void;
  onComplete: (
    full: string,
    meta: {
      tool_used?: string;
      tools_used?: string[];
      content?: Record<string, unknown>;
      /** Persisted ids from the final frame (absent on older backends). */
      assistant_message_id?: string;
      user_message_id?: string;
      /** Developer Mode only: the "powered by" trailer, sent as its own
       *  frame so it is never part of the answer text. */
      model_badge?: { model: string; badge: string };
    },
  ) => void;
  onClarification: (data: Record<string, unknown>) => void;
  onQuizSetup: (data: Record<string, unknown>) => void;
  onError: (message: string, info?: StreamFailureInfo) => void;
  /** The connection went quiet (no frame for `INACTIVITY_MS`) or broke after
   *  the server had accepted the turn. The answer is very likely persisted
   *  server-side, so the caller can refetch instead of showing an error.
   *  Providing it also arms the inactivity watchdog; without it a stream
   *  behaves as before (no timeout, network errors go to `onError`). */
  onDropped?: (info: StreamFailureInfo & { reason: "inactivity" | "network" }) => void;
  /** The orchestrator picked a tool — lets the UI switch to a
   *  context-specific loader before any answer tokens arrive. */
  onToolSelected?: (tool: string) => void;
  /** The roster of agents planned for this turn (always sent; one agent on
   *  ordinary turns). `parallel` is true when agents run concurrently. */
  onAgentsPlanned?: (agents: unknown[], parallel: boolean) => void;
  /** One agent changed state (queued → running → done / failed) or reported
   *  a progress note. Interleaves with answer tokens. */
  onAgentStatus?: (update: {
    id: string;
    tool: string;
    status: string;
    ms?: number;
    note?: string;
    error?: string;
  }) => void;
}

/** No frame (token, agent status or `ping` heartbeat) for this long and the
 *  stream is treated as dropped. The backend pings every ~15 s while a slow
 *  tool runs, so a healthy turn never trips this. */
export const INACTIVITY_MS = 45_000;

/**
 * Drives the /assistant/stream SSE endpoint. Token chunks are batched with
 * requestAnimationFrame so React renders at ~60fps instead of per-token.
 * Handles content / clarification / quiz_setup / done frames plus the agent
 * frames (agents_planned, agent_status) of multi-agent turns; abortable.
 * `ping` heartbeat frames only reset the inactivity watchdog.
 */
export function useAssistantStream(streamUrl: string = assistantStreamUrl) {
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef("");

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    pendingRef.current = "";
    setStreaming(false);
  }, []);

  const start = useCallback(
    // The Exam Prep streams (`examChatStreamUrl`, `examLessonStreamUrl`) take
    // their own strict bodies; the union keeps ChatPage's AssistantRequest
    // calls unchanged.
    async (
      request: AssistantRequest | ExamChatRequest | ExamLessonStreamRequest,
      cb: StreamCallbacks,
    ) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      pendingRef.current = "";
      setStreaming(true);

      const flush = () => {
        if (pendingRef.current) {
          cb.onChunk(pendingRef.current);
          pendingRef.current = "";
        }
        rafRef.current = null;
      };

      // Failure context: stage of the turn, time since the last frame, and
      // the backend trace id if a frame carried one.
      let stage: StreamStage = "connect";
      let lastFrameAt = performance.now();
      let traceId: string | null = null;
      // Set by the watchdog right before it aborts, so the AbortError below
      // is told apart from the user's own Stop.
      let droppedByWatchdog = false;
      let watchdog: number | null = null;
      const disarm = () => {
        if (watchdog !== null) window.clearTimeout(watchdog);
        watchdog = null;
      };
      // The watchdog is opt-in (callers that handle `onDropped`): streams
      // without a server heartbeat (Exam Prep) keep their old no-timeout
      // behaviour.
      const arm = () => {
        disarm();
        lastFrameAt = performance.now();
        if (!cb.onDropped) return;
        watchdog = window.setTimeout(() => {
          droppedByWatchdog = true;
          controller.abort();
        }, INACTIVITY_MS);
      };
      const info = (): StreamFailureInfo => ({
        stage,
        elapsed_ms: Math.round(performance.now() - lastFrameAt),
        trace_id: traceId,
      });

      arm();
      try {
        const token = getAuthToken();
        const res = await fetch(streamUrl, {
          method: "POST",
          headers: {
            Accept: "text/event-stream",
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Stream failed (${res.status})`);
        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body");
        stage = "waiting";
        arm();

        const decoder = new TextDecoder();
        let buffer = "";
        let full = "";
        const meta: Parameters<StreamCallbacks["onComplete"]>[1] = {};

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          arm();
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            let parsed: Record<string, unknown>;
            try {
              parsed = JSON.parse(line.slice(6));
            } catch {
              continue;
            }
            if (typeof parsed.trace_id === "string" && parsed.trace_id) {
              traceId = parsed.trace_id;
            }

            // Heartbeat while a slow tool runs: nothing to render, the
            // read above already reset the watchdog.
            if (parsed.type === "ping") continue;

            // A terminal error frame: the turn failed after streaming began
            // (e.g. an LLM/API-key/rate-limit error). The backend can't change
            // the already-sent 200 status, so it signals failure in-band here.
            if (parsed.type === "error") {
              if (rafRef.current) cancelAnimationFrame(rafRef.current);
              disarm();
              cb.onError(
                typeof parsed.error === "string" && parsed.error
                  ? parsed.error
                  : "Stream error",
                info(),
              );
              setStreaming(false);
              return;
            }
            if (parsed.type === "tool_selected") {
              if (typeof parsed.tool === "string" && parsed.tool) {
                cb.onToolSelected?.(parsed.tool);
              }
              continue;
            }
            if (parsed.type === "agents_planned") {
              if (Array.isArray(parsed.agents)) {
                cb.onAgentsPlanned?.(parsed.agents, parsed.parallel === true);
              }
              continue;
            }
            if (parsed.type === "agent_status") {
              if (
                typeof parsed.id === "string" &&
                typeof parsed.tool === "string" &&
                typeof parsed.status === "string"
              ) {
                cb.onAgentStatus?.({
                  id: parsed.id,
                  tool: parsed.tool,
                  status: parsed.status,
                  ms: typeof parsed.ms === "number" ? parsed.ms : undefined,
                  note:
                    typeof parsed.note === "string" ? parsed.note : undefined,
                  error:
                    typeof parsed.error === "string"
                      ? parsed.error
                      : undefined,
                });
              }
              continue;
            }
            if (parsed.type === "model_badge") {
              // Display-only (debug users): kept in the completion meta,
              // never added to the streamed text.
              if (typeof parsed.badge === "string" && parsed.badge) {
                meta.model_badge = {
                  model: typeof parsed.model === "string" ? parsed.model : "",
                  badge: parsed.badge,
                };
              }
              continue;
            }
            if (parsed.type === "clarification") {
              disarm();
              cb.onClarification(parsed.data as Record<string, unknown>);
              setStreaming(false);
              return;
            }
            if (parsed.type === "quiz_setup") {
              disarm();
              cb.onQuizSetup(parsed.data as Record<string, unknown>);
              setStreaming(false);
              return;
            }
            if (parsed.done) {
              disarm();
              if (rafRef.current) {
                cancelAnimationFrame(rafRef.current);
                flush();
              }
              if (parsed.tool_used) meta.tool_used = parsed.tool_used as string;
              if (Array.isArray(parsed.tools_used)) {
                meta.tools_used = parsed.tools_used as string[];
              }
              if (parsed.content)
                meta.content = parsed.content as Record<string, unknown>;
              // Persisted ids let the UI swap its optimistic placeholders
              // (bookmarks and notes must never reference a client-only
              // id). Tolerant: older backends send neither.
              const assistantId =
                typeof parsed.assistant_message_id === "string"
                  ? parsed.assistant_message_id
                  : typeof parsed.message_id === "string"
                    ? parsed.message_id
                    : "";
              if (assistantId) meta.assistant_message_id = assistantId;
              if (typeof parsed.user_message_id === "string" && parsed.user_message_id) {
                meta.user_message_id = parsed.user_message_id;
              }
              cb.onComplete(full, meta);
              setStreaming(false);
              return;
            }
            if (typeof parsed.content === "string" && parsed.content) {
              stage = "streaming";
              full += parsed.content;
              pendingRef.current += parsed.content;
              if (!rafRef.current) {
                rafRef.current = requestAnimationFrame(flush);
              }
            }
          }
        }
        disarm();
        cb.onComplete(full, meta);
        setStreaming(false);
      } catch (err) {
        disarm();
        if (err instanceof DOMException && err.name === "AbortError") {
          setStreaming(false);
          if (!droppedByWatchdog) return; // the user pressed Stop
          if (cb.onDropped) cb.onDropped({ ...info(), reason: "inactivity" });
          else cb.onError("Stream timed out", info());
          return;
        }
        // The server had accepted the turn (headers arrived) and the body
        // then broke: a dropped connection, not a refused request.
        if (stage !== "connect" && cb.onDropped) {
          setStreaming(false);
          cb.onDropped({ ...info(), reason: "network" });
          return;
        }
        cb.onError(err instanceof Error ? err.message : "Stream error", info());
        setStreaming(false);
      }
    },
    [streamUrl],
  );

  useEffect(() => () => stop(), [stop]);

  return { start, stop, streaming };
}
