export const API_ENDPOINTS = {
  AUTH_ME: "/auth/me",
  SESSIONS: "/sessions/",
  SESSION_MESSAGES: (id: string) => `/sessions/${id}/messages`,
  SESSION_DETAIL: (id: string) => `/sessions/${id}`,
  MEDIA: "/media/",
  MEDIA_DETAIL: (id: string) => `/media/${id}`,
  CHAT: "/chat/",
  CHAT_STREAM: "/chat/stream",
  ASSISTANT: "/assistant/",
  ASSISTANT_STREAM: "/assistant/stream",
  QUIZ: (id: string) => `/quiz/${id}`,
  QUIZ_SUBMIT: (id: string) => `/quiz/${id}/submit`,
} as const;

export const API_CONFIG = {
  BASE_URL: import.meta.env.VITE_API_BASE_URL || "http://localhost:8000",
  TIMEOUT: Number(import.meta.env.VITE_API_TIMEOUT) || 30000,
} as const;

export const CHAT_MODES = {
  MEDIA: "media",
  WEB_SEARCH: "web_search",
} as const;
