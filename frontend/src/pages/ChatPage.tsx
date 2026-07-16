import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Bookmark,
  FolderOpen,
  GraduationCap,
  MessageSquarePlus,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Badge } from "@/components/ui/badge";
import { Seo } from "@/components/common/Seo";
import { ChatMessages } from "@/components/chat/ChatMessages";
import { ChatSkeleton } from "@/components/chat/ChatSkeleton";
import { BookmarkPreview } from "@/components/chat/BookmarkPreview";
import { ChatComposer, type ChatComposerHandle } from "@/components/chat/ChatComposer";
import { ClarificationPanel } from "@/components/chat/ClarificationPanel";
import { QuizSetup } from "@/components/chat/QuizSetup";
import { QuizDrawer } from "@/components/chat/QuizDrawer";
import { FlashcardViewer } from "@/components/chat/FlashcardViewer";
import { MediaSidebar } from "@/components/chat/MediaSidebar";
import { EmptyState } from "@/components/chat/EmptyState";
import { useShell } from "@/components/layout/AppLayout";
import { DRAWER_EDGE_SIZE } from "@/components/layout/MobileNavDrawer";
import { useHeaderSlot } from "@/components/layout/HeaderSlot";
import { OnboardingFlow } from "@/components/learning/OnboardingFlow";
import { useAuth } from "@/contexts/AuthContext";
import {
  DocumentViewerContext,
  useDocumentViewerController,
} from "@/contexts/DocumentViewerContext";
import { useIsDesktop } from "@/hooks/use-mobile";
import { useBackClose } from "@/hooks/useBackClose";
import { useAssistantStream } from "@/hooks/useAssistantStream";
import { useMediaProcessing } from "@/hooks/useMediaProcessing";
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
import { friendlyErrorMessage } from "@/lib/errorMessage";
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
  QuizSetupDraft,
  UploadProgress,
} from "@/types";
import { isMediaReady, PROCESSING_STAGES } from "@/types";
import { cn } from "@/lib/utils";

const PDFViewer = lazy(() => import("@/components/PDFViewer"));

const uid = () => crypto.randomUUID();

// The last active chat session, persisted so navigating to the Chat tab/button
// (which drops ?sessionId) restores the conversation on BOTH mobile (kept-alive)
// and desktop (where ChatPage remounts). Cleared only by New Chat.
const LAST_SESSION_KEY = "aeva_last_session";

export default function ChatPage() {
  const { user, refreshUser } = useAuth();
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
  // Sticky active session: adopt the URL's ?sessionId whenever present, but
  // RETAIN the last one (from sessionStorage) when the param is dropped —
  // tapping the Chat tab/button, or switching to another tab and back. This is
  // what makes the Chat tab restore its conversation (and keep a live stream
  // running) on mobile (kept-alive) AND desktop (where ChatPage remounts),
  // instead of blanking when the URL loses the id. New Chat clears it.
  const [stickyId, setStickyId] = useState<string | null>(() => {
    const wantsNew = (location.state as { newChat?: boolean } | null)?.newChat;
    if (wantsNew) return null;
    return urlId ?? sessionStorage.getItem(LAST_SESSION_KEY);
  });
  useEffect(() => {
    if (urlId && urlId !== stickyId) setStickyId(urlId);
  }, [urlId, stickyId]);
  useEffect(() => {
    if (stickyId) sessionStorage.setItem(LAST_SESSION_KEY, stickyId);
    else sessionStorage.removeItem(LAST_SESSION_KEY);
  }, [stickyId]);
  const activeId =
    stickyId && sessions.some((s) => s.id === stickyId) ? stickyId : null;
  const activeSession = sessions.find((s) => s.id === activeId) ?? null;

  const [messages, setMessages] = useState<Message[]>([]);
  const [pendingClar, setPendingClar] = useState<PendingClarification | null>(
    null,
  );
  const [pendingQuiz, setPendingQuiz] = useState<PendingQuizSetup | null>(null);
  // The setup popup is dismissible without losing the pending request: closing
  // it keeps `pendingQuiz` + the typed draft and surfaces a resume banner.
  const [quizSetupOpen, setQuizSetupOpen] = useState(false);
  const quizDraftRef = useRef<QuizSetupDraft | null>(null);
  const handleQuizDraftChange = useCallback((draft: QuizSetupDraft) => {
    quizDraftRef.current = draft;
  }, []);
  const [thinkingHint, setThinkingHint] = useState<ThinkingHint | undefined>();
  const [mediaOpen, setMediaOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);

  // Shell coordination: open the persistent nav drawer, auto-collapse the rail
  // while a document is docked, and own Cmd/Ctrl+/ for the composer.
  const { setDocked, openMobileNav, registerSlashHandler } = useShell();

  // Touch navigation: swipe right opens the nav drawer, swipe left opens the
  // files sheet. Touch-only, so desktop pointer use is unaffected.
  // Swipe left→right opens the nav. The media panel no longer opens by swipe
  // (it has its own button), which prevents accidental openings while reading.
  const chatSwipe = useSwipe({
    onSwipeRight: openMobileNav,
    // The drawer's finger-tracked edge-drag owns gestures starting there.
    deadZoneLeft: DRAWER_EDGE_SIZE,
  });

  const [activeQuiz, setActiveQuiz] = useState<QuizContent | null>(null);
  const [quizOpen, setQuizOpen] = useState(false);
  const [activeFlashcards, setActiveFlashcards] = useState<string | null>(null);
  const [flashcardsOpen, setFlashcardsOpen] = useState(false);

  // Native back gesture/button dismisses these mobile overlays instead of
  // leaving the chat. (The quiz dashboard and flashcard viewer bind their own
  // back handlers inside their components, covering every call site.)
  useBackClose(mediaOpen, () => setMediaOpen(false));
  useBackClose(toolsOpen, () => setToolsOpen(false));

  const mediaQuery = useMedia();
  const media = mediaQuery.data ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  // While an upload batch is in flight the media panel is auto-opened to show
  // live progress, then auto-closed once every file finishes cleanly. The ref
  // gates the close so it only fires after a batch we opened for.
  const uploadWatchRef = useRef(false);
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

  const [seedBanner, setSeedBanner] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  // Read-only bookmark preview (no session is created until the user acts).
  const [preview, setPreview] = useState<BookmarkData | null>(null);
  // Message to scroll to + flash when opened from a bookmark ("Open convo").
  const [highlightId, setHighlightId] = useState<string | null>(null);

  // Document viewer: docked beside the chat on desktop, full-screen on mobile
  // (or when the user expands it). State lives here so the layout can react —
  // shrink the chat for the panel and auto-collapse the nav sidebar.
  const docViewer = useDocumentViewerController();
  const isDesktop = useIsDesktop();
  const pdfOpen = !!docViewer.viewer;
  const pdfDocked = pdfOpen && isDesktop && docViewer.mode === "docked";
  const pdfFullscreen = pdfOpen && (!isDesktop || docViewer.mode === "fullscreen");

  const [pdfWidth, setPdfWidth] = useState<number>(() => {
    const saved = Number(sessionStorage.getItem("aeva_pdf_width"));
    return saved >= 360 && saved <= 760 ? saved : 480;
  });
  const latestPdfWidth = useRef(pdfWidth);
  const startPdfResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const onMove = (ev: PointerEvent) => {
      const w = Math.min(760, Math.max(360, window.innerWidth - ev.clientX));
      latestPdfWidth.current = w;
      setPdfWidth(w);
    };
    const onUp = () => {
      sessionStorage.setItem("aeva_pdf_width", String(latestPdfWidth.current));
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Auto-collapse the persistent nav rail while a document is docked, freeing
  // width for the chat + PDF; the shell restores the user's preference after.
  useEffect(() => {
    setDocked(pdfDocked);
  }, [pdfDocked, setDocked]);

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
  // Retry closures for failed turns, keyed by the failed message id. Populated
  // in send()'s onError so its error card can re-run the exact same request.
  const retryHandlers = useRef<Map<string, () => void>>(new Map());

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

  /* --- scroll to a specific message when opened from a bookmark. Consume the
     router state into local state and drop it (keeping ?sessionId) so a
     refresh won't re-trigger the flash. --- */
  useEffect(() => {
    const st = location.state as { highlightMessageId?: string } | null;
    if (st?.highlightMessageId) {
      setHighlightId(st.highlightMessageId);
      navigate(`${location.pathname}${location.search}`, { replace: true });
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
    // A "resume" seed (from flashcards/bookmarks) creates a brand-new empty
    // session and immediately drives a send() below. Skip the history fetch:
    // its async empty result would otherwise resolve AFTER the seed's
    // optimistic/streaming messages and wipe them (the quiz/flashcard then only
    // reappears on refresh).
    const seed = (location.state as { seed?: ChatSeed } | null)?.seed;
    if (seed) {
      setHistoryLoading(false);
      return;
    }
    setHistoryLoading(true);
    getMessages(activeId)
      .then(setMessages)
      .catch(() => toast.error("Failed to load chat"))
      .finally(() => setHistoryLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          setStickyId(sid);
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
            quizDraftRef.current = null;
            setQuizSetupOpen(true);
            setPendingQuiz({
              topic: (data.topic as string) || "",
              mediaAvailable: Boolean(data.media_available),
              questionCount: (data.question_count as number | null) ?? null,
              questionTypes:
                (data.question_types as PendingQuizSetup["questionTypes"]) ??
                null,
              difficulty:
                (data.difficulty as PendingQuizSetup["difficulty"]) ?? null,
              examConfig:
                (data.exam_config as PendingQuizSetup["examConfig"]) ?? null,
            });
          },
          onError: (msg) => {
            // Keep the turn in the thread as a friendly, AI-styled error card
            // (with retry) instead of dropping it to a transient toast.
            const friendly = friendlyErrorMessage(msg);
            retryHandlers.current.set(streamId, () => {
              retryHandlers.current.delete(streamId);
              setMessages((prev) =>
                prev.filter((m) => m.id !== streamId && m.id !== userMsgId),
              );
              void send(text, opts);
            });
            setMessages((prev) =>
              prev.map((m) =>
                m.id === streamId
                  ? {
                      ...m,
                      content: "",
                      streaming: false,
                      meta: {
                        ...m.meta,
                        error: { message: friendly, prompt: display },
                      },
                    }
                  : m,
              ),
            );
            setThinkingHint(undefined);
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
    setQuizSetupOpen(false);
    quizDraftRef.current = null;
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
    // Show progress right away: open the media panel on layouts where the
    // sidebar isn't already persistent (below Tailwind's `xl` breakpoint).
    uploadWatchRef.current = true;
    if (!window.matchMedia("(min-width: 1280px)").matches) setMediaOpen(true);
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

  // Auto-close the media panel once an upload batch finishes cleanly; keep it
  // open (showing the failing card with Retry / Remove) if anything errored.
  useEffect(() => {
    if (!uploadWatchRef.current) return;
    const active = uploads.some(
      (u) => u.status === "uploading" || u.status === "processing",
    );
    const failed = uploads.some((u) => u.status === "error");
    // Wait for in-flight work to settle; a failure holds the panel open.
    if (active || failed) return;
    uploadWatchRef.current = false;
    setMediaOpen(false);
  }, [uploads]);

  const handleNewChat = () => {
    // Land on a fresh, empty composer — the session is created only when the
    // user actually sends their first message.
    newChatRef.current = true;
    loadedSession.current = null;
    setPreview(null);
    setMessages([]);
    setPendingClar(null);
    setPendingQuiz(null);
    setStickyId(null);
    setSearchParams({});
    composerRef.current?.focus();
  };

  // "New chat" from the persistent sidebar navigates here with this flag; reset
  // to a fresh, empty composer, then drop the flag so a refresh won't replay it.
  useEffect(() => {
    const st = location.state as { newChat?: boolean } | null;
    if (st?.newChat) {
      handleNewChat();
      navigate("/chat", { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const handleDeleteSession = async (id: string) => {
    await deleteSession.mutateAsync(id);
    if (id === activeId) {
      const rest = sessions.filter((s) => s.id !== id);
      if (rest.length) setSearchParams({ sessionId: rest[0].id });
      else setSearchParams({});
    }
  };

  const openQuizSetup = () => {
    // Reuse the pending request (and its typed draft) when one exists so the
    // /quiz command doubles as "resume the setup I closed".
    setPendingQuiz(
      (prev) => prev ?? { topic: "", mediaAvailable: selected.size > 0 },
    );
    setQuizSetupOpen(true);
  };

  const dismissQuizSetup = () => {
    setPendingQuiz(null);
    setQuizSetupOpen(false);
    quizDraftRef.current = null;
  };

  // The chat composer owns Cmd/Ctrl+/ (slash commands) while chat is active;
  // the shell owns Cmd/Ctrl+F (search) and Cmd/Ctrl+N (new chat).
  useEffect(() => {
    registerSlashHandler(() => composerRef.current?.openCommands());
    return () => registerSlashHandler(null);
  }, [registerSlashHandler]);

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

  // Chat-specific header content published into the persistent AppHeader: the
  // active session title (left) and the mobile/tablet Files & Tools toggles
  // (right, before the shared controls). The shared controls never rebuild.
  const filesCount = media.length;
  const toolsCount = sessionQuizzes.length + sessionFlashcards.length;
  const sessionTitle = activeSession?.title ?? "Aeva";
  useHeaderSlot(
    {
      start: (
        // Title is desktop-only — the mobile header stays minimal (just the
        // menu + actions) to save vertical space.
        <span className="hidden truncate text-sm font-medium lg:block">
          {sessionTitle}
        </span>
      ),
      end: (
        <>
          {/* New Chat lives in the chat header on mobile — the bottom-nav Chat
              tab just returns to the current workspace (kept alive). Hidden on
              desktop, where the sidebar owns New Chat. */}
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={handleNewChat}
            aria-label="New chat"
          >
            <MessageSquarePlus className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 xl:hidden"
            onClick={() => setMediaOpen(true)}
            aria-label="Your files"
          >
            <FolderOpen className="h-4 w-4" />
            <span className="hidden sm:inline">Files</span>
            {filesCount > 0 && (
              <Badge variant="secondary" className="ml-0.5 h-5 px-1.5">
                {filesCount}
              </Badge>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 xl:hidden"
            onClick={() => setToolsOpen(true)}
            aria-label="Learning tools"
          >
            <GraduationCap className="h-4 w-4" />
            <span className="hidden sm:inline">Tools</span>
            {toolsCount > 0 && (
              <Badge variant="secondary" className="ml-0.5 h-5 px-1.5">
                {toolsCount}
              </Badge>
            )}
          </Button>
        </>
      ),
    },
    [sessionTitle, filesCount, toolsCount],
  );

  const renderMediaSidebar = (section: "media" | "resources" | "both") => (
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
      onOpenQuiz={(id) => {
        setToolsOpen(false);
        void openQuizById(id);
      }}
      onOpenFlashcards={(id) => {
        setToolsOpen(false);
        openFlashcards(id);
      }}
      section={section}
    />
  );

  return (
    <DocumentViewerContext.Provider value={docViewer.value}>
      <Seo title="StudyAssistant — Chat with Aeva" noindex path="/chat" />
      <div
        className="relative flex h-full flex-col bg-background"
        style={pdfDocked ? { paddingRight: pdfWidth } : undefined}
      >
        <div className="flex flex-1 overflow-hidden">
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
                  onRetry={(id) => retryHandlers.current.get(id)?.()}
                  highlightId={highlightId}
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
            {/* A quiz requested in chat opens the SAME setup UI as the chip —
               one component, one behaviour, everywhere. Closing the popup
               keeps the pending request + draft; the banner below resumes it. */}
            {pendingQuiz && (
              <QuizSetup
                open={quizSetupOpen}
                onOpenChange={setQuizSetupOpen}
                initialTopic={pendingQuiz.topic}
                initialCount={pendingQuiz.questionCount}
                initialTypes={pendingQuiz.questionTypes}
                initialDifficulty={pendingQuiz.difficulty}
                initialExamConfig={pendingQuiz.examConfig}
                draft={quizDraftRef.current}
                onDraftChange={handleQuizDraftChange}
                mediaAvailable={pendingQuiz.mediaAvailable}
                busy={streaming}
                onGenerate={(opts) => handleGenerateQuiz(pendingQuiz.topic, opts)}
              />
            )}

            {pendingQuiz && !quizSetupOpen && (
              <div className="mx-auto w-full max-w-4xl px-4 pb-2">
                <div className="flex items-center gap-2 rounded-xl border border-brand-1/30 bg-brand-1/5 px-3 py-2 text-xs">
                  <GraduationCap className="h-3.5 w-3.5 text-brand-1" />
                  <span className="flex-1 truncate">
                    Quiz setup in progress
                    {pendingQuiz.topic ? (
                      <>
                        {" "}
                        on <span className="font-medium">{pendingQuiz.topic}</span>
                      </>
                    ) : null}
                    {" "}— your settings are saved.
                  </span>
                  <button
                    type="button"
                    onClick={() => setQuizSetupOpen(true)}
                    className="font-semibold text-brand-1 hover:underline"
                  >
                    Resume
                  </button>
                  <button
                    type="button"
                    onClick={dismissQuizSetup}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    Dismiss
                  </button>
                </div>
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
              hasMedia={media.length > 0}
            />
          </main>

          {/* Right media sidebar (persistent on xl, drag-to-resize on desktop).
             Hidden while a document is docked so the PDF gets the room. */}
          <aside
            className={cn(
              "relative hidden shrink-0 border-l border-border/50 p-3",
              !pdfDocked && "xl:block",
            )}
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
            {renderMediaSidebar("both")}
          </aside>
          {/* Mobile/tablet: Media and Learning Tools are two separate sheets,
             each with its own entry point in the header. */}
          <Drawer open={mediaOpen} onOpenChange={setMediaOpen}>
            <DrawerContent className="max-h-[85vh] pb-safe">
              <DrawerTitle className="sr-only">Your files</DrawerTitle>
              <div className="h-[70vh] overflow-hidden px-4 pb-2">
                {renderMediaSidebar("media")}
              </div>
            </DrawerContent>
          </Drawer>
          <Drawer open={toolsOpen} onOpenChange={setToolsOpen}>
            <DrawerContent className="max-h-[85vh] pb-safe">
              <DrawerTitle className="sr-only">Learning tools</DrawerTitle>
              <div className="h-[70vh] overflow-hidden px-4 pb-2">
                {renderMediaSidebar("resources")}
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

      <OnboardingFlow
        open={showOnboarding}
        onDone={() => {
          setOnboardingDismissed(true);
          void refreshUser();
        }}
      />

      {/* Single PDF instance. Docked = a resizable right column beside the chat,
         absolutely positioned within the chat area so it sits below the shell
         header (the outer div's padding reserves its space); fullscreen = a
         viewport overlay that takes over. Toggling only changes this wrapper, so
         the document never reloads. */}
      {pdfOpen && (
        <div
          className={cn(
            pdfFullscreen
              ? "fixed inset-0 z-50"
              : "absolute right-0 top-0 z-40 h-full border-l border-border/50",
          )}
          style={pdfFullscreen ? undefined : { width: pdfWidth }}
        >
          {pdfDocked && (
            <div
              onPointerDown={startPdfResize}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize document panel"
              className="absolute left-0 top-0 z-10 h-full w-1.5 -translate-x-1/2 cursor-col-resize transition-colors hover:bg-brand-1/30"
            />
          )}
          <Suspense fallback={null}>
            <PDFViewer
              url={docViewer.viewer!.url}
              fileName={docViewer.viewer!.fileName}
              initialPage={docViewer.viewer!.page}
              onClose={docViewer.close}
              fullscreen={pdfFullscreen}
              onToggleFullscreen={
                isDesktop ? docViewer.toggleFullscreen : undefined
              }
            />
          </Suspense>
        </div>
      )}
    </DocumentViewerContext.Provider>
  );
}
