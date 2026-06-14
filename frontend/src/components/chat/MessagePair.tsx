import { useState, useEffect, useRef, memo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  User,
  Bot,
  Bookmark,
  Copy,
  Share2,
  FileText,
  Volume2,
  Network,
  ChevronDown,
  ChevronUp,
  Info
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Message } from "@/types";
import ReactMarkdown from "react-markdown";
import { getStreamingService, StreamingRequestParams, StreamingChunk, StreamingError, StreamingComplete, StreamingResponse } from "@/services/streamingService";
import 'katex/dist/katex.min.css';
import { InlineMath, BlockMath } from 'react-katex';

import { 
  createMessageId
} from "@/utils";

interface MessagePairProps {
  userMessage: Message;
  selectedMode: 'pdf' | 'web';
  searchMode: string;
  selectedFiles?: Set<string>;
  onBotResponse?: (botMessage: Message) => void;
  onError?: (error: string) => void;
}

const MessagePair = memo(({
  userMessage,
  selectedMode,
  searchMode,
  selectedFiles,
  onBotResponse,
  onError
}: MessagePairProps) => {
  const [showSources, setShowSources] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [botMessage, setBotMessage] = useState<Message | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streamedAnswer, setStreamedAnswer] = useState('');
  const hasMadeAPICallRef = useRef(false);
  const hasNotifiedParentRef = useRef(false);
  const isMountedRef = useRef(true);
  const streamingServiceRef = useRef<ReturnType<typeof getStreamingService> | null>(null);
  const uniqueEventId = useRef(`message-${userMessage.id}-${Date.now()}`);

  // Initialize streaming service
  useEffect(() => {
    try {
      streamingServiceRef.current = getStreamingService();
    } catch (error) {
      console.error('Failed to initialize streaming service:', error);
      setError('Failed to initialize streaming service');
    }
  }, []); // Empty dependency array - only run once when component mounts

  // Set up event listeners
  useEffect(() => {
    const streamingService = streamingServiceRef.current;
    if (!streamingService) return;

    const handleChunk = (chunk: StreamingChunk) => {
      // Only handle chunks for this specific message
      if (chunk.messageId === uniqueEventId.current) {
        setStreamedAnswer(prev => prev + chunk.content);
      }
    };

    const handleResponse = (response: StreamingResponse) => {
      // Only handle responses for this specific message
      if (response.messageId === uniqueEventId.current) {
        setStreamedAnswer(response.content);
      }
    };

    const handleError = (errorEvent: StreamingError) => {
      // Only handle errors for this specific message
      if (errorEvent.messageId === uniqueEventId.current) {
        setError(errorEvent.message);
        setIsLoading(false);
      }
    };

    const handleComplete = (completeEvent: StreamingComplete) => {
      // Only handle completion for this specific message
      if (completeEvent.messageId === uniqueEventId.current) {
        setIsLoading(false);
        console.log('Stream completed with metadata:', completeEvent.metadata);
      }
    };

    // Listen to all relevant events
    streamingService.on('chunk', handleChunk);
    streamingService.on('response', handleResponse);
    streamingService.on('error', handleError);
    streamingService.on('complete', handleComplete);

    return () => {
      streamingService.off('chunk', handleChunk);
      streamingService.off('response', handleResponse);
      streamingService.off('error', handleError);
      streamingService.off('complete', handleComplete);
    };
  }, []); // Empty dependency array - only run once when component mounts

  // Set mounted ref when component mounts
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Start streaming when component mounts with user message
  useEffect(() => {
    const startStreaming = async () => {
      if (!userMessage.content.trim() || hasMadeAPICallRef.current || !streamingServiceRef.current) return;

      hasMadeAPICallRef.current = true;
      hasNotifiedParentRef.current = false;
      setIsLoading(true);
      setError(null);
      setStreamedAnswer('');

      try {
        const params: StreamingRequestParams = {
          message: userMessage.content,
          n_results: 5,
          search_mode: searchMode,
          pdf_names: selectedMode === 'pdf' && selectedFiles && selectedFiles.size > 0 ? Array.from(selectedFiles) : undefined
        };

        await streamingServiceRef.current.startStream(params, uniqueEventId.current);
      } catch (error) {
        console.error('Failed to start stream:', error);
        setError('Failed to start streaming response');
        setIsLoading(false);
        if (onError) {
          onError('Failed to start streaming response');
        }
      }
    };

    startStreaming();

    // Cleanup function
    return () => {
      if (streamingServiceRef.current) {
        streamingServiceRef.current.stopStream();
      }
      setIsLoading(false);
      hasMadeAPICallRef.current = false;
      hasNotifiedParentRef.current = false;
    };
  }, [userMessage.id]); // Only depend on userMessage.id to prevent re-renders when new questions are added

  // Create bot message when streaming completes
  useEffect(() => {
    if (!isLoading && streamedAnswer && !hasNotifiedParentRef.current) {
      // Create bot message when streaming completes
      const newBotMessage: Message = {
        id: `${userMessage.id}-bot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: 'bot',
        content: streamedAnswer,
        timestamp: new Date(),
        metadata: {
          sources: [] // Will be populated when stream completes
        }
      };
      setBotMessage(newBotMessage);
      
      // Notify parent
      if (onBotResponse && isMountedRef.current) {
        hasNotifiedParentRef.current = true;
        onBotResponse(newBotMessage);
      }
    }
  }, [isLoading, streamedAnswer, onBotResponse, userMessage.id]);



  const handleCopyMessage = (content: string) => {
    navigator.clipboard.writeText(content);
  };

  const handleSaveToNote = (content: string) => {
    // Implement save to note functionality
    console.log('Save to note:', content);
  };

  const handleGenerateAudio = (content: string) => {
    // Implement audio generation functionality
    console.log('Generate audio:', content);
  };

  const handleGenerateMindMap = (content: string) => {
    // Implement mind map generation functionality
    console.log('Generate mind map:', content);
  };

  // Custom component to render mathematical expressions
  const MathComponent = ({ children, displayMode = false }: { children: string; displayMode?: boolean }) => {
    try {
      if (displayMode) {
        return (
          <div className="flex justify-center my-4">
            <BlockMath math={children} />
          </div>
        );
      } else {
        return <InlineMath math={children} />;
      }
    } catch (error) {
      // Fallback to regular text if math parsing fails
      return <code className="bg-background/50 px-1 py-0.5 rounded text-sm font-mono">{children}</code>;
    }
  };

  // Function to process text and render inline math expressions
  const processMathInText = (text: string) => {
    const parts = [];
    let lastIndex = 0;
    
    // Match block math expressions ($$...$$) first
    const blockMathRegex = /\$\$([^$]+?)\$\$/g;
    let blockMatch;
    
    while ((blockMatch = blockMathRegex.exec(text)) !== null) {
      // Add text before the math expression
      if (blockMatch.index > lastIndex) {
        parts.push(text.slice(lastIndex, blockMatch.index));
      }
      
      // Add the block math expression
      parts.push(
        <MathComponent key={`block-math-${blockMatch.index}`} displayMode={true}>
          {blockMatch[1]}
        </MathComponent>
      );
      
      lastIndex = blockMatch.index + blockMatch[0].length;
    }
    
    // Process remaining text for inline math
    const remainingText = text.slice(lastIndex);
    if (remainingText) {
      const inlineParts = [];
      let inlineLastIndex = 0;
      
      // Match inline math expressions ($...$)
      const inlineMathRegex = /\$([^$\n]+?)\$/g;
      let inlineMatch;
      
      while ((inlineMatch = inlineMathRegex.exec(remainingText)) !== null) {
        // Add text before the math expression
        if (inlineMatch.index > inlineLastIndex) {
          inlineParts.push(remainingText.slice(inlineLastIndex, inlineMatch.index));
        }
        
        // Add the inline math expression
        inlineParts.push(
          <MathComponent key={`inline-math-${lastIndex + inlineMatch.index}`} displayMode={false}>
            {inlineMatch[1]}
          </MathComponent>
        );
        
        inlineLastIndex = inlineMatch.index + inlineMatch[0].length;
      }
      
      // Add remaining text
      if (inlineLastIndex < remainingText.length) {
        inlineParts.push(remainingText.slice(inlineLastIndex));
      }
      
      parts.push(...inlineParts);
    }
    
    return parts.length > 0 ? parts : text;
  };

  return (
    <div className="space-y-4">
      {/* User Message */}
      <div className="flex gap-3 justify-end">
        <div className="max-w-[280px] sm:max-w-md lg:max-w-lg p-3 rounded-lg bg-academic-teal/20 border border-academic-teal/30 text-foreground">
          <p className="text-sm">{userMessage.content}</p>
          
          {userMessage.attachments && userMessage.attachments.length > 0 && (
            <div className="mt-2 space-y-1">
              {userMessage.attachments.map((file, index) => (
                <div key={index} className="flex items-center gap-2 text-xs opacity-80">
                  <FileText className="w-3 h-3" />
                  <span>{file.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="w-8 h-8 rounded-full bg-academic-rose flex items-center justify-center flex-shrink-0">
          <User className="w-4 h-4 text-white" />
        </div>
      </div>

      {/* Bot Message or Loading */}
      <div className="flex gap-3 justify-start">
        <div className="w-8 h-8 rounded-full bg-gradient-to-r from-academic-teal to-academic-burgundy flex items-center justify-center flex-shrink-0">
          <Bot className="w-4 h-4 text-white" />
        </div>
        
        {error ? (
          <div className="max-w-[280px] sm:max-w-md lg:max-w-lg p-4 rounded-lg bg-red-500/20 text-red-600 border border-red-500/30">
            <p className="text-sm">{error}</p>
          </div>
        ) : isLoading || streamedAnswer ? (
          <div className="max-w-[400px] sm:max-w-2xl lg:max-w-4xl xl:max-w-5xl p-4 rounded-lg bg-muted/40 border border-border/30 text-foreground">
            <div className="space-y-3">
              {streamedAnswer ? (
                <div className="prose-chat">
                  <ReactMarkdown
                    components={{
                      a: ({ children, href }) => (
                        <a 
                          href={href} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-academic-teal hover:underline"
                        >
                          {children}
                        </a>
                      ),
                      p: ({ children }) => {
                        if (typeof children === 'string') {
                          return <p className="mb-2 last:mb-0">{processMathInText(children)}</p>;
                        }
                        return <p className="mb-2 last:mb-0">{children}</p>;
                      },
                      ul: ({ children }) => <ul className="list-disc list-inside mb-2">{children}</ul>,
                      ol: ({ children }) => <ol className="list-decimal list-inside mb-2">{children}</ol>,
                      li: ({ children }) => {
                        if (typeof children === 'string') {
                          return <li className="mb-1">{processMathInText(children)}</li>;
                        }
                        return <li className="mb-1">{children}</li>;
                      },
                      strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                      em: ({ children }) => <em className="italic">{children}</em>,
                      code: ({ children, className }) => {
                        // Check if this is a math code block
                        if (className && className.includes('language-math')) {
                          return <MathComponent displayMode={true}>{children as string}</MathComponent>;
                        }
                        // Check if this is inline math (single $ or $$)
                        if (typeof children === 'string') {
                          const trimmed = children.trim();
                          if (trimmed.startsWith('$$') && trimmed.endsWith('$$')) {
                            return <MathComponent displayMode={true}>{trimmed.slice(2, -2)}</MathComponent>;
                          }
                          if (trimmed.startsWith('$') && trimmed.endsWith('$') && trimmed.length > 2) {
                            return <MathComponent displayMode={false}>{trimmed.slice(1, -1)}</MathComponent>;
                          }
                        }
                        return (
                          <code className="bg-background/50 px-1 py-0.5 rounded text-sm font-mono">
                            {children}
                          </code>
                        );
                      },
                      pre: ({ children }) => (
                        <pre className="bg-background/50 p-2 rounded text-sm font-mono overflow-x-auto">
                          {children}
                        </pre>
                      ),
                    }}
                  >
                    {streamedAnswer}
                  </ReactMarkdown>
                </div>
              ) : isLoading ? (
                <div className="flex gap-2 items-center">
                  <div className="w-2 h-2 bg-academic-teal rounded-full animate-pulse shadow-lg" style={{ animationDelay: '0s', animationDuration: '1.4s' }}></div>
                  <div className="w-2 h-2 bg-academic-burgundy rounded-full animate-pulse shadow-lg" style={{ animationDelay: '0.2s', animationDuration: '1.4s' }}></div>
                  <div className="w-2 h-2 bg-academic-rose rounded-full animate-pulse shadow-lg" style={{ animationDelay: '0.4s', animationDuration: '1.4s' }}></div>
                </div>
              ) : null}

              {/* Action buttons for bot messages - only show when streaming is complete */}
              {!isLoading && streamedAnswer && (
                <>
                  <div className="flex items-center gap-2 pt-2 border-t border-border/20">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleSaveToNote(streamedAnswer)}
                      className="h-7 px-2 text-xs hover:bg-background/50"
                    >
                      <Bookmark className="w-3 h-3 mr-1" />
                      Save to note
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCopyMessage(streamedAnswer)}
                      className="h-7 w-7 p-0 text-xs hover:bg-background/50"
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-xs hover:bg-background/50"
                    >
                      <Share2 className="w-3 h-3" />
                    </Button>
                  </div>

                  {/* Advanced action buttons */}
                  <div className="flex items-center gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleSaveToNote(streamedAnswer)}
                      className="h-8 px-3 text-xs"
                    >
                      <FileText className="w-3 h-3 mr-1" />
                      Add note
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleGenerateAudio(streamedAnswer)}
                      className="h-8 px-3 text-xs"
                    >
                      <Volume2 className="w-3 h-3 mr-1" />
                      Audio Overview
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleGenerateMindMap(streamedAnswer)}
                      className="h-8 px-3 text-xs"
                    >
                      <Network className="w-3 h-3 mr-1" />
                      Mind map
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Only re-render if the userMessage changes
  return prevProps.userMessage.id === nextProps.userMessage.id;
});

export default MessagePair;
