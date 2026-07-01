import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Bookmark,
  FolderOpen,
  LogOut,
  Menu,
  Search,
  Sparkles,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Seo } from "@/components/common/Seo";
import { ThemeToggle } from "@/components/ThemeToggle";
import { BrandLogo } from "@/components/common/BrandLogo";
import { GlassCard } from "@/components/common/GlassCard";
import { AppSidebar } from "@/components/chat/AppSidebar";
import { ChatMessages } from "@/components/chat/ChatMessages";
import { ChatSkeleton } from "@/components/chat/ChatSkeleton";
import { BookmarkPreview } from "@/components/chat/BookmarkPreview";
import { ChatComposer, type ChatComposerHandle } from "@/components/chat/ChatComposer";
import { ClarificationPanel } from "@/components/chat/ClarificationPanel";
import { QuizSetupForm } from "@/components/chat/QuizSetupForm";
import { QuizDrawer } from "@/components/chat/QuizDrawer";
import { FlashcardViewer } from "@/components/chat/FlashcardViewer";
import { MediaSidebar } from "@/components/chat/MediaSidebar";
import { EmptyState } from "@/components/chat/EmptyState";
import { GlobalCommandPalette } from "@/components/GlobalCommandPalette";
import { MobileNav } from "@/components/MobileNav";
import { OnboardingFlow } from "@/components/learning/OnboardingFlow";
import { useAuth } from "@/contexts/AuthContext";
import { DocumentViewerProvider } from "@/contexts/DocumentViewerContext";
import { useAssistantStream } from "@/hooks/useAssistantStream";
import { useMediaProcessing } from "@/hooks/useMediaProcessing";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { useSwipe } from "@/hooks/useSwipe";
import type { ThinkingHint } from "@/lib/loadingMessages";
import {
  qk,
  useCreateSession,
  useDeleteSession,
  useDeleteMedia,
  useFlashcardSets,
  useMedia,
  useQuizzes,
  useSessions,
} from "@/hooks/api";
import { getMessages, getQuiz, uploadFileWithProgress } from "@/lib/api";
import { compressFiles } from "@/utils/compress";
import type {
  Bookmark as BookmarkData,
  ChatSeed,
  ClarificationAnswer,
  FlashcardContent,
  MediaItem,
  Message,
  PendingClarification,
  PendingQuizSetup,
  ProcessingStage,
  QuizContent,
  QuizOptions,
  UploadProgress,
} from "@/types";
import { isMediaReady, PROCESSING_STAGES } from "@/types";

const uid = () => crypto.randomUUID();

export default function ChatPage() {
  const { user, logout, refreshUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const qc = useQueryClient();

  // Optional personalization onboarding: shown once for users who have not yet
  // completed or skipped it. Dismissed locally so it never reappears mid-session.
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  const showOnboarding =
    !!user &&
    (user.personalization_status ?? "pending") === "pending" &&
    !onboardingDismissed;

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
  const [thinkingHint, setThinkingHint] = useState<ThinkingHint | undefined>();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);

  // Touch navigation: swipe right opens the nav drawer, swipe left opens the
  // files sheet. Touch-only, so desktop pointer use is unaffected.
  const chatSwipe = useSwipe({
    onSwipeRight: () => setSidebarOpen(true),
    onSwipeLeft: () => setMediaOpen(true),
  });

  const [activeQuiz, setActiveQuiz] = useState<QuizContent | null>(null);
  const [quizOpen, setQuizOpen] = useState(false);
  const [activeFlashcards, setActiveFlashcards] = useState<string | null>(null);
  const [flashcardsOpen, setFlashcardsOpen] = useState(false);

  const mediaQuery = useMedia();
  const media = mediaQuery.data ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  const deleteMedia = useDeleteMedia();

  // Session workspace: quizzes & flashcards generated in THIS chat, shown in
  // the sidebar's learning-resources section.
  const { data: allQuizzes = [], isLoading: quizzesLoading } = useQuizzes();
  const { data: allFlashcards = [], isLoading: flashcardsLoading } =
    useFlashcardSets();
  const sessionQuizzes = activeId
    ? allQuizzes.filter((q) => q.session_id === activeId)
    : [];
  const sessionFlashcards = activeId
    ? allFlashcards.filter((f) => f.session_id === activeId)
    : [];
  const resourcesLoading = quizzesLoading || flashcardsLoading;

  // Desktop-only resizable media sidebar; width remembered for the session.
  const [mediaWidth, setMediaWidth] = useState<number>(() => {
    const saved = Number(sessionStorage.getItem("aeva_media_width"));
    return saved >= 240 && saved <= 560 ? saved : 288; // 288px = w-72
  });
  const latestMediaWidth = useRef(mediaWidth);
  const startMediaResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const onMove = (ev: PointerEvent) => {
      const w = Math.min(560, Math.max(240, window.innerWidth - ev.clientX));
      latestMediaWidth.current = w;
      setMediaWidth(w);
    };
    const onUp = () => {
      sessionStorage.setItem(
        "aeva_media_width",
        String(latestMediaWidth.current),
      );
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [seedBanner, setSeedBanner] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  // Read-only bookmark preview (no session is created until the user acts).
  const [preview, setPreview] = useState<BookmarkData | null>(null);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("aeva_sidebar_collapsed") === "1",
  );
  const toggleCollapse = () =>
    setCollapsed((c) => {
      localStorage.setItem("aeva_sidebar_collapsed", c ? "0" : "1");
      return !c;
    });

  const { start, stop, streaming } = useAssistantStream();
  const processing = useMediaProcessing();
  const streamIdRef = useRef<string | null>(null);
  const composerRef = useRef<ChatComposerHandle>(null);
  // True while the user is on a fresh, empty "New chat" with no session yet.
  const newChatRef = useRef(false);
  const loadedSession = useRef<string | null>(null);
  // Saved-content context to fold into the next message (resume-from-bookmark).
  const seedContextRef = useRef<string | null>(null);
  const seedAppliedRef = useRef<string | null>(null);

  // Only show a loader when the URL names a session we're still fetching.
  // No sessionId in the URL = a fresh new chat → empty screen, never a loader.
  const loadingSession =
    !!urlId &&
    loadedSession.current !== urlId &&
    (!sessionsQuery.isSuccess || sessions.some((s) => s.id === urlId));

  /* --- open a read-only bookmark preview when navigated with one.
     `/chat` with no sessionId is simply a fresh new chat — we never
     auto-select the most recent session, so a refresh stays put. --- */
  useEffect(() => {
    const st = location.state as { previewBookmark?: BookmarkData } | null;
    if (st?.previewBookmark) {
      setPreview(st.previewBookmark);
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  /* --- load history when the active session changes --- */
  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      setHistoryLoading(false);
      return;
    }
    if (loadedSession.current === activeId) return;
    loadedSession.current = activeId;
    setPendingClar(null);
    setPendingQuiz(null);
    // Switching to a DIFFERENT existing conversation drops the media
    // selection (that chat has its own context). Sending a message — which
    // lazily creates a session and pre-sets loadedSession — does NOT reach
    // here, so a user's selection survives across their questions.
    setSelected(new Set());
    setMessages([]);
    setHistoryLoading(true);
    getMessages(activeId)
      .then(setMessages)
      .catch(() => toast.error("Failed to load chat"))
      .finally(() => setHistoryLoading(false));
  }, [activeId]);

  const upsertStreaming = (delta: string) =>
    setMessages((prev) =>
      prev.map((m) =>
        m.id === streamIdRef.current ? { ...m, content: m.content + delta } : m,
      ),
    );
  const removeStreaming = () =>
    setMessages((prev) => prev.filter((m) => m.id !== streamIdRef.current));

  // Stop generation: abort the stream, keep whatever was already produced.
  const handleStop = () => {
    stop();
    setThinkingHint(undefined);
    setMessages((prev) =>
      prev.flatMap((m) => {
        if (m.id !== streamIdRef.current) return [m];
        return m.content ? [{ ...m, streaming: false }] : [];
      }),
    );
  };

  const send = useCallback(
    async (
      text: string,
      opts?: {
        runId?: string;
        clarification?: ClarificationAnswer;
        quizOptions?: QuizOptions;
        flashcardOptions?: { count?: number };
        sourceContent?: string;
        displayText?: string;
      },
    ) => {
      if (streaming) return;

      const streamId = `stream-${uid()}`;
      const userMsgId = uid();
      streamIdRef.current = streamId;
      setThinkingHint(
        opts?.flashcardOptions
          ? "flashcard"
          : opts?.quizOptions
            ? "quiz"
            : selected.size
              ? "media"
              : opts?.sourceContent
                ? "thinking"
                : "web",
      );

      // Fold saved-content context into a plain message (resume-from-bookmark).
      let outgoing = text;
      let display = opts?.displayText ?? text;
      if (
        seedContextRef.current &&
        !opts?.runId &&
        !opts?.quizOptions &&
        !opts?.sourceContent &&
        !opts?.flashcardOptions
      ) {
        outgoing =
          "Using ONLY this saved content as context:\n\n\"\"\"\n" +
          `${seedContextRef.current}\n"""\n\n${text}`;
        display = text;
        seedContextRef.current = null;
        setSeedBanner(null);
      }

      // Render the user's message + a streaming placeholder IMMEDIATELY, so the
      // loader appears the instant Send is clicked — even before the session
      // exists. On a brand-new chat the session is created just below; the user
      // never sees a blank waiting state.
      setMessages((prev) => [
        ...prev,
        { id: userMsgId, role: "user", content: display, createdAt: new Date() },
        {
          id: streamId,
          role: "assistant",
          content: "",
          createdAt: new Date(),
          streaming: true,
        },
      ]);

      // Lazily create the session on the first message — empty "New chat"
      // screens never persist a session until the user actually asks.
      let sid = activeId;
      if (!sid) {
        try {
          const s = await createSession.mutateAsync({});
          sid = s.id;
          newChatRef.current = false;
          loadedSession.current = sid;
          setSearchParams({ sessionId: sid });
        } catch {
          // Roll back the optimistic messages we rendered above.
          setMessages((prev) =>
            prev.filter((m) => m.id !== userMsgId && m.id !== streamId),
          );
          setThinkingHint(undefined);
          toast.error("Couldn't start a new chat");
          return;
        }
      }

      start(
        {
          message: outgoing,
          session_id: sid,
          media_ids: selected.size ? Array.from(selected) : undefined,
          run_id: opts?.runId,
          clarification: opts?.clarification,
          quiz_options: opts?.quizOptions,
          flashcard_options: opts?.flashcardOptions,
          source_content: opts?.sourceContent,
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
            const flashcards =
              toolUsed === "flashcard_generator"
                ? (content as unknown as FlashcardContent)
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
                        flashcards,
                        available_actions: content.available_actions as
                          | string[]
                          | undefined,
                        suggested_followups:
                          content.suggested_followups as Message["meta"]["suggested_followups"],
                        response_type: content.response_type as
                          | string
                          | undefined,
                      },
                    }
                  : m,
              ),
            );
            sessionsQuery.refetch();
            // Surface a freshly generated resource in the sidebar workspace.
            if (quiz) qc.invalidateQueries({ queryKey: qk.quizzes });
            if (flashcards) qc.invalidateQueries({ queryKey: qk.flashcards });
            // Auto-open the study panel right after a set is generated.
            if (flashcards?.set_id) {
              setActiveFlashcards(flashcards.set_id);
              setFlashcardsOpen(true);
            }
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
              questionCount: (data.question_count as number | null) ?? null,
              questionTypes:
                (data.question_types as PendingQuizSetup["questionTypes"]) ??
                null,
              difficulty:
                (data.difficulty as PendingQuizSetup["difficulty"]) ?? null,
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
    [activeId, selected, streaming, start, createSession, setSearchParams],
  );

  /* --- resume-from-bookmark: seed a fresh session with saved content --- */
  useEffect(() => {
    const seed = (location.state as { seed?: ChatSeed } | null)?.seed;
    if (!seed || !activeId) return;
    if (seedAppliedRef.current === activeId) return;
    if (loadedSession.current !== activeId) return;
    seedAppliedRef.current = activeId;
    // Drop router state so a refresh/navigation won't replay the seed.
    navigate(`/chat?sessionId=${activeId}`, { replace: true });

    if (seed.mode === "continue") {
      send("Continue teaching me from this", {
        sourceContent: seed.content,
        displayText: "Continue learning",
      });
    } else if (seed.mode === "flashcards") {
      send("Create flashcards from this", {
        flashcardOptions: {},
        sourceContent: seed.content,
        displayText: "Create flashcards",
      });
    } else if (seed.mode === "quiz") {
      send("Generate a quiz from this", {
        quizOptions: { question_count: 5 },
        sourceContent: seed.content,
        displayText: "Create a quiz",
      });
    } else if (seed.autoSend) {
      // followup with a question typed in the preview.
      send(seed.autoSend, {
        sourceContent: seed.content,
        displayText: seed.autoSend,
      });
    } else {
      // followup: attach the saved content to the user's first question.
      seedContextRef.current = seed.content;
      setSeedBanner(seed.title ?? "saved content");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, activeId, messages]);

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

  const handleGenerateQuiz = (
    topic: string,
    options: QuizOptions,
    sourceContent?: string,
  ) => {
    setPendingQuiz(null);
    const resolved = { ...options, topic: options.topic || topic || undefined };
    send(`Generate a quiz${resolved.topic ? ` on ${resolved.topic}` : ""}`, {
      quizOptions: resolved,
      sourceContent,
    });
  };

  const handleCreateFlashcards = (sourceContent: string) => {
    send("Create flashcards from this", {
      flashcardOptions: {},
      sourceContent,
      displayText: "Create flashcards",
    });
  };

  const openQuiz = (quiz: QuizContent) => {
    setActiveQuiz(quiz);
    setQuizOpen(true);
  };

  const openFlashcards = (setId: string) => {
    setActiveFlashcards(setId);
    setFlashcardsOpen(true);
  };

  // Sidebar quizzes come as list items; fetch the full quiz before opening.
  const openQuizById = async (quizId: string) => {
    try {
      const quiz = await getQuiz(quizId);
      openQuiz(quiz);
    } catch {
      toast.error("Couldn't open that quiz");
    }
  };

  // Preview actions create the session lazily, then seed the new chat.
  const previewAct = async (mode: ChatSeed["mode"], autoSend?: string) => {
    if (!preview) return;
    const seed: ChatSeed = {
      mode,
      content: preview.content || preview.title,
      title: preview.title,
      autoSend,
    };
    setPreview(null);
    const s = await createSession.mutateAsync({});
    navigate(`/chat?sessionId=${s.id}`, { state: { seed } });
  };

  const patchUpload = (id: string, patch: Partial<UploadProgress>) =>
    setUploads((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));

  const dropUpload = (id: string, delay = 0) =>
    window.setTimeout(
      () => setUploads((prev) => prev.filter((u) => u.id !== id)),
      delay,
    );

  /* --- Optimistic media cache: the upload response and SSE stream are the
     source of truth, so we never re-fetch GET /media after a change. --- */
  const upsertMediaCache = (item: MediaItem) =>
    qc.setQueryData<MediaItem[]>(qk.media, (prev = []) =>
      prev.some((m) => m.id === item.id) ? prev : [item, ...prev],
    );

  const setMediaStatus = (mediaId: string, status: ProcessingStage) =>
    qc.setQueryData<MediaItem[]>(qk.media, (prev) =>
      prev?.map((m) =>
        m.id === mediaId ? { ...m, processing_status: status } : m,
      ),
    );

  const removeMediaCache = (mediaId: string) =>
    qc.setQueryData<MediaItem[]>(qk.media, (prev) =>
      prev?.filter((m) => m.id !== mediaId),
    );

  // Drive the SSE processing stream for an uploaded media id, mapping frames to
  // the upload card and keeping the shared media cache in lock-step.
  const runProcessing = (rowId: string, mediaId: string) =>
    processing.start(mediaId, {
      onFrame: (f) => {
        patchUpload(rowId, {
          status: "processing",
          stage: f.stage,
          progress: f.pct || PROCESSING_STAGES[f.stage]?.pct || 0,
          message: f.msg,
        });
        setMediaStatus(mediaId, f.stage);
      },
      onReady: () => {
        patchUpload(rowId, { status: "ready", stage: "ready", progress: 100 });
        setMediaStatus(mediaId, "ready");
        // The freshly indexed file becomes active context automatically.
        setSelected((prev) => new Set(prev).add(mediaId));
        dropUpload(rowId, 900);
      },
      onError: (msg, recoverable) => {
        patchUpload(rowId, { status: "error", message: msg, recoverable });
        // A recoverable run keeps its record (resume); an unrecoverable one was
        // scrubbed by the backend, so drop it from the cache too.
        if (recoverable) setMediaStatus(mediaId, "error");
        else removeMediaCache(mediaId);
      },
    });

  const startUpload = async (file: File, rowId = uid()) => {
    setUploads((prev) => {
      const row: UploadProgress = {
        id: rowId,
        name: file.name,
        progress: 0,
        status: "uploading",
        file,
      };
      return prev.some((u) => u.id === rowId)
        ? prev.map((u) => (u.id === rowId ? row : u))
        : [row, ...prev];
    });

    let item: MediaItem;
    try {
      item = await uploadFileWithProgress(file, activeId ?? undefined, (p) =>
        patchUpload(rowId, { progress: p }),
      );
    } catch (e) {
      patchUpload(rowId, {
        status: "error",
        recoverable: false,
        message: e instanceof Error ? e.message : "Upload failed",
      });
      return;
    }

    // Surface the new file immediately, then let the SSE stream advance its
    // status in place — no GET /media round-trip anywhere in this flow.
    upsertMediaCache({ ...item, processing_status: "pending" });
    patchUpload(rowId, {
      mediaId: item.id,
      status: "processing",
      stage: "pending",
      progress: PROCESSING_STAGES.pending.pct,
    });
    await runProcessing(rowId, item.id);
  };

  const handleUpload = async (files: FileList) => {
    const list = await compressFiles(files);
    await Promise.all(list.map((file) => startUpload(file)));
  };

  const handleRetryUpload = (rowId: string) => {
    const row = uploads.find((u) => u.id === rowId);
    if (!row) return;
    if (row.recoverable && row.mediaId) {
      // Resume the still-present run rather than re-uploading.
      patchUpload(rowId, {
        status: "processing",
        stage: "pending",
        message: undefined,
        recoverable: undefined,
        progress: PROCESSING_STAGES.pending.pct,
      });
      void runProcessing(rowId, row.mediaId);
    } else if (row.file) {
      void startUpload(row.file, rowId);
    } else {
      dropUpload(rowId);
    }
  };

  const handleDismissUpload = (rowId: string) => dropUpload(rowId);

  const handleNewChat = () => {
    // Land on a fresh, empty composer — the session is created only when the
    // user actually sends their first message.
    newChatRef.current = true;
    loadedSession.current = null;
    setPreview(null);
    setMessages([]);
    setPendingClar(null);
    setPendingQuiz(null);
    setSearchParams({});
    setSidebarOpen(false);
    composerRef.current?.focus();
  };

  const handleDeleteSession = async (id: string) => {
    await deleteSession.mutateAsync(id);
    if (id === activeId) {
      const rest = sessions.filter((s) => s.id !== id);
      if (rest.length) setSearchParams({ sessionId: rest[0].id });
      else setSearchParams({});
    }
  };

  const openQuizSetup = () =>
    setPendingQuiz({ topic: "", mediaAvailable: selected.size > 0 });

  useGlobalShortcuts({
    onCommandPalette: () => setPaletteOpen((o) => !o),
    onNewChat: handleNewChat,
    onSlashMenu: () => composerRef.current?.openCommands(),
  });

  const toggleMedia = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        return next;
      }
      // A file is only usable as context once it has finished indexing.
      const item = media.find((m) => m.id === id);
      if (item && !isMediaReady(item)) {
        toast.error("This file is still being processed");
        return prev;
      }
      next.add(id);
      return next;
    });

  const renderSidebar = (mobile: boolean) => (
    <AppSidebar
      collapsed={mobile ? false : collapsed}
      canCollapse={!mobile}
      onToggleCollapse={toggleCollapse}
      onNewChat={handleNewChat}
      onSearch={() => setPaletteOpen(true)}
      sessions={sessions}
      loading={sessionsQuery.isLoading}
      activeId={activeId}
      onSelectSession={(id) => {
        setSearchParams({ sessionId: id });
        setSidebarOpen(false);
      }}
      onDeleteSession={handleDeleteSession}
    />
  );

  const mediaSidebar = (
    <MediaSidebar
      items={media}
      uploads={uploads}
      selected={selected}
      activeSessionId={activeId}
      mediaLoading={mediaQuery.isLoading}
      quizzes={sessionQuizzes}
      flashcardSets={sessionFlashcards}
      resourcesLoading={resourcesLoading}
      onToggle={toggleMedia}
      onDelete={(id) => deleteMedia.mutateAsync(id)}
      onUpload={handleUpload}
      onRetryUpload={handleRetryUpload}
      onDismissUpload={handleDismissUpload}
      onOpenQuiz={openQuizById}
      onOpenFlashcards={openFlashcards}
    />
  );

  return (
    <DocumentViewerProvider>
      <Seo title="StudyAssistant — Chat with Aeva" noindex path="/chat" />
      <div className="flex h-dvh flex-col bg-background">
        {/* Top bar */}
        <header className="z-10 flex items-center gap-2 border-b border-border/50 px-3 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)]">
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
            aria-label="Your files"
          >
            <FolderOpen className="h-4 w-4" />
            <span className="hidden sm:inline">Files</span>
            {media.length > 0 && (
              <Badge variant="secondary" className="ml-0.5 h-5 px-1.5">
                {media.length}
              </Badge>
            )}
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="hidden lg:inline-flex"
                onClick={() => navigate("/bookmarks")}
                aria-label="Bookmarks"
              >
                <Bookmark className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Bookmarks</TooltipContent>
          </Tooltip>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setPaletteOpen(true)}
            aria-label="Search"
          >
            <Search className="h-4 w-4" />
          </Button>
          <div className="hidden lg:block">
            <ThemeToggle />
          </div>
          <Avatar className="hidden h-8 w-8 lg:flex">
            <AvatarImage src={user?.avatar_url || undefined} />
            <AvatarFallback>
              {user?.full_name?.[0] || user?.email?.[0] || "?"}
            </AvatarFallback>
          </Avatar>
          <Button
            variant="ghost"
            size="icon"
            className="hidden lg:inline-flex"
            onClick={logout}
            aria-label="Log out"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </header>

        <div className="flex flex-1 overflow-hidden">
          {/* Left session sidebar */}
          <aside className="hidden shrink-0 border-r border-border/50 lg:block">
            {renderSidebar(false)}
          </aside>
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            <SheetContent side="left" className="w-72 p-0">
              {renderSidebar(true)}
            </SheetContent>
          </Sheet>

          {/* Chat column */}
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden pb-bottomnav lg:pb-0">
            <div className="flex-1 overflow-y-auto" {...chatSwipe}>
              {preview ? (
                <BookmarkPreview
                  bookmark={preview}
                  onContinue={() => previewAct("continue")}
                  onQuiz={() => previewAct("quiz")}
                  onFlashcards={() => previewAct("flashcards")}
                  onClose={() => setPreview(null)}
                />
              ) : historyLoading || loadingSession ? (
                <ChatSkeleton />
              ) : messages.length === 0 && !streaming ? (
                <div className="h-full">
                  <EmptyState onPick={(t) => send(t)} />
                </div>
              ) : (
                <ChatMessages
                  messages={messages}
                  mediaAvailable={selected.size > 0}
                  quizBusy={streaming}
                  thinkingHint={thinkingHint}
                  onAction={(message, sourceContent) =>
                    send(message, { sourceContent, displayText: message })
                  }
                  onFollowup={(prompt, title) =>
                    send(prompt, { displayText: title })
                  }
                  onGenerateQuiz={handleGenerateQuiz}
                  onCreateFlashcards={handleCreateFlashcards}
                  onOpenQuiz={openQuiz}
                  onOpenFlashcards={openFlashcards}
                />
              )}
            </div>

            {pendingClar && (
              <div className="mx-auto w-full max-w-4xl px-4 pb-2">
                <ClarificationPanel
                  data={pendingClar.data}
                  busy={streaming}
                  onSubmit={handleClarify}
                  onCancel={() => setPendingClar(null)}
                />
              </div>
            )}
            {pendingQuiz && (
              <div className="mx-auto w-full max-w-4xl px-4 pb-2">
                <GlassCard className="p-4">
                  <p className="mb-3 flex items-center gap-1.5 font-display text-sm font-semibold">
                    <Sparkles className="h-4 w-4 text-brand-1" /> Set up your quiz
                  </p>
                  <QuizSetupForm
                    initialTopic={pendingQuiz.topic}
                    initialCount={pendingQuiz.questionCount}
                    initialTypes={pendingQuiz.questionTypes}
                    initialDifficulty={pendingQuiz.difficulty}
                    mediaAvailable={pendingQuiz.mediaAvailable}
                    busy={streaming}
                    onGenerate={(opts) =>
                      handleGenerateQuiz(pendingQuiz.topic, opts)
                    }
                  />
                </GlassCard>
              </div>
            )}

            {seedBanner && (
              <div className="mx-auto w-full max-w-4xl px-4 pb-2">
                <div className="flex items-center gap-2 rounded-xl border border-brand-1/30 bg-brand-1/5 px-3 py-2 text-xs">
                  <Bookmark className="h-3.5 w-3.5 text-brand-1" />
                  <span className="flex-1 truncate">
                    Continuing from{" "}
                    <span className="font-medium">{seedBanner}</span> — your next
                    message will use it as context.
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      seedContextRef.current = null;
                      setSeedBanner(null);
                    }}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            {streaming && (
              <div className="mx-auto mb-1 flex w-full max-w-4xl justify-center px-4">
                <button
                  type="button"
                  onClick={handleStop}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background/90 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm backdrop-blur transition-colors hover:bg-muted"
                >
                  <Square className="h-3 w-3 fill-current" />
                  Stop generating
                </button>
              </div>
            )}

            <ChatComposer
              ref={composerRef}
              onSend={(t) => (preview ? previewAct("followup", t) : send(t))}
              onUpload={handleUpload}
              onQuizCommand={openQuizSetup}
              disabled={streaming}
              locked={!!pendingClar}
              uploading={uploads.some((u) => u.status === "uploading")}
              selectedCount={selected.size}
              onOpenFiles={() => setMediaOpen(true)}
            />
          </main>

          {/* Right media sidebar (persistent on xl, drag-to-resize on desktop) */}
          <aside
            className="relative hidden shrink-0 border-l border-border/50 p-3 xl:block"
            style={{ width: mediaWidth }}
          >
            {/* Drag handle on the inner edge; remembers width for the session. */}
            <div
              onPointerDown={startMediaResize}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
              className="absolute left-0 top-0 z-10 h-full w-1.5 -translate-x-1/2 cursor-col-resize transition-colors hover:bg-brand-1/30"
            />
            {mediaSidebar}
          </aside>
          {/* Mobile/tablet: files open as a bottom sheet, not a side panel. */}
          <Drawer open={mediaOpen} onOpenChange={setMediaOpen}>
            <DrawerContent className="max-h-[85vh] pb-safe">
              <DrawerTitle className="sr-only">Your files</DrawerTitle>
              <div className="h-[70vh] overflow-hidden px-4 pb-2">
                {mediaSidebar}
              </div>
            </DrawerContent>
          </Drawer>
        </div>
      </div>

      <QuizDrawer quiz={activeQuiz} open={quizOpen} onOpenChange={setQuizOpen} />

      <FlashcardViewer
        setId={activeFlashcards}
        open={flashcardsOpen}
        onOpenChange={setFlashcardsOpen}
      />

      <GlobalCommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onNewChat={handleNewChat}
        onSelectSession={(id) => setSearchParams({ sessionId: id })}
      />

      <MobileNav />

      <OnboardingFlow
        open={showOnboarding}
        onDone={() => {
          setOnboardingDismissed(true);
          void refreshUser();
        }}
      />
    </DocumentViewerProvider>
  );
}
