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