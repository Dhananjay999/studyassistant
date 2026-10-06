import { useCallback, useEffect, useRef, useState } from "react";
import { assistantStreamUrl, getAuthToken } from "@/lib/api";
import type {
  AssistantRequest,
  ExamChatRequest,
  ExamLessonStreamRequest,
} from "@/types";

export interface StreamCallbacks {
  onChunk: (delta: string) => void;
  onComplete: (
    full: string,
    meta: {
      tool_used?: string;
      tools_used?: string[];
      content?: Record<string, unknown>;
    },
  ) => void;
  onClarification: (data: Record<string, unknown>) => void;
  onQuizSetup: (data: Record<string, unknown>) => void;
  onError: (message: string) => void;
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

/**
 * Drives the /assistant/stream SSE endpoint. Token chunks are batched with
 * requestAnimationFrame so React renders at ~60fps instead of per-token.
 * Handles content / clarification / quiz_setup / done frames plus the agent
 * frames (agents_planned, agent_status) of multi-agent turns; abortable.
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

        const decoder = new TextDecoder();
        let buffer = "";
        let full = "";
        const meta: {
          tool_used?: string;
          tools_used?: string[];
          content?: Record<string, unknown>;
        } = {};

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
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

            // A terminal error frame: the turn failed after streaming began
            // (e.g. an LLM/API-key/rate-limit error). The backend can't change
            // the already-sent 200 status, so it signals failure in-band here.
            if (parsed.type === "error") {
              if (rafRef.current) cancelAnimationFrame(rafRef.current);
              cb.onError(
                typeof parsed.error === "string" && parsed.error
                  ? parsed.error
                  : "Stream error",
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
            if (parsed.type === "clarification") {
              cb.onClarification(parsed.data as Record<string, unknown>);
              setStreaming(false);
              return;
            }
            if (parsed.type === "quiz_setup") {
              cb.onQuizSetup(parsed.data as Record<string, unknown>);
              setStreaming(false);
              return;
            }
            if (parsed.done) {
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
              cb.onComplete(full, meta);
              setStreaming(false);
              return;
            }
            if (typeof parsed.content === "string" && parsed.content) {
              full += parsed.content;
              pendingRef.current += parsed.content;
              if (!rafRef.current) {
                rafRef.current = requestAnimationFrame(flush);
              }
            }
          }
        }
        cb.onComplete(full, meta);
        setStreaming(false);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          setStreaming(false);
          return;
        }
        cb.onError(err instanceof Error ? err.message : "Stream error");
        setStreaming(false);
      }
    },
    [streamUrl],
  );

  useEffect(() => () => stop(), [stop]);

  return { start, stop, streaming };
}
