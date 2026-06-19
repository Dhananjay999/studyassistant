import { API_CONFIG, API_ENDPOINTS } from "@/constants/api";
import type { AssistantRequest } from "@/types";

type TokenGetter = () => string | null;

export interface StreamCallbacks {
  onChunk: (content: string) => void;
  onComplete: (fullContent: string, meta?: Record<string, unknown>) => void;
  onClarification?: (data: Record<string, unknown>) => void;
  onError: (error: string) => void;
}

class StreamingService {
  private getToken: TokenGetter = () => null;
  private abortController: AbortController | null = null;
  private rafId: number | null = null;
  private pendingContent = "";

  setTokenGetter(getter: TokenGetter) {
    this.getToken = getter;
  }

  private flush(onChunk: (c: string) => void) {
    if (this.pendingContent) {
      onChunk(this.pendingContent);
      this.pendingContent = "";
    }
    this.rafId = null;
  }

  async startStream(
    request: AssistantRequest,
    callbacks: StreamCallbacks,
    useAssistant = true,
  ): Promise<void> {
    this.stopStream();
    this.abortController = new AbortController();

    const token = this.getToken();
    const headers: Record<string, string> = {
      Accept: "text/event-stream",
      "Content-Type": "application/json",
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const url = useAssistant
      ? `${API_CONFIG.BASE_URL}${API_ENDPOINTS.ASSISTANT_STREAM}`
      : `${API_CONFIG.BASE_URL}${API_ENDPOINTS.CHAT_STREAM}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(request),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`Stream failed: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";
      let meta: Record<string, unknown> = {};

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const parsed = JSON.parse(line.slice(6));

            if (parsed.type === "clarification") {
              callbacks.onClarification?.(parsed.data);
              callbacks.onComplete("", { clarification: parsed.data });
              return;
            }

            if (parsed.done) {
              if (this.rafId) {
                cancelAnimationFrame(this.rafId);
                this.flush(callbacks.onChunk);
              }
              if (parsed.tool_used) meta.tool_used = parsed.tool_used;
              if (parsed.content) meta.content = parsed.content;
              callbacks.onComplete(fullContent, meta);
              return;
            }
            if (parsed.content) {
              fullContent += parsed.content;
              this.pendingContent += parsed.content;
              if (!this.rafId) {
                this.rafId = requestAnimationFrame(() =>
                  this.flush(callbacks.onChunk),
                );
              }
            }
          } catch {
            /* skip malformed */
          }
        }
      }

      callbacks.onComplete(fullContent, meta);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      callbacks.onError(
        err instanceof Error ? err.message : "Stream error",
      );
    }
  }

  stopStream() {
    this.abortController?.abort();
    this.abortController = null;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.pendingContent = "";
  }
}

export const streamingService = new StreamingService();
