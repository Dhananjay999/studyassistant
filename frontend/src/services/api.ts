import { API_CONFIG, API_ENDPOINTS } from "@/constants/api";
import type {
  APIEnvelope,
  AssistantRequest,
  AssistantResponse,
  ChatRequest,
  ChatResponse,
  MediaItem,
  Message,
  QuizContent,
  QuizEvaluation,
  QuizFeedback,
  Session,
  User,
} from "@/types";

type TokenGetter = () => string | null;

class ApiService {
  private baseUrl: string;
  private getToken: TokenGetter = () => null;

  constructor(baseUrl: string = API_CONFIG.BASE_URL) {
    this.baseUrl = baseUrl;
  }

  setTokenGetter(getter: TokenGetter) {
    this.getToken = getter;
  }

  private headers(isJson = true): Record<string, string> {
    const h: Record<string, string> = {};
    if (isJson) h["Content-Type"] = "application/json";
    h["Accept"] = "application/json";
    const token = this.getToken();
    if (token) h["Authorization"] = `Bearer ${token}`;
    return h;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      API_CONFIG.TIMEOUT,
    );

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers: { ...this.headers(), ...options.headers },
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.msg || `Request failed: ${res.status}`);
      }

      return res.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  async getMe(): Promise<APIEnvelope<User>> {
    return this.request(API_ENDPOINTS.AUTH_ME);
  }

  async createSession(
    title = "New chat",
    mode: "media" | "web_search" = "media",
    mediaIds: string[] = [],
  ): Promise<APIEnvelope<Session>> {
    return this.request(API_ENDPOINTS.SESSIONS, {
      method: "POST",
      body: JSON.stringify({ title, mode, media_ids: mediaIds }),
    });
  }

  async listSessions(): Promise<APIEnvelope<Session[]>> {
    return this.request(API_ENDPOINTS.SESSIONS);
  }

  async deleteSession(id: string): Promise<APIEnvelope<{ id: string }>> {
    return this.request(API_ENDPOINTS.SESSION_DETAIL(id), {
      method: "DELETE",
    });
  }

  async updateSession(
    id: string,
    title: string,
  ): Promise<APIEnvelope<Session>> {
    return this.request(API_ENDPOINTS.SESSION_DETAIL(id), {
      method: "PATCH",
      body: JSON.stringify({ title }),
    });
  }

  async getMessages(id: string): Promise<APIEnvelope<Message[]>> {
    const res = await this.request<
      APIEnvelope<
        Array<{
          id: string;
          session_id: string;
          role: string;
          content: string;
          metadata: Record<string, unknown>;
          created_at: string;
        }>
      >
    >(API_ENDPOINTS.SESSION_MESSAGES(id));

    return {
      msg: res.msg,
      data: res.data.map((m) => {
        // The backend nests the tool result under metadata.content; sources
        // and quiz data live there, not at the top level.
        const md = m.metadata ?? {};
        const inner = (md.content ?? {}) as Record<string, unknown>;
        const toolUsed = md.tool_used as Message["metadata"] extends infer M
          ? M extends { tool_used?: infer T }
            ? T
            : never
          : never;
        return {
          id: m.id,
          type: m.role === "user" ? "user" : "bot",
          content: m.content,
          timestamp: new Date(m.created_at),
          metadata: {
            sources: (inner.sources as Message["metadata"] extends infer M
              ? M extends { sources?: infer S }
                ? S
                : never
              : never) || [],
            mode: md.mode as "media" | "web_search" | undefined,
            tool_used: toolUsed,
            status: md.status as Message["metadata"] extends infer M
              ? M extends { status?: infer S }
                ? S
                : never
              : never,
            run_id: md.run_id as string | undefined,
            clarification: md.clarification as Message["metadata"] extends infer M
              ? M extends { clarification?: infer C }
                ? C
                : never
              : never,
            // Only quiz messages carry quiz content; otherwise leave undefined
            // so the UI doesn't try to render a non-quiz answer as a quiz.
            quiz:
              toolUsed === "quiz_generator"
                ? (inner as unknown as QuizContent)
                : undefined,
          },
        };
      }),
    };
  }

  async uploadMedia(
    files: File[],
    sessionId?: string,
  ): Promise<APIEnvelope<MediaItem[]>> {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    if (sessionId) form.append("session_id", sessionId);

    const res = await fetch(`${this.baseUrl}${API_ENDPOINTS.MEDIA}`, {
      method: "POST",
      headers: this.headers(false),
      body: form,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.msg || "Upload failed");
    }
    return res.json();
  }

  async listMedia(sessionId?: string): Promise<APIEnvelope<MediaItem[]>> {
    const qs = sessionId ? `?session_id=${sessionId}` : "";
    return this.request(`${API_ENDPOINTS.MEDIA}${qs}`);
  }

  async deleteMedia(id: string): Promise<APIEnvelope<{ id: string }>> {
    return this.request(API_ENDPOINTS.MEDIA_DETAIL(id), {
      method: "DELETE",
    });
  }

  async sendAssistant(
    req: AssistantRequest,
  ): Promise<APIEnvelope<AssistantResponse>> {
    return this.request(API_ENDPOINTS.ASSISTANT, {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  async getQuiz(id: string): Promise<APIEnvelope<QuizContent>> {
    return this.request(API_ENDPOINTS.QUIZ(id));
  }

  async submitQuiz(
    id: string,
    answers: Record<string, string[]>,
  ): Promise<
    APIEnvelope<{
      attempt_id: string;
      evaluation: QuizEvaluation;
      feedback: QuizFeedback;
    }>
  > {
    return this.request(API_ENDPOINTS.QUIZ_SUBMIT(id), {
      method: "POST",
      body: JSON.stringify({ answers }),
    });
  }

  get assistantStreamUrl(): string {
    return `${this.baseUrl}${API_ENDPOINTS.ASSISTANT_STREAM}`;
  }

  async sendChat(req: ChatRequest): Promise<APIEnvelope<ChatResponse>> {
    return this.request(API_ENDPOINTS.CHAT, {
      method: "POST",
      body: JSON.stringify(req),
    });
  }

  getStreamHeaders(): Record<string, string> {
    return this.headers();
  }

  get streamUrl(): string {
    return `${this.baseUrl}${API_ENDPOINTS.CHAT_STREAM}`;
  }
}

export const apiService = new ApiService();
export default apiService;
