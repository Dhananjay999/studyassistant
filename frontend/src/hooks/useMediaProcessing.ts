import { useCallback, useEffect, useRef } from "react";
import { getAuthToken, getMediaStatus, mediaProcessUrl } from "@/lib/api";
import type { ProcessingStage } from "@/types";

export interface ProcessingFrame {
  stage: ProcessingStage;
  pct: number;
  msg?: string;
  // Present on a terminal error frame: whether the run can be resumed (a
  // merely slow parse) — otherwise a retry re-runs indexing from scratch.
  recoverable?: boolean;
  // The backend kept the media row + file after the failure (always true on
  // current backends; absent on legacy ones that scrubbed the record).
  kept?: boolean;
}

/** Which transport delivered the terminal state (analytics). */
export type ProcessingVia = "stream" | "poll";

export interface ProcessingCallbacks {
  onFrame: (frame: ProcessingFrame) => void;
  onReady: (via: ProcessingVia) => void;
  onError: (
    message: string,
    recoverable: boolean,
    via: ProcessingVia,
    kept: boolean,
  ) => void;
}

const POLL_INTERVAL_MS = 2500;
// Give up polling status after this many consecutive failures (the record is
// unreadable — deleted, or the network is gone).
const MAX_POLL_MISSES = 3;

/**
 * Drives the /media/:id/process SSE endpoint. Mirrors useAssistantStream
 * (fetch-streaming + AbortController; EventSource can't send the auth header)
 * but tracks a controller per media id so one hook instance can process
 * several concurrent uploads. On a transient stream error it falls back to
 * polling /media/:id/status until the document is ready or failed.
 */
export function useMediaProcessing() {
  const controllers = useRef(new Map<string, AbortController>());

  const stopOne = useCallback((mediaId: string) => {
    controllers.current.get(mediaId)?.abort();
    controllers.current.delete(mediaId);
  }, []);

  const stopAll = useCallback(() => {
    controllers.current.forEach((c) => c.abort());
    controllers.current.clear();
  }, []);

  const poll = useCallback(
    async (mediaId: string, cb: ProcessingCallbacks) => {
      // Reconnect fallback: poll status until a terminal state.
      let misses = 0;
      for (;;) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        if (!controllers.current.has(mediaId)) return;
        let item;
        try {
          item = await getMediaStatus(mediaId);
          misses = 0;
        } catch {
          misses += 1;
          if (misses >= MAX_POLL_MISSES) {
            cb.onError("Processing failed.", false, "poll", false);
            stopOne(mediaId);
            return;
          }
          continue;
        }
        const status = item.processing_status ?? "ready";
        if (status === "ready") {
          cb.onReady("poll");
          stopOne(mediaId);
          return;
        }
        if (status === "error" || status === "failed") {
          // A failed row is kept server-side; retry re-runs indexing.
          cb.onError(
            item.processing_error || "Processing failed.",
            true,
            "poll",
            true,
          );
          stopOne(mediaId);
          return;
        }
        cb.onFrame({ stage: status as ProcessingStage, pct: 0 });
      }
    },
    [stopOne],
  );

  const start = useCallback(
    async (mediaId: string, cb: ProcessingCallbacks) => {
      stopOne(mediaId);
      const controller = new AbortController();
      controllers.current.set(mediaId, controller);

      try {
        const token = getAuthToken();
        const res = await fetch(mediaProcessUrl(mediaId), {
          headers: {
            Accept: "text/event-stream",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Processing failed (${res.status})`);
        const reader = res.body?.getReader();
        if (!reader) throw new Error("No response body");

        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            let frame: ProcessingFrame;
            try {
              frame = JSON.parse(line.slice(6)) as ProcessingFrame;
            } catch {
              continue;
            }
            if (frame.stage === "ready") {
              cb.onReady("stream");
              stopOne(mediaId);
              return;
            }
            if (frame.stage === "error") {
              cb.onError(
                frame.msg || "Processing failed.",
                !!frame.recoverable,
                "stream",
                !!frame.kept,
              );
              stopOne(mediaId);
              return;
            }
            cb.onFrame(frame);
          }
        }
        // Stream ended without a terminal frame -> reconcile via status.
        await poll(mediaId, cb);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        // Connection dropped mid-processing -> resume via status polling.
        await poll(mediaId, cb);
      }
    },
    [poll, stopOne],
  );

  useEffect(() => () => stopAll(), [stopAll]);

  return { start, stopOne, stopAll };
}
