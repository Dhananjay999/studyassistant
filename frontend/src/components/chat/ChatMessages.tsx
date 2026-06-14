import { useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { 
  User,
  Bot,
  Bookmark,
  Copy,
  Share2,
  FileDown,
  Volume2,
  Network,
  ChevronDown,
  FileText
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Message, ChatMode } from "@/types";
import ReactMarkdown from "react-markdown";
import MessagePair from "./MessagePair";

interface ChatMessagesProps {
  messages: Message[];
  selectedMode: 'pdf' | 'web';
  chatModes: ChatMode[];
  selectedFiles?: Set<string>;
  onScrollToBottom: () => void;
  onBotResponse?: (botMessage: Message, mode: 'pdf' | 'web') => void;
  onError?: (error: string) => void;
}

const ChatMessages = ({
  messages,
  selectedMode,
  chatModes,
  selectedFiles,
  onScrollToBottom,
  onBotResponse,
  onError
}: ChatMessagesProps) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    const container = messagesEndRef.current?.parentElement;
    if (container) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth'
      });
    }
  };

  // Scroll to bottom when messages change
  useEffect(() => {
    // Use a small delay to ensure DOM updates are complete
    const timeoutId = setTimeout(() => {
      const container = messagesEndRef.current?.parentElement;
      if (container) {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: 'smooth'
        });
      }
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [messages]);

  // Auto-scroll during streaming (when new content is being added)
  useEffect(() => {
    const scrollInterval = setInterval(() => {
      // Only scroll if we're near the bottom
      const container = messagesEndRef.current?.parentElement;
      if (container) {
        const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
        if (isNearBottom) {
          scrollToBottom();
        }
      }
    }, 500); // Check every 500ms

    return () => clearInterval(scrollInterval);
  }, []);

  // Get the search mode for the current selected mode
  const getSearchMode = () => {
    const currentMode = chatModes.find(mode => mode.id === selectedMode);
    return currentMode?.searchMode || 'study_material';
  };

  // Group messages into Q&A pairs and standalone messages
  const getMessageGroups = () => {
    const groups: Array<{
      type: 'standalone' | 'pair';
      message?: Message;
      userMessage?: Message;
    }> = [];
    
    for (let i = 0; i < messages.length; i++) {
      const currentMessage = messages[i];
      const previousMessage = messages[i - 1];
      
      // Bot message is standalone if it's the first message or if previous message was also bot
      if (currentMessage.type === 'bot' && (!previousMessage || previousMessage.type === 'bot')) {
        groups.push({
          type: 'standalone',
          message: currentMessage
        });
      }
      
      // User message - will be handled by MessagePair component
      if (currentMessage.type === 'user') {
        groups.push({
          type: 'pair',
          userMessage: currentMessage
        });
      }
    }
    
    return groups;
  };

  const messageGroups = getMessageGroups();
  const searchMode = getSearchMode();

  // Memoize the onBotResponse callback to prevent infinite loops
  const handleBotResponse = useCallback((botMessage: Message) => {
    onBotResponse?.(botMessage, selectedMode);
  }, [onBotResponse, selectedMode]);

  // Memoize the onError callback to prevent infinite loops
  const handleError = useCallback((error: string) => {
    onError?.(error);
  }, [onError]);

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

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-6 min-h-0 max-h-full">
      {messageGroups.map((group, index) => {
        if (group.type === 'standalone' && group.message) {
          // Render standalone bot messages (welcome messages, etc.)
          return (
            <div
              key={`standalone-${group.message.id}`}
              className="flex gap-3 justify-start"
            >
              <div className="w-8 h-8 rounded-full bg-gradient-to-r from-academic-teal to-academic-burgundy flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4 text-white" />
              </div>
              
              <div className="max-w-[280px] sm:max-w-md lg:max-w-lg p-4 rounded-lg bg-muted text-foreground">
                <div className="space-y-3">
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
                        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                        ul: ({ children }) => <ul className="list-disc list-inside mb-2">{children}</ul>,
                        ol: ({ children }) => <ol className="list-decimal list-inside mb-2">{children}</ol>,
                        li: ({ children }) => <li className="mb-1">{children}</li>,
                        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                        em: ({ children }) => <em className="italic">{children}</em>,
                        code: ({ children }) => (
                          <code className="bg-background/50 px-1 py-0.5 rounded text-sm font-mono">
                            {children}
                          </code>
                        ),
                        pre: ({ children }) => (
                          <pre className="bg-background/50 p-2 rounded text-sm font-mono overflow-x-auto">
                            {children}
                          </pre>
                        ),
                      }}
                    >
                      {group.message.content}
                    </ReactMarkdown>
                  </div>

                  {/* Action buttons for bot messages */}
                  <div className="flex items-center gap-2 pt-2 border-t border-border/20">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleSaveToNote(group.message!.content)}
                      className="h-7 px-2 text-xs hover:bg-background/50"
                    >
                      <Bookmark className="w-3 h-3 mr-1" />
                      Save to note
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCopyMessage(group.message!.content)}
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
                      onClick={() => handleSaveToNote(group.message!.content)}
                      className="h-8 px-3 text-xs"
                    >
                      <FileText className="w-3 h-3 mr-1" />
                      Add note
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleGenerateAudio(group.message!.content)}
                      className="h-8 px-3 text-xs"
                    >
                      <Volume2 className="w-3 h-3 mr-1" />
                      Audio Overview
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleGenerateMindMap(group.message!.content)}
                      className="h-8 px-3 text-xs"
                    >
                      <Network className="w-3 h-3 mr-1" />
                      Mind map
                    </Button>
                  </div>

                  {/* Sources */}
                  {group.message.metadata?.sources && group.message.metadata.sources.length > 0 && (
                    <div className="pt-2 border-t border-border/20">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{group.message.metadata.sources.length} source{group.message.metadata.sources.length !== 1 ? 's' : ''}</span>
                        <ChevronDown className="w-3 h-3" />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        } else if (group.type === 'pair' && group.userMessage) {
          // Render Q&A Message Pair - MessagePair component will handle the API call
          return (
            <MessagePair
              key={`${selectedMode}-${group.userMessage.id}`}
              userMessage={group.userMessage}
              selectedMode={selectedMode}
              searchMode={searchMode}
              selectedFiles={selectedFiles}
              onBotResponse={handleBotResponse}
              onError={handleError}
            />
          );
        }
        
        return null;
      })}

      {/* Scroll to bottom anchor */}
      <div ref={messagesEndRef} />
    </div>
  );
};

export default ChatMessages;
