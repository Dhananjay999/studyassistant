import { API_CONFIG } from "@/constants";

// Browser-compatible EventEmitter implementation
type EventListener = (...args: unknown[]) => void;

class EventEmitter {
  private events: Record<string, EventListener[]> = {};

  on(event: string, listener: EventListener): void {
    if (!this.events[event]) {
      this.events[event] = [];
    }
    this.events[event].push(listener);
  }

  off(event: string, listener: EventListener): void {
    if (!this.events[event]) return;
    const index = this.events[event].indexOf(listener);
    if (index > -1) {
      this.events[event].splice(index, 1);
    }
  }

  emit(event: string, ...args: unknown[]): void {
    if (!this.events[event]) return;
    this.events[event].forEach(listener => {
      try {
        listener(...args);
      } catch (error) {
        console.error('Error in event listener:', error);
      }
    });
  }

  removeAllListeners(): void {
    this.events = {};
  }
}

// Constants for chunk types
export const CHUNK_TYPE = {
  RESPONSE: 'response',
  ERROR: 'error',
  COMPLETE: 'complete',
  CHUNK: 'chunk',
  METADATA: 'metadata'
} as const;

// Types for streaming events
export interface StreamingChunk {
  type: 'chunk';
  content: string;
  classification?: string;
  messageId?: string;
}

export interface StreamingError {
  type: 'error';
  message: string;
  details?: unknown;
  messageId?: string;
}

export interface StreamingComplete {
  type: 'complete';
  metadata?: unknown;
  messageId?: string;
}

export interface StreamingResponse {
  type: 'response';
  content: string;
  messageId?: string;
}

export type StreamingEvent = 
  | StreamingChunk 
  | StreamingError 
  | StreamingComplete 
  | StreamingResponse;

// Request parameters interface
export interface StreamingRequestParams {
  message: string;
  n_results: number;
  search_mode: string;
  pdf_names?: string[];
}

// Configuration interface
export interface StreamingConfig {
  userId: string;
  baseUrl?: string;
  headers?: Record<string, string>;
}

class StreamingService extends EventEmitter {
  private baseUrl: string;
  private userId: string;
  private headers: Record<string, string>;
  private currentConnection: EventSource | null = null;
  private isProcessing = false;
  private accumulatedContent = '';

  constructor(config: StreamingConfig) {
    super();
    this.baseUrl = config.baseUrl || API_CONFIG.BASE_URL;
    this.userId = config.userId;
    this.headers = {
      'accept': 'application/json',
      'user-id': this.userId,
      'Content-Type': 'application/json',
      ...config.headers
    };
  }

  /**
   * Start streaming chat response
   */
  async startStream(params: StreamingRequestParams, messageId?: string): Promise<void> {
    if (this.isProcessing) {
      console.warn('Stream already in progress');
      return;
    }

    try {
      this.isProcessing = true;
      this.accumulatedContent = '';
      this.closeConnection();

      const requestBody = {
        message: params.message,
        n_results: params.n_results,
        search_mode: params.search_mode,
        ...(params.pdf_names && { pdf_names: params.pdf_names })
      };

      // Make the POST request to get the stream
      const response = await fetch(`${this.baseUrl}/chat/stream`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

      // Process the stream
      await this.processStream(response.body, messageId);

    } catch (error) {
      console.error('Streaming Service Error:', error);
      this.emit('error', {
        type: 'error',
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      } as StreamingError);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process the streaming response
   */
  private async processStream(body: ReadableStream<Uint8Array>, messageId?: string): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();

    try {
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          // Process any remaining buffer
          if (buffer.trim()) {
            this.processBuffer(buffer, messageId);
          }
          break;
        }

        // Decode the chunk and add to buffer
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        // Process complete lines
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep the last incomplete line in buffer

        for (const line of lines) {
          if (line.trim()) {
            this.processLine(line, messageId);
          }
        }
      }

      // Emit complete event with accumulated content
      this.emit('complete', {
        type: 'complete',
        metadata: {
          totalContent: this.accumulatedContent
        },
        messageId: messageId
      } as StreamingComplete);

    } catch (error) {
      console.error('Stream processing error:', error);
      this.emit('error', {
        type: 'error',
        message: error instanceof Error ? error.message : 'Stream processing error'
      } as StreamingError);
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Process a single line from the stream
   */
  private processLine(line: string, messageId?: string): void {
    // Remove 'data: ' prefix if present
    const data = line.replace(/^data: /, '').trim();
    
    if (!data) return;

    try {
      const parsed = JSON.parse(data);
      
      if (parsed.type === 'chunk') {
        // Accumulate content
        this.accumulatedContent += parsed.content;
        
        // Emit chunk event
        this.emit('chunk', {
          type: 'chunk',
          content: parsed.content,
          classification: parsed.classification,
          messageId: messageId
        } as StreamingChunk);

        // Also emit response event with accumulated content
        this.emit('response', {
          type: 'response',
          content: this.accumulatedContent,
          messageId: messageId
        } as StreamingResponse);

      } else if (parsed.type === 'error') {
        this.emit('error', {
          type: 'error',
          message: parsed.message || 'Unknown error',
          details: parsed,
          messageId: messageId
        } as StreamingError);

      } else if (parsed.type === 'complete') {
        this.emit('complete', {
          type: 'complete',
          metadata: parsed.metadata,
          messageId: messageId
        } as StreamingComplete);

      } else {
        // Handle unknown events as chunks
        if (parsed.content) {
          this.accumulatedContent += parsed.content;
          this.emit('chunk', {
            type: 'chunk',
            content: parsed.content,
            classification: parsed.classification
          } as StreamingChunk);
        }
      }
    } catch (error) {
      console.warn('Failed to parse streaming data:', data, error);
    }
  }

  /**
   * Process remaining buffer content
   */
  private processBuffer(buffer: string, messageId?: string): void {
    const lines = buffer.split('\n');
    for (const line of lines) {
      if (line.trim()) {
        this.processLine(line, messageId);
      }
    }
  }

  /**
   * Stop the current stream
   */
  stopStream(): void {
    this.isProcessing = false;
    this.closeConnection();
    this.accumulatedContent = '';
  }

  /**
   * Close the current connection
   */
  private closeConnection(): void {
    if (this.currentConnection) {
      this.currentConnection.close();
      this.currentConnection = null;
    }
  }

  /**
   * Update the user ID
   */
  updateUserId(userId: string): void {
    this.userId = userId;
    this.headers['user-id'] = userId;
  }

  /**
   * Update the base URL
   */
  updateBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl;
  }

  /**
   * Get current accumulated content
   */
  getAccumulatedContent(): string {
    return this.accumulatedContent;
  }

  /**
   * Check if currently streaming
   */
  isStreaming(): boolean {
    return this.isProcessing;
  }
}

// Singleton instance
let streamingServiceInstance: StreamingService | null = null;

/**
 * Get or create the streaming service instance
 */
export function getStreamingService(config?: StreamingConfig): StreamingService {
  if (!streamingServiceInstance) {
    if (!config) {
      throw new Error('Streaming Service configuration is required for first initialization');
    }
    streamingServiceInstance = new StreamingService(config);
  }
  return streamingServiceInstance;
}

/**
 * Initialize the streaming service with configuration
 */
export function initializeStreamingService(config: StreamingConfig): StreamingService {
  streamingServiceInstance = new StreamingService(config);
  return streamingServiceInstance;
}

/**
 * Destroy the streaming service instance
 */
export function destroyStreamingService(): void {
  if (streamingServiceInstance) {
    streamingServiceInstance.stopStream();
    streamingServiceInstance.removeAllListeners();
    streamingServiceInstance = null;
  }
}

export default StreamingService;
