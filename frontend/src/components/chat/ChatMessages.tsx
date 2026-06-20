import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import { Bot, ExternalLink, ListChecks, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { QuizCard } from "@/components/chat/QuizCard";
import { QuizSetupPopover } from "@/components/chat/QuizSetupPopover";
import { ThinkingIndicator } from "@/components/chat/ThinkingIndicator";
import { cn } from "@/lib/utils";
import type { Message, QuizContent, QuizOptions, ToolUsed } from "@/types";

const TOOL_LABEL: Record<ToolUsed, string> = {
  web_search: "Web",
  media_llm: "Notes",
  quiz_generator: "Quiz",
};

function isQuizzable(msg: Message): boolean {
  return (
    msg.role === "assistant" &&
    !msg.streaming &&
    !msg.meta?.quiz &&
    (msg.meta?.tool_used === "web_search" ||
      msg.meta?.tool_used === "media_llm") &&
    msg.content.length > 120
  );
}

export function ChatMessages({
  messages,
  mediaAvailable,
  quizBusy,
  thinkingHint,
  onGenerateQuiz,
  onOpenQuiz,
}: {
  messages: Message[];
  mediaAvailable: boolean;
  quizBusy: boolean;
  thinkingHint?: "quiz";
  onGenerateQuiz: (topic: string, options: QuizOptions) => void;
  onOpenQuiz: (quiz: QuizContent) => void;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6">
      {messages.map((msg, i) => {
        const prevUser = [...messages.slice(0, i)]
          .reverse()
          .find((m) => m.role === "user");
        const topic = prevUser?.content ?? "";
        return (
          <motion.div
            key={msg.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className={cn(
              "flex gap-3",
              msg.role === "user" && "flex-row-reverse",
            )}
          >
            <span
              className={cn(
                "grid h-8 w-8 shrink-0 place-items-center rounded-full",
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-brand-gradient text-white",
              )}
            >
              {msg.role === "user" ? (
                <User className="h-4 w-4" />
              ) : (
                <Bot className="h-4 w-4" />
              )}
            </span>

            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed",
                msg.role === "user"
                  ? "rounded-br-sm bg-primary text-primary-foreground"
                  : "glass rounded-bl-sm",
              )}
            >
              {msg.meta?.tool_used && (
                <Badge
                  variant="secondary"
                  className="mb-2 gap-1 text-[10px] font-medium"
                >
                  {TOOL_LABEL[msg.meta.tool_used] ?? msg.meta.tool_used}
                </Badge>
              )}

              {msg.role === "assistant" ? (
                msg.streaming && !msg.content ? (
                  <ThinkingIndicator hint={thinkingHint} />
                ) : (
                  <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-pre:my-2">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                    {msg.streaming && (
                      <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-primary align-middle" />
                    )}
                  </div>
                )
              ) : (
                msg.content
              )}

              {msg.meta?.sources && msg.meta.sources.length > 0 && (
                <div className="mt-3 border-t border-border/40 pt-2">
                  <p className="text-xs font-medium opacity-70">Sources</p>
                  {msg.meta.sources.map((s, idx) => (
                    <a
                      key={idx}
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 flex items-center gap-1 text-xs text-brand-3 hover:underline"
                    >
                      <ExternalLink className="h-3 w-3 shrink-0" />
                      <span className="truncate">{s.title}</span>
                    </a>
                  ))}
                </div>
              )}

              {msg.meta?.quiz?.questions?.length ? (
                <QuizCard
                  quiz={msg.meta.quiz}
                  onStart={() => onOpenQuiz(msg.meta!.quiz!)}
                />
              ) : null}

              {isQuizzable(msg) && (
                <div className="mt-3">
                  <QuizSetupPopover
                    initialTopic={topic}
                    mediaAvailable={mediaAvailable}
                    busy={quizBusy}
                    onGenerate={(opts) => onGenerateQuiz(topic, opts)}
                  >
                    <Button size="sm" variant="outline" className="h-8 gap-1.5">
                      <ListChecks className="h-3.5 w-3.5" />
                      Generate quiz
                    </Button>
                  </QuizSetupPopover>
                </div>
              )}
            </div>
          </motion.div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
