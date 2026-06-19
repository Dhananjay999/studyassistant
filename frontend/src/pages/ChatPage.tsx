import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Menu,
  LogOut,
  Sparkles,
  FileText,
  X,
  Image as ImageIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { SessionSidebar } from "@/components/chat/SessionSidebar";
import { ChatMessages } from "@/components/chat/ChatMessages";
import { ChatInput } from "@/components/chat/ChatInput";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { apiService, streamingService } from "@/services";
import { compressFiles } from "@/utils/compress";
import { cn } from "@/lib/utils";
import type { AssistantRequest, MediaItem, Message, QuizContent, Session } from "@/types";
import { useToast } from "@/hooks/use-toast";

const PDFViewer = lazy(() => import("@/components/PDFViewer"));

// A session that only lives on the client until the user asks a question.
const DRAFT_ID = "";

function makeDraft(): Session {
  const now = new Date().toISOString();
  return {
    id: DRAFT_ID,
    user_id: "",
    title: "New chat",
    // Routing is automatic on the backend (media vs. web search); mode is
    // kept only for the DB column's default.
    mode: "media",
    created_at: now,
    updated_at: now,
  };
}

export default function ChatPage() {
  const { user, token, logout } = useAuth();
  const isMobile = useIsMobile();
  const { toast } = useToast();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [selectedMedia, setSelectedMedia] = useState<Set<string>>(new Set());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Tracks which session's messages/media are already loaded, so creating a
  // session inline (on first question) doesn't wipe the optimistic UI.
  const loadedSessionRef = useRef<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [pendingClarification, setPendingClarification] = useState<{
    runId: string;
    data: NonNullable<Message["metadata"]>["clarification"];
    sessionId: string;
  } | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [previewPdf, setPreviewPdf] = useState<{
    url: string;
    name: string;
  } | null>(null);

  useEffect(() => {
    apiService.setTokenGetter(() => token);
    streamingService.setTokenGetter(() => token);
  }, [token]);

  const loadSessions = useCallback(async () => {
    try {
      const res = await apiService.listSessions();
      setSessions(res.data);
      if (res.data.length > 0 && !activeSession) {
        setActiveSession(res.data[0]);
      }
    } catch {
      toast({ title: "Failed to load sessions", variant: "destructive" });
    }
  }, [activeSession, toast]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    // Draft or no session: nothing to fetch.
    if (!activeSession || !activeSession.id) {
      if (loadedSessionRef.current !== (activeSession?.id ?? null)) {
        setMessages([]);
        setMediaItems([]);
        setSelectedMedia(new Set());
      }
      loadedSessionRef.current = activeSession?.id ?? null;
      return;
    }

    // Already loaded (or just created inline) — keep the current UI.
    if (loadedSessionRef.current === activeSession.id) return;
    loadedSessionRef.current = activeSession.id;

    (async () => {
      try {
        const [msgRes, mediaRes] = await Promise.all([
          apiService.getMessages(activeSession.id),
          apiService.listMedia(activeSession.id),
        ]);
        setMessages(msgRes.data);
        setMediaItems(mediaRes.data);
        setSelectedMedia(new Set(mediaRes.data.map((m) => m.id)));
      } catch {
        toast({ title: "Failed to load chat", variant: "destructive" });
      }
    })();
  }, [activeSession, toast]);

  const toggleMedia = (id: string) => {
    setSelectedMedia((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleNewSession = () => {
    // Don't persist anything yet — the session is only saved once the user
    // actually asks a question (see handleSend).
    loadedSessionRef.current = DRAFT_ID;
    setMessages([]);
    setMediaItems([]);
    setSelectedMedia(new Set());
    setActiveSession(makeDraft());
    setSidebarOpen(false);
  };

  const handleDeleteSession = async (id: string) => {
    try {
      await apiService.deleteSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (activeSession?.id === id) {
        const remaining = sessions.filter((s) => s.id !== id);
        setActiveSession(remaining[0] || null);
      }
    } catch {
      toast({ title: "Failed to delete session", variant: "destructive" });
    }
  };

  const sendAssistant = async (
    session: Session,
    text: string,
    opts?: {
      runId?: string;
      clarification?: AssistantRequest["clarification"];
    },
  ) => {
    const mediaIds = Array.from(selectedMedia);
    const req: AssistantRequest = {
      message: text,
      session_id: session.id,
      media_ids: mediaIds.length ? mediaIds : undefined,
      run_id: opts?.runId,
      clarification: opts?.clarification,
    };

    setIsStreaming(true);
    setStreamingContent("");
    setPendingClarification(null);

    await streamingService.startStream(
      req,
      {
        onChunk: (chunk) => setStreamingContent((prev) => prev + chunk),
        onClarification: (data) => {
          const clar = data as {
            run_id: string;
            clarification: NonNullable<Message["metadata"]>["clarification"];
          };
          setPendingClarification({
            runId: clar.run_id,
            data: clar.clarification,
            sessionId: session.id,
          });
        },
        onComplete: (full, meta) => {
          const toolUsed = meta?.tool_used as Message["metadata"] extends infer M
            ? M extends { tool_used?: infer T }
              ? T
              : never
            : never;
          const content = meta?.content as Record<string, unknown> | undefined;
          const sources = (content?.sources as Message["metadata"] extends infer M
            ? M extends { sources?: infer S }
              ? S
              : never
            : never) || [];

          let quiz: QuizContent | undefined;
          if (toolUsed === "quiz_generator" && content) {
            quiz = {
              quiz_id: content.quiz_id as string,
              title: content.title as string,
              topic: content.topic as string | undefined,
              questions: content.questions as QuizContent["questions"],
            };
          }

          if (full || quiz) {
            setMessages((prev) => [
              ...prev,
              {
                id: crypto.randomUUID(),
                type: "bot",
                content: full || `Quiz: ${quiz?.title}`,
                timestamp: new Date(),
                metadata: {
                  tool_used: toolUsed,
                  sources,
                  quiz,
                },
              },
            ]);
          }
          setStreamingContent("");
          setIsStreaming(false);
          loadSessions();
        },
        onError: (err) => {
          toast({ title: err, variant: "destructive" });
          setIsStreaming(false);
          setStreamingContent("");
        },
      },
      true,
    );
  };

  const handleSend = async (text: string) => {
    if (!activeSession || isStreaming) return;

    let session = activeSession;
    if (!session.id) {
      try {
        const res = await apiService.createSession(
          text.slice(0, 60),
          session.mode,
          mediaItems.map((m) => m.id),
        );
        session = res.data;
        loadedSessionRef.current = session.id;
        setSessions((prev) => [session, ...prev]);
        setActiveSession(session);
      } catch {
        toast({ title: "Failed to start chat", variant: "destructive" });
        return;
      }
    }

    const userMsg: Message = {
      id: crypto.randomUUID(),
      type: "user",
      content: text,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);

    await sendAssistant(session, text);
  };

  const handleClarificationSubmit = async (payload: {
    action: "answer" | "custom" | "skip";
    answers?: Record<string, string>;
    custom_text?: string;
  }) => {
    if (!pendingClarification || !activeSession?.id || isStreaming) return;

    const label =
      payload.action === "skip"
        ? "Skipped clarification"
        : payload.action === "custom"
          ? payload.custom_text || "Custom response"
          : "Submitted clarification";

    setMessages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        type: "user",
        content: label,
        timestamp: new Date(),
      },
    ]);

    await sendAssistant(activeSession, label, {
      runId: pendingClarification.runId,
      clarification: payload,
    });
  };

  const handleUpload = async (files: FileList) => {
    if (!activeSession) return;
    setIsUploading(true);
    try {
      const compressed = await compressFiles(files);
      // Draft sessions have no id yet; media is linked when the session is
      // created on the first question.
      const res = await apiService.uploadMedia(
        compressed,
        activeSession.id || undefined,
      );
      setMediaItems((prev) => [...res.data, ...prev]);
      setSelectedMedia((prev) => {
        const next = new Set(prev);
        res.data.forEach((m) => next.add(m.id));
        return next;
      });
      toast({ title: `${res.data.length} file(s) uploaded` });
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : "Upload failed",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const sidebar = (
    <SessionSidebar
      sessions={sessions}
      activeId={activeSession?.id || null}
      onSelect={(id) => {
        const s = sessions.find((x) => x.id === id);
        if (s) setActiveSession(s);
        setSidebarOpen(false);
      }}
      onNew={handleNewSession}
      onDelete={handleDeleteSession}
      onSwipeClose={() => setSidebarOpen(false)}
    />
  );

  return (
    <div className="flex h-dvh flex-col bg-background">
      {/* Header */}
      <header className="flex items-center gap-2 border-b border-border/50 px-3 py-2 safe-top">
        <Button
          variant="ghost"
          size="icon"
          className="rounded-xl lg:hidden"
          onClick={() => setSidebarOpen(true)}
        >
          <Menu className="h-5 w-5" />
        </Button>

        <div className="flex flex-1 items-center gap-2">
          <Sparkles className="h-4 w-4 text-violet-500" />
          <h1 className="truncate text-sm font-semibold">
            {activeSession?.title || "Aeva"}
          </h1>
        </div>

        <ThemeToggle />
        <Avatar className="h-8 w-8">
          <AvatarImage src={user?.avatar_url || undefined} />
          <AvatarFallback>
            {user?.full_name?.[0] || user?.email?.[0] || "?"}
          </AvatarFallback>
        </Avatar>
        <Button variant="ghost" size="icon" className="rounded-xl" onClick={logout}>
          <LogOut className="h-4 w-4" />
        </Button>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Desktop sidebar */}
        <div className="hidden lg:block">{sidebar}</div>

        {/* Mobile sidebar */}
        <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
          <SheetContent side="left" className="w-72 p-0">
            {sidebar}
          </SheetContent>
        </Sheet>

        {/* Main chat area */}
        <main className="flex flex-1 flex-col overflow-hidden">
          {!activeSession ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center"
            >
              <div className="text-5xl">📚</div>
              <h2 className="text-xl font-bold">Ready to study?</h2>
              <p className="text-muted-foreground">
                Attach your notes to ask from them, or just ask anything and
                I'll search the web for you.
              </p>
              <Button className="rounded-xl" onClick={handleNewSession}>
                <Sparkles className="mr-2 h-4 w-4" />
                Start a new chat
              </Button>
            </motion.div>
          ) : (
            <>
              {/* Media bar — tick the files you want to ask about */}
              {mediaItems.length > 0 && (
                <div className="flex gap-2 overflow-x-auto border-b border-border/30 px-4 py-2">
                  {mediaItems.map((item) => {
                    const selected = selectedMedia.has(item.id);
                    return (
                      <div
                        key={item.id}
                        className={cn(
                          "flex shrink-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors",
                          selected
                            ? "border-primary/60 bg-primary/10"
                            : "border-border/50 bg-muted",
                        )}
                      >
                        <Checkbox
                          checked={selected}
                          onCheckedChange={() => toggleMedia(item.id)}
                          className="h-3.5 w-3.5"
                          aria-label={`Use ${item.file_name} in answers`}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (!item.signed_url) return;
                            if (item.mime_type.startsWith("image/")) {
                              setPreviewImage(item.signed_url);
                            } else if (item.mime_type === "application/pdf") {
                              setPreviewPdf({
                                url: item.signed_url,
                                name: item.file_name,
                              });
                            }
                          }}
                          className="flex items-center gap-1.5"
                        >
                          {item.mime_type.startsWith("image/") ? (
                            <ImageIcon className="h-3 w-3" />
                          ) : (
                            <FileText className="h-3 w-3" />
                          )}
                          <span className="max-w-[120px] truncate">
                            {item.file_name}
                          </span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              <ChatMessages
                messages={messages}
                isStreaming={isStreaming}
                streamingContent={streamingContent}
                pendingClarification={
                  pendingClarification
                    ? {
                        runId: pendingClarification.runId,
                        data: pendingClarification.data,
                      }
                    : null
                }
                onClarificationSubmit={handleClarificationSubmit}
                clarificationDisabled={isStreaming}
              />

              <ChatInput
                onSend={handleSend}
                onUpload={handleUpload}
                disabled={isStreaming}
                isUploading={isUploading}
              />
            </>
          )}
        </main>
      </div>

      {/* Image preview modal */}
      <AnimatePresence>
        {previewImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
            onClick={() => setPreviewImage(null)}
          >
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-4 top-4 text-white"
              onClick={() => setPreviewImage(null)}
            >
              <X className="h-6 w-6" />
            </Button>
            <img
              src={previewImage}
              alt="Preview"
              className="max-h-[90vh] max-w-full rounded-xl object-contain"
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* PDF preview modal (loaded from API-provided URL) */}
      <AnimatePresence>
        {previewPdf && (
          <Suspense fallback={null}>
            <PDFViewer
              url={previewPdf.url}
              fileName={previewPdf.name}
              onClose={() => setPreviewPdf(null)}
            />
          </Suspense>
        )}
      </AnimatePresence>
    </div>
  );
}
