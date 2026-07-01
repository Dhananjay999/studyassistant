import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import { Bot, FileText, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { QuizCard } from "@/components/chat/QuizCard";
import { FlashcardCard } from "@/components/chat/FlashcardCard";
import { SourceCards } from "@/components/chat/SourceCards";
import { SuggestedActions } from "@/components/chat/SuggestedActions";
import { ThinkingIndicator } from "@/components/chat/ThinkingIndicator";
import { useDocumentViewer } from "@/contexts/DocumentViewerContext";
import { cn } from "@/lib/utils";
import { copyRich, markdownToPlainText } from "@/lib/clipboard";
import {
  citationUrlTransform,
  parseCiteTarget,
  preprocessCitations,
} from "@/lib/citations";
import type { ThinkingHint } from "@/lib/loadingMessages";
import type {
  Message,
  QuizContent,
  QuizOptions,
  SourceInfo,
  ToolUsed,
} from "@/types";

/** Compact, ChatGPT-style inline citation chip that opens the cited page. */
function CitationChip({
  name,
  page,
  label,
  sources,
}: {
  name: string;
  page?: number;
  label: React.ReactNode;
  sources?: SourceInfo[];
}) {
  const viewer = useDocumentViewer();
  const lname = name.toLowerCase();
  const match =
    sources?.find(
      (s) =>
        s.document_name?.toLowerCase() === lname &&
        (page == null || s.page_number == null || s.page_number === page),
    ) ?? sources?.find((s) => s.document_name?.toLowerCase() === lname);
  const mediaId = match?.media_id;

  return (
    <button
      type="button"
      disabled={!mediaId}
      onClick={() =>
        mediaId && viewer.openDocumentByMediaId(mediaId, page ?? undefined)
      }
      title={mediaId ? "Open the cited page" : undefined}
      className="mx-0.5 inline-flex max-w-[16rem] items-center gap-1 rounded-md border border-brand-1/30 bg-brand-1/5 px-1.5 py-px align-baseline text-[0.72em] font-medium leading-tight text-brand-1 no-underline transition-colors hover:bg-brand-1/15 disabled:cursor-default disabled:opacity-70"
    >
      <FileText className="h-3 w-3 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

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
}) {
  const bottomRef = useRef<HTMLDivElement>(null);
  // Rendered markdown nodes, so Copy yields clean text + rich HTML.
  const contentRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
                "rounded-2xl px-4 py-3 text-sm leading-relaxed",
                msg.role === "user"
                  ? "max-w-[85%] rounded-br-sm bg-primary text-primary-foreground"
                  : "min-w-0 max-w-full flex-1 glass rounded-bl-sm",
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
                    <ReactMarkdown
                      urlTransform={citationUrlTransform}
                      components={{
                        a: ({ href, children }) => {
                          const cite = href ? parseCiteTarget(href) : null;
                          if (cite) {
                            return (
                              <CitationChip
                                name={cite.name}
                                page={cite.page}
                                label={children}
                                sources={msg.meta?.sources}
                              />
                            );
                          }
                          return (
                            <a href={href} target="_blank" rel="noreferrer">
                              {children}
                            </a>
                          );
                        },
                      }}
                    >
                      {preprocessCitations(msg.content)}
                    </ReactMarkdown>
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
