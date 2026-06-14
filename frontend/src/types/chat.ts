import { FileText } from "lucide-react";

// Type definitions
export type MessageType = 'user' | 'bot';
export type SearchMode = 'study_material' | 'web_search';
export type SourceType = 'pdf' | 'web';
export type ChatModeId = 'pdf' | 'web';

// API Types
export interface PDFMetadata {
  page_number: number;
  source: 'uploaded_pdf';
  doc_name: string;
}

export interface WebMetadata {
  title: string;
  link: string;
  source: 'web_search';
}

export type APIMetadata = PDFMetadata | WebMetadata;

export interface APIResponse {
  answer_source: SearchMode;
  answer: string;
  relevant_chunks: string[];
  metadata: APIMetadata[];
}

export interface APIRequest {
  message: string;
  n_results: number;
  search_mode: SearchMode;
}

export interface UploadedFilesResponse {
  user_id: string;
  file_names: string[];
  total_files: number;
}

export interface DeleteFileResponse {
  user_id: string;
  file_name: string;
  chunks_deleted: number;
  message: string;
}

export interface DeleteAllFilesResponse {
  user_id: string;
  chunks_deleted: number;
  message: string;
}

// Component Types
export interface Message {
  readonly id: string;
  readonly type: MessageType;
  readonly content: string;
  readonly timestamp: Date;
  readonly attachments?: readonly File[];
  readonly metadata?: {
    readonly sources: readonly SourceInfo[];
  };
}

export interface SourceInfo {
  readonly name: string;
  readonly pageNumber?: number;
  readonly title: string;
  readonly type: SourceType;
}

export interface ChatMode {
  readonly id: ChatModeId;
  readonly label: string;
  readonly icon: typeof FileText;
  readonly description: string;
  readonly searchMode: SearchMode;
}

export interface ChatState {
  readonly messages: Message[];
  readonly isLoading: boolean;
  readonly metadata: Record<string, boolean>;
}

// Utility function types
export type MessageIdGenerator = () => string;
export type MetadataMapper = (meta: APIMetadata) => SourceInfo;
export type PDFMetadataGuard = (meta: APIMetadata) => meta is PDFMetadata;

// Authentication Types
export interface User {
  id: number;
  email: string;
  fullname: string;
}

export interface AuthResponse {
  user: User;
  access_token: string;
  token_type: string;
  message: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  fullname: string;
}

export interface LoginRequest {
  email: string;
  password: string;
} 