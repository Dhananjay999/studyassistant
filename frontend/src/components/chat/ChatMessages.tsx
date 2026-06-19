import { useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import { Bot, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ClarificationPanel } from "@/components/chat/ClarificationPanel";
import { QuizPanel } from "@/components/chat/QuizPanel";
import type { Message } from "@/types";

interface ChatMessagesProps {
  messages: Message[];
  isStreaming?: boolean;
  streamingContent?: string;
  pendingClarification?: {
    runId: string;
    data: NonNullable<Message["metadata"]>["clarification"];
  } | null;
  onClarificationSubmit?: (payload: {
    action: "answer" | "custom" | "skip";
    answers?: Record<string, string>;
    custom_text?: string;
  }) => void;
  clarificationDisabled?: boolean;
}

const TOOL_LABELS: Record<string, string> = {
  web_search: "Web search",
  media_llm: "Media + LLM",
  quiz_generator: "Quiz",
};

export function ChatMessages({
  messages,
  isStreaming,
  streamingContent,
  pendingClarification,
  onClarificationSubmit,
  clarificationDisabled,
}: ChatMessagesProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolled = useRef(false);

  const scrollToBottom = useCallback(() => {
    if (!userScrolled.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent, pendingClarification, scrollToBottom]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => {
      const atBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      userScrolled.current = !atBottom;
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto px-4 py-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <AnimatePresence initial={false}>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className={cn(
                "flex gap-3",
                msg.type === "user" ? "flex-row-reverse" : "",
              )}
            >
              <div
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                  msg.type === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-gradient-to-br from-violet-500 to-sky-500 text-white",
                )}
              >
                {msg.type === "user" ? (
                  <User className="h-4 w-4" />
                ) : (
                  <Bot className="h-4 w-4" />
                )}
              </div>
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
                  msg.type === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted prose prose-sm dark:prose-invert max-w-none",
                )}
              >
                {msg.metadata?.tool_used && (
                  <Badge variant="secondary" className="mb-2 text-[10px]">
                    {TOOL_LABELS[msg.metadata.tool_used] ||
                      msg.metadata.tool_used}
                  </Badge>
                )}
                {msg.type === "bot" ? (
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                ) : (
                  msg.content
                )}
                {msg.metadata?.sources && msg.metadata.sources.length > 0 && (
                  <div className="mt-3 border-t border-border/30 pt-2">
                    <p className="text-xs font-medium opacity-70">Sources</p>
                    {msg.metadata.sources.map((s, i) => (
                      <a
                        key={i}
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 block text-xs text-sky-600 hover:underline dark:text-sky-400"
                      >
                        {s.title}
                      </a>
                    ))}
                  </div>
                )}
                {msg.metadata?.quiz && (
                  <QuizPanel quiz={msg.metadata.quiz} />
                )}
                {msg.metadata?.quiz_result && (
                  <div className="mt-2 text-xs opacity-80">
                    Score: {msg.metadata.quiz_result.evaluation.score}%
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {pendingClarification?.data && onClarificationSubmit && (
          <div className="flex gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-sky-500 text-white">
              <Bot className="h-4 w-4" />
            </div>
            <div className="max-w-[85%] rounded-2xl bg-muted px-4 py-3 text-sm">
              <ClarificationPanel
                data={pendingClarification.data}
                runId={pendingClarification.runId}
                onSubmit={onClarificationSubmit}
                disabled={clarificationDisabled}
              />
            </div>
          </div>
        )}

        {isStreaming && streamingContent && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex gap-3"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-sky-500 text-white">
              <Bot className="h-4 w-4" />
            </div>
            <div className="max-w-[85%] rounded-2xl bg-muted px-4 py-3 text-sm prose prose-sm dark:prose-invert">
              <ReactMarkdown>{streamingContent}</ReactMarkdown>
              <span className="inline-block h-4 w-1 animate-pulse bg-primary" />
            </div>
          </motion.div>
        )}

        <div ref={bottomRef} />
      </div>
    </div>
  );
}

export default ChatMessages;
