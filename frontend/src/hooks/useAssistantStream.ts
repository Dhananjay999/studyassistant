import { useCallback, useEffect, useRef, useState } from "react";
import { assistantStreamUrl, getAuthToken } from "@/lib/api";
import type { AssistantRequest } from "@/types";

export interface StreamCallbacks {
  onChunk: (delta: string) => void;
  onComplete: (
    full: string,
    meta: { tool_used?: string; content?: Record<string, unknown> },
  ) => void;
  onClarification: (data: Record<string, unknown>) => void;
  onQuizSetup: (data: Record<string, unknown>) => void;
  onError: (message: string) => void;
}

/**
 * Drives the /assistant/stream SSE endpoint. Token chunks are batched with
 * requestAnimationFrame so React renders at ~60fps instead of per-token.
 * Handles content / clarification / quiz_setup / done frames; abortable.
 */
export function useAssistantStream() {
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
    async (request: AssistantRequest, cb: StreamCallbacks) => {
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
        const res = await fetch(assistantStreamUrl, {
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
        const meta: { tool_used?: string; content?: Record<string, unknown> } =
          {};

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
    [],
  );

  useEffect(() => () => stop(), [stop]);

  return { start, stop, streaming };
}
