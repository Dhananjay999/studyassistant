import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LogOut, Menu, PanelRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Seo } from "@/components/common/Seo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BrandLogo } from "@/components/common/BrandLogo";
import { GlassCard } from "@/components/common/GlassCard";
import { SessionSidebar } from "@/components/chat/SessionSidebar";
import { ChatMessages } from "@/components/chat/ChatMessages";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { ClarificationPanel } from "@/components/chat/ClarificationPanel";
import { QuizSetupForm } from "@/components/chat/QuizSetupForm";
import { QuizDrawer } from "@/components/chat/QuizDrawer";
import { MediaSidebar } from "@/components/chat/MediaSidebar";
import { EmptyState } from "@/components/chat/EmptyState";
import { useAuth } from "@/contexts/AuthContext";
import { useAssistantStream } from "@/hooks/useAssistantStream";
import {
  qk,
  useCreateSession,
  useDeleteSession,
  useDeleteMedia,
  useMedia,
  useSessions,
} from "@/hooks/api";
import { getMessages, uploadFileWithProgress } from "@/lib/api";
import { MAX_SELECTED_FILES, MAX_UPLOAD_FILES } from "@/lib/config";
import { compressFiles } from "@/utils/compress";
import type {
  ClarificationAnswer,
  Message,
  PendingClarification,
  PendingQuizSetup,
  QuizContent,
  QuizOptions,
  UploadProgress,
} from "@/types";

const uid = () => crypto.randomUUID();

export default function ChatPage() {
  const { user, logout } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();

  const sessionsQuery = useSessions();
  const sessions = sessionsQuery.data ?? [];
  const createSession = useCreateSession();
  const deleteSession = useDeleteSession();

  const urlId = searchParams.get("sessionId");
  const activeId = urlId && sessions.some((s) => s.id === urlId) ? urlId : null;
  const activeSession = sessions.find((s) => s.id === activeId) ?? null;

  const [messages, setMessages] = useState<Message[]>([]);
  const [pendingClar, setPendingClar] = useState<PendingClarification | null>(
    null,
  );
  const [pendingQuiz, setPendingQuiz] = useState<PendingQuizSetup | null>(null);
  const [thinkingHint, setThinkingHint] = useState<"quiz" | undefined>();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);

  const [activeQuiz, setActiveQuiz] = useState<QuizContent | null>(null);
  const [quizOpen, setQuizOpen] = useState(false);

  const mediaQuery = useMedia();
  const media = mediaQuery.data ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  const deleteMedia = useDeleteMedia();

  const { start, streaming } = useAssistantStream();
  const streamIdRef = useRef<string | null>(null);
  const bootstrapped = useRef(false);
  const loadedSession = useRef<string | null>(null);

  /* --- bootstrap: always land on a real session --- */
  useEffect(() => {
    if (!sessionsQuery.isSuccess || activeId) return;
    if (sessions.length) {
      setSearchParams({ sessionId: sessions[0].id }, { replace: true });
    } else if (!bootstrapped.current) {
      bootstrapped.current = true;
      createSession
        .mutateAsync({})
        .then((s) => setSearchParams({ sessionId: s.id }, { replace: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionsQuery.isSuccess, activeId, sessions.length]);

  /* --- load history when the active session changes --- */
  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    if (loadedSession.current === activeId) return;
    loadedSession.current = activeId;
    setPendingClar(null);
    setPendingQuiz(null);
    getMessages(activeId)
      .then(setMessages)
      .catch(() => toast.error("Failed to load chat"));
  }, [activeId]);

  /* --- selection is ephemeral; cleared whenever the chat changes --- */
  useEffect(() => {
    setSelected(new Set());
  }, [activeId]);

  const upsertStreaming = (delta: string) =>
    setMessages((prev) =>
      prev.map((m) =>
        m.id === streamIdRef.current ? { ...m, content: m.content + delta } : m,
      ),
    );
  const removeStreaming = () =>
    setMessages((prev) => prev.filter((m) => m.id !== streamIdRef.current));

  const send = useCallback(
    (
      text: string,
      opts?: {
        runId?: string;
        clarification?: ClarificationAnswer;
        quizOptions?: QuizOptions;
      },
    ) => {
      if (!activeId || streaming) return;
      const streamId = `stream-${uid()}`;
      streamIdRef.current = streamId;
      setThinkingHint(opts?.quizOptions ? "quiz" : undefined);

      setMessages((prev) => [
        ...prev,
        { id: uid(), role: "user", content: text, createdAt: new Date() },
        {
          id: streamId,
          role: "assistant",
          content: "",
          createdAt: new Date(),
          streaming: true,
        },
      ]);

      start(
        {
          message: text,
          session_id: activeId,
          media_ids: selected.size ? Array.from(selected) : undefined,
          run_id: opts?.runId,
          clarification: opts?.clarification,
          quiz_options: opts?.quizOptions,
        },
        {
          onChunk: upsertStreaming,
          onComplete: (full, meta) => {
            const content = (meta.content ?? {}) as Record<string, unknown>;
            const toolUsed = meta.tool_used as Message["meta"]["tool_used"];
            const quiz =
              toolUsed === "quiz_generator"
                ? (content as unknown as QuizContent)
                : undefined;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === streamId
                  ? {
                      ...m,
                      content: full || m.content,
                      streaming: false,
                      meta: {
                        tool_used: toolUsed,
                        sources:
                          (content.sources as Message["meta"]["sources"]) || [],
                        quiz,
                      },
                    }
                  : m,
              ),
            );
            sessionsQuery.refetch();
          },
          onClarification: (data) => {
            removeStreaming();
            setPendingClar({
              runId: data.run_id as string,
              data: data.clarification as PendingClarification["data"],
            });
          },
          onQuizSetup: (data) => {
            removeStreaming();
            setPendingQuiz({
              topic: (data.topic as string) || "",
              mediaAvailable: Boolean(data.media_available),
            });
          },
          onError: (msg) => {
            removeStreaming();
            toast.error(msg);
          },
        },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeId, selected, streaming, start],
  );

  const handleClarify = (answer: ClarificationAnswer) => {
    const label =
      answer.action === "skip"
        ? "Skip"
        : answer.action === "custom"
          ? answer.custom_text || "Custom answer"
          : Object.values(answer.answers ?? {}).join(", ") || "Submitted answer";
    setPendingClar(null);
    send(label, { runId: pendingClar?.runId, clarification: answer });
  };

  const handleGenerateQuiz = (topic: string, options: QuizOptions) => {
    setPendingQuiz(null);
    const resolved = { ...options, topic: options.topic || topic || undefined };
    send(`Generate a quiz${resolved.topic ? ` on ${resolved.topic}` : ""}`, {
      quizOptions: resolved,
    });
  };

  const openQuiz = (quiz: QuizContent) => {
    setActiveQuiz(quiz);
    setQuizOpen(true);
  };

  const handleUpload = async (files: FileList) => {
    let list = await compressFiles(files);
    if (list.length > MAX_UPLOAD_FILES) {
      toast.error(`Up to ${MAX_UPLOAD_FILES} files at a time`);
      list = list.slice(0, MAX_UPLOAD_FILES);
    }
    await Promise.all(
      list.map(async (file) => {
        const id = uid();
        setUploads((prev) => [
          { id, name: file.name, progress: 0, status: "uploading" },
          ...prev,
        ]);
        try {
          const item = await uploadFileWithProgress(
            file,
            activeId ?? undefined,
            (p) =>
              setUploads((prev) =>
                prev.map((u) => (u.id === id ? { ...u, progress: p } : u)),
              ),
          );
          setUploads((prev) => prev.filter((u) => u.id !== id));
          qc.invalidateQueries({ queryKey: qk.media });
          // Auto-select the freshly uploaded file if under the limit.
          setSelected((prev) =>
            prev.size < MAX_SELECTED_FILES
              ? new Set(prev).add(item.id)
              : prev,
          );
        } catch (e) {
          setUploads((prev) =>
            prev.map((u) => (u.id === id ? { ...u, status: "error" } : u)),
          );
          toast.error(e instanceof Error ? e.message : "Upload failed");
          window.setTimeout(
            () => setUploads((prev) => prev.filter((u) => u.id !== id)),
            4000,
          );
        }
      }),
    );
  };

  const handleNewChat = async () => {
    const s = await createSession.mutateAsync({});
    setSearchParams({ sessionId: s.id });
    setSidebarOpen(false);
  };

  const handleDeleteSession = async (id: string) => {
    await deleteSession.mutateAsync(id);
    if (id === activeId) {
      const rest = sessions.filter((s) => s.id !== id);
      if (rest.length) setSearchParams({ sessionId: rest[0].id });
      else setSearchParams({});
    }
  };

  const toggleMedia = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        return next;
      }
      if (next.size >= MAX_SELECTED_FILES) {
        toast.error(`You can select up to ${MAX_SELECTED_FILES} files`);
        return prev;
      }
      next.add(id);
      return next;
    });

  const sidebar = (
    <SessionSidebar
      sessions={sessions}
      activeId={activeId}
      onSelect={(id) => {
        setSearchParams({ sessionId: id });
        setSidebarOpen(false);
      }}
      onNew={handleNewChat}
      onDelete={handleDeleteSession}
    />
  );

  const mediaSidebar = (
    <MediaSidebar
      items={media}
      uploads={uploads}
      selected={selected}
      activeSessionId={activeId}
      onToggle={toggleMedia}
      onDelete={(id) => deleteMedia.mutate(id)}
      onUpload={handleUpload}
    />
  );

  return (
    <>
      <Seo title="StudyAssistant — Chat with Aeva" noindex path="/chat" />
      <div className="flex h-dvh flex-col bg-background">
        {/* Top bar */}
        <header className="z-10 flex items-center gap-2 border-b border-border/50 px-3 py-2">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open sidebar"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex flex-1 items-center gap-2 truncate">
            <BrandLogo withWordmark={false} />
            <span className="truncate text-sm font-medium">
              {activeSession?.title ?? "Aeva"}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 xl:hidden"
            onClick={() => setMediaOpen(true)}
          >
            <PanelRight className="h-4 w-4" />
            <span className="hidden sm:inline">Materials</span>
            {media.length > 0 && (
              <Badge variant="secondary" className="ml-0.5 h-5 px-1.5">
                {media.length}
              </Badge>
            )}
          </Button>
          <ThemeToggle />
          <Avatar className="h-8 w-8">
            <AvatarImage src={user?.avatar_url || undefined} />
            <AvatarFallback>
              {user?.full_name?.[0] || user?.email?.[0] || "?"}
            </AvatarFallback>
          </Avatar>
          <Button
            variant="ghost"
            size="icon"
            onClick={logout}
            aria-label="Log out"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </header>

        <div className="flex flex-1 overflow-hidden">
          {/* Left session sidebar */}
          <aside className="hidden w-64 shrink-0 border-r border-border/50 lg:block">
            {sidebar}
          </aside>
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            <SheetContent side="left" className="w-72 p-0">
              {sidebar}
            </SheetContent>
          </Sheet>

          {/* Chat column */}
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto">
              {messages.length === 0 && !streaming ? (
                <div className="h-full">
                  <EmptyState onPick={(t) => send(t)} />
                </div>
              ) : (
                <ChatMessages
                  messages={messages}
                  mediaAvailable={selected.size > 0}
                  quizBusy={streaming}
                  thinkingHint={thinkingHint}
                  onGenerateQuiz={handleGenerateQuiz}
                  onOpenQuiz={openQuiz}
                />
              )}
            </div>

            {pendingClar && (
              <div className="mx-auto w-full max-w-3xl px-4 pb-2">
                <ClarificationPanel
                  data={pendingClar.data}
                  busy={streaming}
                  onSubmit={handleClarify}
                />
              </div>
            )}
            {pendingQuiz && (
              <div className="mx-auto w-full max-w-3xl px-4 pb-2">
                <GlassCard className="p-4">
                  <p className="mb-3 flex items-center gap-1.5 font-display text-sm font-semibold">
                    <Sparkles className="h-4 w-4 text-brand-1" /> Set up your quiz
                  </p>
                  <QuizSetupForm
                    initialTopic={pendingQuiz.topic}
                    mediaAvailable={pendingQuiz.mediaAvailable}
                    busy={streaming}
                    onGenerate={(opts) =>
                      handleGenerateQuiz(pendingQuiz.topic, opts)
                    }
                  />
                </GlassCard>
              </div>
            )}

            <ChatComposer
              onSend={(t) => send(t)}
              onUpload={handleUpload}
              disabled={streaming}
              uploading={uploads.some((u) => u.status === "uploading")}
            />
          </main>

          {/* Right media sidebar (persistent on xl) */}
          <aside className="hidden w-72 shrink-0 border-l border-border/50 p-3 xl:block">
            {mediaSidebar}
          </aside>
          <Sheet open={mediaOpen} onOpenChange={setMediaOpen}>
            <SheetContent side="right" className="w-80 p-4 sm:w-96">
              <div className="mt-6 h-[calc(100%-1.5rem)]">{mediaSidebar}</div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      <QuizDrawer quiz={activeQuiz} open={quizOpen} onOpenChange={setQuizOpen} />
    </>
  );
}
