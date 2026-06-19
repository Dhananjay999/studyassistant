export type MessageType = "user" | "bot";
export type ChatMode = "media" | "web_search";
export type ToolUsed = "web_search" | "media_llm" | "quiz_generator";
export type QuestionType = "single_select" | "multi_select" | "true_false";

export interface SourceInfo {
  title: string;
  url?: string;
  snippet?: string;
}

export interface ClarificationQuestion {
  id: string;
  text: string;
  options?: string[] | null;
}

export interface ClarificationData {
  reason: string;
  questions: ClarificationQuestion[];
}

export interface QuizQuestion {
  id: string;
  type: QuestionType;
  prompt: string;
  options: string[];
}

export interface QuizContent {
  quiz_id: string;
  title: string;
  topic?: string;
  questions: QuizQuestion[];
}

export interface QuizEvaluation {
  score: number;
  correct_count: number;
  total: number;
  per_question: Array<{
    question_id: string;
    is_correct: boolean;
    user_answer: string[];
    correct_answer: string[];
  }>;
}

export interface QuizFeedback {
  summary: string;
  weak_topics: string[];
  recommendations: string[];
  per_question: Array<{ question_id: string; explanation: string }>;
}

export interface Message {
  id: string;
  type: MessageType;
  content: string;
  timestamp: Date;
  metadata?: {
    sources?: SourceInfo[];
    mode?: ChatMode;
    tool_used?: ToolUsed;
    status?: "clarification_required" | "completed";
    run_id?: string;
    clarification?: ClarificationData;
    quiz?: QuizContent;
    quiz_result?: {
      evaluation: QuizEvaluation;
      feedback: QuizFeedback;
    };
  };
}

export interface Session {
  id: string;
  user_id: string;
  title: string;
  mode: ChatMode;
  created_at: string;
  updated_at: string;
}

export interface MediaItem {
  id: string;
  user_id: string;
  session_id: string | null;
  file_name: string;
  mime_type: string;
  storage_path: string;
  size_bytes: number;
  created_at: string;
  signed_url?: string;
}

export interface User {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
}

export interface APIEnvelope<T> {
  msg: string;
  data: T;
}

export interface ChatRequest {
  message: string;
  session_id: string;
  mode: ChatMode;
  media_ids?: string[];
}

export interface ChatResponse {
  answer: string;
  mode: ChatMode;
  sources: SourceInfo[];
  message_id: string;
  status?: "clarification_required" | "completed";
  run_id?: string;
  clarification?: ClarificationData;
  tool_used?: ToolUsed;
  content?: Record<string, unknown>;
}

export interface AssistantRequest {
  message: string;
  session_id: string;
  media_ids?: string[];
  run_id?: string;
  clarification?: {
    action: "answer" | "custom" | "skip";
    answers?: Record<string, string>;
    custom_text?: string;
  };
}

export interface AssistantResponse {
  status: "clarification_required" | "completed";
  run_id?: string;
  clarification?: ClarificationData;
  tool_used?: ToolUsed;
  content?: QuizContent | { answer?: string; sources?: SourceInfo[] };
  message_id?: string;
}
