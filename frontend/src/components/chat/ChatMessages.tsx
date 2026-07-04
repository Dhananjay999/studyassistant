import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Bot, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { QuizCard } from "@/components/chat/QuizCard";
import { FlashcardCard } from "@/components/chat/FlashcardCard";
import { MarkdownContent } from "@/components/chat/MarkdownContent";
import { SourceCards } from "@/components/chat/SourceCards";
import { SuggestedActions } from "@/components/chat/SuggestedActions";
import { ThinkingIndicator } from "@/components/chat/ThinkingIndicator";
import { cn } from "@/lib/utils";
import { copyRich, markdownToPlainText } from "@/lib/clipboard";
import type { ThinkingHint } from "@/lib/loadingMessages";
import type { Message, QuizContent, QuizOptions, ToolUsed } from "@/types";

const TOOL_LABEL: Record<ToolUsed, string> = {
  web_search: "Web",
  media_llm: "Notes",
  quiz_generator: "Quiz",
};

export function ChatMessages({
  messages,
  mediaAvailable,
  quizBusy,
  thinkingHint,
  onAction,
  onFollowup,
  onGenerateQuiz,
  onCreateFlashcards,
  onOpenQuiz,
  onOpenFlashcards,
  highlightId,
}: {
  messages: Message[];
  mediaAvailable: boolean;
  quizBusy: boolean;
  thinkingHint?: ThinkingHint;
  onAction: (message: string, sourceContent: string) => void;
  onFollowup: (prompt: string, title: string) => void;
  onGenerateQuiz: (
    topic: string,
    options: QuizOptions,
    sourceContent?: string,
  ) => void;
  onCreateFlashcards: (sourceContent: string) => void;
  onOpenQuiz: (quiz: QuizContent) => void;
  onOpenFlashcards: (setId: string) => void;
  /** Message to scroll to and flash-highlight (e.g. opened from a bookmark). */
  highlightId?: string | null;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  // Rendered markdown nodes, so Copy yields clean text + rich HTML.
  const contentRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // Message row containers, keyed by id, for scroll-to-message.
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // The highlight we've already scrolled to, so it fires once per target.
  const appliedHighlight = useRef<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);

  // Auto-scroll to the newest message. Suppressed while a highlight target is
  // still pending so it never yanks the view away from the message we're about
  // to jump to (opened from a bookmark).
  useEffect(() => {
    if (highlightId && appliedHighlight.current !== highlightId) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, highlightId]);

  // Scroll to and briefly flash the highlighted message once it's rendered.
  // The scroll is deferred to the next frame so it runs *after* the mount's
  // bottom-scroll and reliably wins the race, regardless of effect order.
  useEffect(() => {
    if (!highlightId || appliedHighlight.current === highlightId) return;
    const el = rowRefs.current.get(highlightId);
    if (!el) return; // history not loaded yet — reruns when messages arrive.
    appliedHighlight.current = highlightId;
    setFlashId(highlightId);
    // Defer past the mount's bottom-scroll and initial markdown/code layout so
    // this is the final scroll and the target row is at its settled position.
    const scrollT = window.setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
    const flashT = window.setTimeout(() => setFlashId(null), 2400);
    return () => {
      window.clearTimeout(scrollT);
      window.clearTimeout(flashT);
    };
  }, [highlightId, messages]);

  const copyMessage = (id: string, fallback: string) => {
    const el = contentRefs.current.get(id);
    const text = el?.innerText?.trim() || markdownToPlainText(fallback);
    return copyRich({ html: el?.innerHTML, text });
  };

  // Follow-up / action chips belong only on the newest answer; older cards
  // keep just Bookmark + Copy so the conversation stays focused.
  const lastAssistantId = messages
    .filter((m) => m.role === "assistant")
    .at(-1)?.id;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-6">
      {messages.map((msg, i) => {
        const prevUser = [...messages.slice(0, i)]
          .reverse()
          .find((m) => m.role === "user");
        const topic = prevUser?.content ?? "";
        return (
          <motion.div
            key={msg.id}
            ref={(el) => {
              if (el) rowRefs.current.set(msg.id, el);
              else rowRefs.current.delete(msg.id);
            }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className={cn(
              "flex scroll-mt-24 gap-2 sm:gap-3",
              msg.role === "user" && "flex-row-reverse",
            )}
          >
            {/* Avatar is hidden on phones so message content gets the full width;
               role is still clear from alignment + colour. */}
            <span
              className={cn(
                "hidden h-8 w-8 shrink-0 place-items-center rounded-full sm:grid",
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
                "rounded-2xl px-4 py-3 text-sm leading-relaxed transition-shadow duration-700",
                msg.role === "user"
                  ? "max-w-[85%] rounded-br-sm bg-primary text-primary-foreground"
                  : "min-w-0 max-w-full flex-1 glass rounded-bl-sm",
                flashId === msg.id &&
                  "ring-2 ring-brand-1 ring-offset-2 ring-offset-background",
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
                  <div
                    ref={(el) => {
                      if (el) contentRefs.current.set(msg.id, el);
                      else contentRefs.current.delete(msg.id);
                    }}
                    className="learning-content prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-pre:my-2"
                  >
                    <MarkdownContent
                      content={msg.content}
                      sources={msg.meta?.sources}
                    />
                    {msg.streaming && (
                      <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-primary align-middle" />
                    )}
                  </div>
                )
              ) : (
                msg.content
              )}

              {msg.meta?.sources && msg.meta.sources.length > 0 && (
                <SourceCards sources={msg.meta.sources} />
              )}

              {msg.meta?.quiz?.questions?.length ? (
                <QuizCard
                  quiz={msg.meta.quiz}
                  onStart={() => onOpenQuiz(msg.meta!.quiz!)}
                />
              ) : null}

              {msg.meta?.flashcards?.cards?.length ? (
                <FlashcardCard
                  flashcards={msg.meta.flashcards}
                  onStudy={() =>
                    onOpenFlashcards(msg.meta!.flashcards!.set_id)
                  }
                />
              ) : null}

              {msg.role === "assistant" &&
                !msg.streaming &&
                msg.content &&
                !msg.meta?.quiz &&
                !msg.meta?.flashcards && (
                  <SuggestedActions
                    availableActions={msg.meta?.available_actions}
                    suggestedFollowups={msg.meta?.suggested_followups}
                    showSuggestions={msg.id === lastAssistantId}
                    busy={quizBusy}
                    topic={topic}
                    mediaAvailable={mediaAvailable}
                    quizBusy={quizBusy}
                    onAction={(message) => onAction(message, msg.content)}
                    onFollowup={onFollowup}
                    onGenerateQuiz={(opts) =>
                      onGenerateQuiz(topic, opts, msg.content)
                    }
                    onCreateFlashcards={() => onCreateFlashcards(msg.content)}
                    onCopy={() => copyMessage(msg.id, msg.content)}
                    bookmarkItem={{
                      item_type: "response",
                      item_ref: msg.id,
                      title: topic || msg.content.slice(0, 60),
                      content: msg.content,
                      metadata: {
                        tool_used: msg.meta?.tool_used,
                        sources: msg.meta?.sources ?? [],
                      },
                    }}
                  />
                )}
            </div>
          </motion.div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
