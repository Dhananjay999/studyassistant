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
  Loader2,
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
import {
  ChatComposer,
  type ChatComposerHandle,
  type ComposerNotice,
} from "@/components/chat/ChatComposer";
import { ClarificationPanel } from "@/components/chat/ClarificationPanel";
import { QuizSetup } from "@/components/chat/QuizSetup";
// Lazy chunks: these two pull the whole quiz/flashcard stack (runner, report,
// share, PDF export...). Loading them on first open keeps the chat page's
// critical request chain small (Lighthouse LCP finding).
const QuizDrawer = lazy(() =>
  import("@/components/chat/QuizDrawer").then((m) => ({
    default: m.QuizDrawer,
  })),
);
const FlashcardViewer = lazy(() =>
  import("@/components/chat/FlashcardViewer").then((m) => ({
    default: m.FlashcardViewer,
  })),
);
import { MediaSidebar } from "@/components/chat/MediaSidebar";
import { WelcomeHome } from "@/components/chat/WelcomeHome";
import { ExamPrepCta } from "@/components/exam/ExamPrepCta";
import { ContinueLearningRail } from "@/components/spaces/ContinueLearningRail";
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
import { useFeature } from "@/hooks/useFeature";
import { useMediaProcessing } from "@/hooks/useMediaProcessing";
import { useSwipe } from "@/hooks/useSwipe";
import { TOOL_TO_HINT, type ThinkingHint } from "@/lib/loadingMessages";
import {
  qk,
  useCreateNote,
  useCreateSession,
  useDeleteSession,
  useDeleteMedia,
  useFlashcardSets,
  useMedia,
  useQuizzes,
  useSessions,
} from "@/hooks/api";
import {
  attachMedia,
  getMessages,
  getQuiz,
  uploadFileWithProgress,
} from "@/lib/api";
import { normalizeAgents } from "@/lib/agents";
import { errorKind, friendlyErrorMessage } from "@/lib/errorMessage";
import { detectExamIntent } from "@/lib/examIntent";
import { isTeamTurn, mapAssistantContent } from "@/lib/messageMeta";
import {
  analytics,
  AnalyticsEvent,
  type ChatIntent,
  type ChatSource,
} from "@/lib/analytics";
import { compressFile } from "@/utils/compress";
import {
  UPLOAD_FAILURES,
  exceedsUploadLimit,
  preflightUpload,
  processingFailure,
  toUploadError,
  type UploadFailureReason,
  type UploadFailureStage,
} from "@/lib/uploadErrors";
import type {
  AgentInfo,
  Bookmark as BookmarkData,
  ChatSeed,
  ClarificationAnswer,
  MediaItem,
  Message,
  PendingClarification,
  PendingQuizSetup,
  ProcessingStage,
  ProcessingStatus,
  QuizContent,
  QuizOptions,
  QuizSetupDraft,
  UploadProgress,
} from "@/types";
import {
  isMediaProcessing,
  isMediaSelectable,
  PROCESSING_STAGES,
} from "@/types";
import { cn } from "@/lib/utils";

const PDFViewer = lazy(() => import("@/components/PDFViewer"));

const uid = () => crypto.randomUUID();

const fileExtension = (file: File) =>
  (file.name.split(".").pop() || "").toLowerCase().slice(0, 10);

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
  // Stamp the session onto cached media rows once they are attached
  // server-side (drives the "This chat" badge without a refetch).
  const setMediaSession = useCallback(
    (mediaIds: string[], sessionId: string) =>
      qc.setQueryData<MediaItem[]>(qk.media, (prev) =>
        prev?.map((m) =>
          mediaIds.includes(m.id) ? { ...m, session_id: sessionId } : m,
        ),
      ),
    [qc],
  );

  // Optional personalization onboarding: shown once for users who have not yet
  // completed or skipped it. Dismissed locally so it never reappears mid-session.
  const [onboardingDismissed, setOnboardingDismissed] = useState(false);
  // Exam Prep (default-off flag): a composer message that reads like exam
  // preparation earns one dismissible "Create exam plan" banner per mount.
  const examPrepEnabled = useFeature("exam_prep", false);
  const [showExamBanner, setShowExamBanner] = useState(false);
  const examBannerShownRef = useRef(false);
  const showOnboarding =
    !!user &&
    (user.personalization_status ?? "pending") === "pending" &&
    !onboardingDismissed;

  const sessionsQuery = useSessions();
  const sessions = sessionsQuery.data ?? [];
  const createSession = useCreateSession();
  const createNote = useCreateNote();
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
  // Latest session id for callbacks that outlive a render (upload/processing
  // handlers): a file that finishes indexing after the chat was lazily
  // created must still be attached to it.
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

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
  // The chat sidebar lists only the user's own uploads. Aeva-generated
  // images (stored under .../generated/) stay out of it — they already
  // render inline in the chat and live on the Study Material page.
  const media = (mediaQuery.data ?? []).filter(
    (m) => !m.storage_path.includes("/generated/"),
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [uploads, setUploads] = useState<UploadProgress[]>([]);
  // Latest upload/processing failure, shown briefly above the composer.
  const [uploadNotice, setUploadNotice] = useState<ComposerNotice | null>(null);
  const mediaRef = useRef(media);
  mediaRef.current = media;
  const uploadsRef = useRef(uploads);
  uploadsRef.current = uploads;
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
  // performance.now() when the in-flight turn was sent (analytics timing).
  const sendStartedAtRef = useRef(0);
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
    const cur = messages.find((m) => m.id === streamIdRef.current);
    analytics.track(AnalyticsEvent.CHAT_RESPONSE_STOPPED, {
      chat_session_id: activeId,
      elapsed_ms: Math.round(performance.now() - sendStartedAtRef.current),
      had_content: !!cur?.content,
    });
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
        /** Don't render a user bubble for this turn — the reply appears to
         * continue the previous flow (used for clarification answers). */
        silent?: boolean;
        /** Where the message came from (analytics). */
        source?: ChatSource;
        /** Dictation contributed to the text (analytics). */
        voiceUsed?: boolean;
      },
    ) => {
      if (streaming) return;

      // A selected file that is still indexing can't be searched yet — wait
      // for it instead of answering from memory and reporting "nothing found".
      const pendingFile = Array.from(selected)
        .map((id) => mediaRef.current.find((m) => m.id === id))
        .find((m): m is MediaItem => !!m && isMediaProcessing(m));
      if (pendingFile) {
        analytics.track(AnalyticsEvent.CHAT_SEND_BLOCKED, {
          reason: "media_processing",
          media_count: selected.size,
        });
        toast.info(`Waiting for ${pendingFile.file_name} to finish indexing…`);
        return;
      }

      const sentAt = performance.now();
      sendStartedAtRef.current = sentAt;
      let firstChunkAt: number | null = null;
      const intent: ChatIntent = opts?.clarification
        ? "clarification"
        : opts?.quizOptions
          ? "quiz"
          : opts?.flashcardOptions
            ? "flashcards"
            : opts?.sourceContent
              ? "source_seed"
              : opts?.source === "followup"
                ? "followup"
                : "text";
      analytics.track(AnalyticsEvent.CHAT_MESSAGE_SENT, {
        chat_session_id: activeId,
        is_new_session: !activeId,
        message_length: text.length,
        media_count: selected.size,
        intent,
        source: opts?.source ?? "composer",
        voice_used: !!opts?.voiceUsed,
        has_seed_context: !!seedContextRef.current,
      });
      if (
        examPrepEnabled &&
        !examBannerShownRef.current &&
        intent === "text" &&
        (opts?.source ?? "composer") === "composer" &&
        detectExamIntent(text)
      ) {
        examBannerShownRef.current = true;
        setShowExamBanner(true);
      }

      const streamId = `stream-${uid()}`;
      const userMsgId = uid();
      streamIdRef.current = streamId;
      // Immediate loader: a confident hint for deterministic turns (quiz/
      // flashcard forms, selected media), otherwise generic "thinking". The
      // backend's tool_selected frame corrects it the moment the orchestrator
      // actually picks a tool.
      setThinkingHint(
        opts?.flashcardOptions
          ? "flashcard"
          : opts?.quizOptions
            ? "quiz"
            : selected.size
              ? "media"
              : "thinking",
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
        ...(opts?.silent
          ? []
          : [
              {
                id: userMsgId,
                role: "user" as const,
                content: display,
                createdAt: new Date(),
              },
            ]),
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
          // Inherit the Study Space when the chat was opened from one
          // (/chat?spaceId=…). Read at call time to avoid a stale closure;
          // absent → the backend files the chat into General.
          const spaceId =
            new URLSearchParams(window.location.search).get("spaceId") ??
            undefined;
          // Attach every file already in play (selected, or uploaded while
          // there was no session yet) so session-scoped lookups find them.
          const uploadedIds = uploadsRef.current
            .map((u) => u.mediaId)
            .filter((id): id is string => !!id);
          const mediaIds = Array.from(new Set([...selected, ...uploadedIds]));
          const s = await createSession.mutateAsync({
            spaceId,
            mediaIds: mediaIds.length ? mediaIds : undefined,
          });
          sid = s.id;
          activeIdRef.current = sid;
          if (mediaIds.length) setMediaSession(mediaIds, sid);
          analytics.track(AnalyticsEvent.CHAT_SESSION_CREATED, {
            chat_session_id: sid,
            space_id: spaceId ?? null,
            trigger: "first_message",
          });
          newChatRef.current = false;
          loadedSession.current = sid;
          setStickyId(sid);
          setSearchParams({ sessionId: sid });
        } catch (err) {
          analytics.track(AnalyticsEvent.CHAT_SESSION_CREATE_FAILED, {
            error_kind: errorKind(err),
          });
          // Roll back the optimistic messages we rendered above.
          setMessages((prev) =>
            prev.filter((m) => m.id !== userMsgId && m.id !== streamId),
          );
          setThinkingHint(undefined);
          toast.error("Couldn't start a new chat");
          return;
        }
      }

      // Agent roster of this turn (one agent on ordinary turns).
      let team: AgentInfo[] = [];

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
          onChunk: (delta) => {
            if (firstChunkAt === null) firstChunkAt = performance.now();
            upsertStreaming(delta);
          },
          onAgentsPlanned: (raw) => {
            // The roster arrives before any token. A single agent keeps the
            // ordinary loader; a team gets the workboard on the message.
            team = normalizeAgents(raw);
            if (team.length < 2) return;
            const roster = team;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === streamId
                  ? { ...m, meta: { ...m.meta, agents: roster } }
                  : m,
              ),
            );
          },
          onAgentStatus: (update) => {
            const agent = team.find((a) => a.id === update.id);
            if (!agent || team.length < 2) return;
            const status = update.status as AgentInfo["status"];
            const settled = status === "done" || status === "failed";
            if (
              settled &&
              agent.status !== status &&
              agent.kind === "generator"
            ) {
              analytics.track(AnalyticsEvent.CHAT_AGENT_COMPLETED, {
                chat_session_id: sid,
                tool: agent.tool,
                status,
                ms: update.ms ?? 0,
                input: agent.input,
                agent_total: team.length,
              });
            }
            team = team.map((a) =>
              a.id === update.id
                ? {
                    ...a,
                    status,
                    ms: update.ms ?? a.ms,
                    note: settled && status === "failed" ? undefined : update.note ?? a.note,
                    error: update.error ?? a.error,
                    startedAt:
                      status === "running" ? (a.startedAt ?? Date.now()) : a.startedAt,
                  }
                : a,
            );
            const roster = team;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === streamId
                  ? { ...m, meta: { ...m.meta, agents: roster } }
                  : m,
              ),
            );
          },
          onToolSelected: (tool) => {
            analytics.track(AnalyticsEvent.CHAT_TOOL_SELECTED, {
              chat_session_id: sid,
              tool,
              agent_total: Math.max(team.length, 1),
            });
            setThinkingHint(TOOL_TO_HINT[tool] ?? "thinking");
          },
          onComplete: (full, meta) => {
            const content = (meta.content ?? {}) as Record<string, unknown>;
            const toolUsed = meta.tool_used as Message["meta"]["tool_used"];
            const mapped = mapAssistantContent(content, toolUsed);
            const { quiz, flashcards } = mapped;
            const teamTurn = isTeamTurn(mapped);
            analytics.track(AnalyticsEvent.CHAT_RESPONSE_COMPLETED, {
              chat_session_id: sid,
              tool_used: toolUsed,
              response_type: content.response_type as string | undefined,
              latency_ms: Math.round(performance.now() - sentAt),
              first_token_ms:
                firstChunkAt === null
                  ? null
                  : Math.round(firstChunkAt - sentAt),
              response_length: full.length,
              source_count: Array.isArray(content.sources)
                ? content.sources.length
                : 0,
              image_count: Array.isArray(content.images)
                ? content.images.length
                : 0,
              has_quiz: !!quiz,
              has_flashcards: !!flashcards,
              followup_count: Array.isArray(content.suggested_followups)
                ? content.suggested_followups.length
                : 0,
              tools_used: mapped.tools_used,
              agent_count: mapped.agents?.length ?? 1,
              parallel: !!mapped.parallel,
              failed_agents:
                mapped.agents?.filter((a) => a.status === "failed").length ??
                0,
              image_style:
                typeof content.style === "string" ? content.style : undefined,
            });
            setMessages((prev) =>
              prev.map((m) =>
                m.id === streamId
                  ? {
                      ...m,
                      // Everything is streamed, but a dropped frame must
                      // not lose text the final result carries.
                      content:
                        full ||
                        (typeof content.answer === "string"
                          ? content.answer
                          : "") ||
                        m.content,
                      streaming: false,
                      meta: mapped,
                    }
                  : m,
              ),
            );
            sessionsQuery.refetch();
            // Surface a freshly generated resource in the sidebar workspace.
            if (quiz) qc.invalidateQueries({ queryKey: qk.quizzes });
            if (flashcards) qc.invalidateQueries({ queryKey: qk.flashcards });
            // Generated images are media rows — refresh the library so the
            // sidebar/Files page (and stale-URL re-resolution) see them.
            if ((content.images as unknown[] | undefined)?.length) {
              qc.invalidateQueries({ queryKey: qk.media });
            }
            // Auto-open the study panel right after a set is generated —
            // but not on a team turn, where the set is one result of several
            // and opening it would hide the answer and the other cards.
            if (flashcards?.set_id && !teamTurn) {
              setActiveFlashcards(flashcards.set_id);
              setFlashcardsOpen(true);
            }
          },
          onClarification: (data) => {
            removeStreaming();
            const questions = (data.clarification as { questions?: unknown[] })
              ?.questions;
            analytics.track(AnalyticsEvent.CHAT_CLARIFICATION_REQUESTED, {
              chat_session_id: sid,
              question_count: Array.isArray(questions) ? questions.length : 0,
            });
            setPendingClar({
              runId: data.run_id as string,
              data: data.clarification as PendingClarification["data"],
            });
          },
          onQuizSetup: (data) => {
            removeStreaming();
            analytics.track(AnalyticsEvent.QUIZ_SETUP_REQUESTED, {
              chat_session_id: sid,
              media_available: Boolean(data.media_available),
              source: "assistant",
            });
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
              useMedia:
                typeof data.use_media === "boolean" ? data.use_media : null,
            });
          },
          onError: (msg) => {
            // Keep the turn in the thread as a friendly, AI-styled error card
            // (with retry) instead of dropping it to a transient toast.
            const friendly = friendlyErrorMessage(msg);
            analytics.track(AnalyticsEvent.CHAT_RESPONSE_FAILED, {
              chat_session_id: sid,
              error_kind: errorKind(msg),
              phase: firstChunkAt === null ? "pre_stream" : "mid_stream",
              latency_ms: Math.round(performance.now() - sentAt),
            });
            retryHandlers.current.set(streamId, () => {
              retryHandlers.current.delete(streamId);
              analytics.track(AnalyticsEvent.CHAT_RESPONSE_RETRIED, {
                chat_session_id: sid,
              });
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
    [
      activeId,
      selected,
      streaming,
      start,
      createSession,
      setSearchParams,
      setMediaSession,
      examPrepEnabled,
    ],
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
    analytics.track(AnalyticsEvent.CHAT_CLARIFICATION_ANSWERED, {
      action: answer.action === "skip" ? "skip" : "answer",
      answered_count:
        answer.action === "custom"
          ? 1
          : Object.keys(answer.answers ?? {}).length,
    });
    // Silent: the clarification answers never appear as a chat bubble — the
    // response simply continues generating in the same flow.
    send(label, { runId: pendingClar?.runId, clarification: answer, silent: true });
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
    analytics.track(AnalyticsEvent.QUIZ_GENERATION_REQUESTED, {
      question_count: resolved.question_count ?? 0,
      difficulty: resolved.target_exam
        ? "exam"
        : (resolved.difficulty ?? "default"),
      target_exam: resolved.target_exam,
      question_types: resolved.question_types ?? [],
      use_media: !!resolved.use_media,
      is_exam: !!resolved.exam_config,
      has_topic: !!resolved.topic,
      has_instructions: !!resolved.additional_instructions,
      source: sourceContent ? "action" : "setup",
    });
    // Show a short action label instead of echoing a near-duplicate of the
    // user's own request as a second bubble. The canonical text still goes to
    // the backend so topic inference keeps working when no topic was set.
    send(`Generate a quiz${resolved.topic ? ` on ${resolved.topic}` : ""}`, {
      quizOptions: resolved,
      sourceContent,
      displayText: `Start quiz${resolved.topic ? `: ${resolved.topic}` : ""}`,
    });
  };

  const handleCreateFlashcards = (sourceContent: string) => {
    analytics.track(AnalyticsEvent.FLASHCARDS_GENERATION_REQUESTED, {
      chat_session_id: activeId,
      source: "action",
    });
    send("Create flashcards from this", {
      flashcardOptions: {},
      sourceContent,
      displayText: "Create flashcards",
    });
  };

  // "Retry" on a failed agent card: re-run just that agent. Quiz and
  // flashcards use the same forced paths as their buttons (grounded in the
  // answer when the agent was built from it); the image is asked for again.
  const handleRetryAgent = (messageId: string, agent: AgentInfo) => {
    const index = messages.findIndex((m) => m.id === messageId);
    if (index === -1) return;
    const prompt =
      [...messages.slice(0, index)].reverse().find((m) => m.role === "user")
        ?.content ?? "";
    const answer = agent.input === "answer" ? messages[index].content : "";
    analytics.track(AnalyticsEvent.CHAT_AGENT_RETRIED, {
      chat_session_id: activeId,
      tool: agent.tool,
    });
    if (agent.tool === "quiz_generator") {
      send(prompt || "Create a quiz", {
        quizOptions: { topic: prompt || undefined },
        sourceContent: answer || undefined,
        displayText: "Retry the quiz",
        source: "action",
      });
    } else if (agent.tool === "flashcard_generator") {
      send(prompt || "Create flashcards", {
        flashcardOptions: {},
        sourceContent: answer || undefined,
        displayText: "Retry the flashcards",
        source: "action",
      });
    } else {
      send(`Create only the image for: ${prompt}`, {
        displayText: "Retry the image",
        source: "action",
      });
    }
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

  const setMediaStatus = (mediaId: string, status: ProcessingStatus) =>
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
  const runProcessing = (rowId: string, mediaId: string) => {
    const startedAt = performance.now();
    const stagesSeen = new Set<string>();
    let lastStage = "pending";
    const elapsed = () => Math.round(performance.now() - startedAt);
    return processing.start(mediaId, {
      onFrame: (f) => {
        stagesSeen.add(f.stage);
        lastStage = f.stage;
        patchUpload(rowId, {
          status: "processing",
          stage: f.stage,
          progress: f.pct || PROCESSING_STAGES[f.stage]?.pct || 0,
          message: f.msg,
        });
        setMediaStatus(mediaId, f.stage);
      },
      onReady: (via) => {
        analytics.track(AnalyticsEvent.MEDIA_PROCESSING_COMPLETED, {
          media_id: mediaId,
          processing_ms: elapsed(),
          via,
          stages_seen: stagesSeen.size,
        });
        patchUpload(rowId, { status: "ready", stage: "ready", progress: 100 });
        setMediaStatus(mediaId, "ready");
        // The freshly indexed file becomes active context automatically.
        setSelected((prev) => new Set(prev).add(mediaId));
        // Uploaded before the chat existed? Link it to the session created
        // since, so server-side session lookups can find it. Best-effort:
        // explicit media ids on each message work regardless.
        const sid = activeIdRef.current;
        const item = mediaRef.current.find((m) => m.id === mediaId);
        if (sid && item && !item.session_id) {
          void attachMedia(sid, [mediaId])
            .then(() => setMediaSession([mediaId], sid))
            .catch(() => {
              /* non-critical */
            });
        }
        dropUpload(rowId, 900);
      },
      onError: (msg, recoverable, _via, kept) => {
        const { reason, message } = processingFailure(msg);
        analytics.track(AnalyticsEvent.MEDIA_PROCESSING_FAILED, {
          media_id: mediaId,
          stage_last: lastStage,
          reason,
          recoverable,
          kept,
          processing_ms: elapsed(),
        });
        setUploadNotice({ id: uid(), message });
        patchUpload(rowId, {
          status: "error",
          message,
          recoverable,
          kept,
        });
        // The backend keeps failed uploads (retry in place, or answer from
        // the raw file); only a scrubbed legacy record leaves the cache.
        if (recoverable) setMediaStatus(mediaId, "error");
        else if (kept) setMediaStatus(mediaId, "failed");
        else removeMediaCache(mediaId);
      },
    });
  };

  // End an upload by naming its cause above the composer, and report it. A
  // failure that a retry can fix also keeps its card (that is where Retry is).
  const failUpload = (
    file: File,
    rowId: string,
    reason: UploadFailureReason,
    stage: UploadFailureStage,
    httpStatus = 0,
  ) => {
    const { message, retryable } = UPLOAD_FAILURES[reason];
    analytics.track(AnalyticsEvent.MEDIA_UPLOAD_FAILED, {
      upload_id: rowId,
      reason,
      stage,
      http_status: httpStatus,
      retryable,
      error_kind: reason === "network" ? "offline" : "generic",
      file_extension: fileExtension(file),
      mime_type: file.type || "unknown",
      size_bytes: file.size,
    });
    setUploadNotice({ id: uid(), message });
    if (!retryable) {
      setUploads((prev) => prev.filter((u) => u.id !== rowId));
      return;
    }
    const row: UploadProgress = {
      id: rowId,
      name: file.name,
      progress: 0,
      status: "error",
      message,
      recoverable: false,
      retryable,
      file,
    };
    setUploads((prev) =>
      prev.some((u) => u.id === rowId)
        ? prev.map((u) => (u.id === rowId ? row : u))
        : [row, ...prev],
    );
  };

  const startUpload = async (
    file: File,
    rowId = uid(),
    meta: {
      batchSize?: number;
      isRetry?: boolean;
      originalBytes?: number;
    } = {},
  ) => {
    const uploadStartedAt = performance.now();
    analytics.track(AnalyticsEvent.MEDIA_UPLOAD_STARTED, {
      upload_id: rowId,
      file_extension: fileExtension(file),
      mime_type: file.type || "unknown",
      size_bytes: file.size,
      original_size_bytes: meta.originalBytes ?? file.size,
      batch_size: meta.batchSize ?? 1,
      chat_session_id: activeId,
      is_retry: !!meta.isRetry,
    });
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
      const err = toUploadError(e);
      failUpload(file, rowId, err.reason, "upload", err.status);
      return;
    }
    analytics.track(AnalyticsEvent.MEDIA_UPLOAD_COMPLETED, {
      upload_id: rowId,
      media_id: item.id,
      mime_type: item.mime_type || file.type || "unknown",
      size_bytes: item.size_bytes ?? file.size,
      upload_ms: Math.round(performance.now() - uploadStartedAt),
    });

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
    const picked = Array.from(files);
    await Promise.all(
      picked.map(async (original) => {
        const rowId = uid();
        // Refuse an unusable file before sending any bytes; the reason shows
        // above the composer, so the media panel stays closed for it.
        const refused = await preflightUpload(original);
        if (refused) return failUpload(original, rowId, refused, "preflight");
        // Show progress from here on: open the media panel on layouts where
        // the sidebar isn't already persistent (below Tailwind's `xl`), and
        // show the card while a large file is being shrunk.
        uploadWatchRef.current = true;
        if (!window.matchMedia("(min-width: 1280px)").matches) setMediaOpen(true);
        setUploads((prev) => [
          { id: rowId, name: original.name, progress: 0, status: "uploading" },
          ...prev,
        ]);
        const file = await compressFile(original);
        if (exceedsUploadLimit(file)) {
          return failUpload(file, rowId, "too_large", "preflight");
        }
        await startUpload(file, rowId, {
          batchSize: picked.length,
          originalBytes: original.size,
        });
      }),
    );
  };

  const handleRetryUpload = (rowId: string) => {
    const row = uploads.find((u) => u.id === rowId);
    if (!row) return;
    const inPlace = !!row.mediaId && (row.recoverable || row.kept);
    analytics.track(AnalyticsEvent.MEDIA_UPLOAD_RETRIED, {
      upload_id: rowId,
      mode: inPlace ? "resume" : "reupload",
    });
    if (inPlace && row.mediaId) {
      // The record is still there: resume (slow parse) or re-index (failed
      // parse — the backend submits a fresh job) rather than re-uploading.
      patchUpload(rowId, {
        status: "processing",
        stage: "pending",
        message: undefined,
        recoverable: undefined,
        progress: PROCESSING_STAGES.pending.pct,
      });
      void runProcessing(rowId, row.mediaId);
    } else if (row.file) {
      void startUpload(row.file, rowId, { isRetry: true });
    } else {
      dropUpload(rowId);
    }
  };

  // Sidebar "Retry" on a file that failed to index earlier: re-run the
  // pipeline in place with a live progress card, exactly like a fresh upload.
  const handleReprocess = (mediaId: string) => {
    const item = mediaRef.current.find((m) => m.id === mediaId);
    if (!item) return;
    const rowId = uid();
    analytics.track(AnalyticsEvent.MEDIA_UPLOAD_RETRIED, {
      upload_id: rowId,
      mode: "resume",
    });
    setUploads((prev) => [
      {
        id: rowId,
        mediaId,
        name: item.file_name,
        progress: PROCESSING_STAGES.pending.pct,
        status: "processing",
        stage: "pending",
      },
      ...prev,
    ]);
    setMediaStatus(mediaId, "pending");
    void runProcessing(rowId, mediaId);
  };

  const handleDismissUpload = (rowId: string) => {
    analytics.track(AnalyticsEvent.MEDIA_UPLOAD_DISMISSED, {
      upload_id: rowId,
      status: uploads.find((u) => u.id === rowId)?.status ?? "unknown",
    });
    dropUpload(rowId);
  };

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
    analytics.track(AnalyticsEvent.QUIZ_SETUP_REQUESTED, {
      chat_session_id: activeId,
      media_available: selected.size > 0,
      source: "slash",
    });
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

  const toggleMedia = (id: string) => {
    const wasSelected = selected.has(id);
    const item = media.find((m) => m.id === id);
    const refused = !wasSelected && !!item && !isMediaSelectable(item);
    analytics.track(AnalyticsEvent.MEDIA_CONTEXT_TOGGLED, {
      media_id: id,
      selected: !wasSelected && !refused,
      selected_count: wasSelected
        ? selected.size - 1
        : refused
          ? selected.size
          : selected.size + 1,
      refused_not_ready: refused,
    });
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        return next;
      }
      // A file is usable as context once indexing has finished (a failed
      // index is fine — the backend answers from the raw file).
      const item = media.find((m) => m.id === id);
      if (item && !isMediaSelectable(item)) {
        toast.error("This file is still being processed");
        return prev;
      }
      next.add(id);
      return next;
    });
  };

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
            onClick={() => {
              analytics.track(AnalyticsEvent.CHAT_NEW_STARTED, {
                source: "header",
              });
              handleNewChat();
            }}
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
      onReprocess={handleReprocess}
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
                  {/* Rich revision-aware welcome; falls back to EmptyState
                     for brand-new users. */}
                  <WelcomeHome
                    onPick={(t) => send(t, { source: "suggested_prompt" })}
                  />
                  {/* Opt-in: renders nothing until real Study Spaces exist. */}
                  <ContinueLearningRail />
                </div>
              ) : (
                <ChatMessages
                  messages={messages}
                  mediaAvailable={selected.size > 0}
                  quizBusy={streaming}
                  thinkingHint={thinkingHint}
                  onRetryAgent={handleRetryAgent}
                  onSaveNote={async (messageId, content, topic) => {
                    try {
                      const note = await createNote.mutateAsync({
                        title:
                          (topic || content).slice(0, 80).trim() ||
                          "Untitled note",
                        content_md: content,
                        source_type: "response",
                        source_ref: messageId,
                        session_id: activeId ?? undefined,
                      });
                      analytics.track(AnalyticsEvent.CHAT_NOTE_SAVED, {
                        note_id: note.id,
                        chat_session_id: activeId,
                        content_length: content.length,
                      });
                      toast.success("Saved to Notes", {
                        action: {
                          label: "Open",
                          onClick: () => navigate(`/notes/${note.id}`),
                        },
                      });
                      return true;
                    } catch (err) {
                      analytics.track(AnalyticsEvent.CHAT_NOTE_SAVE_FAILED, {
                        error_kind: errorKind(err),
                      });
                      toast.error("Couldn't save the note");
                      return false;
                    }
                  }}
                  onAction={(message, sourceContent) =>
                    send(message, {
                      sourceContent,
                      displayText: message,
                      source: "action",
                    })
                  }
                  onFollowup={(prompt, title) =>
                    send(prompt, { displayText: title, source: "followup" })
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
                initialUseMedia={pendingQuiz.useMedia}
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

            {uploads.some(
              (u) => u.status === "uploading" || u.status === "processing",
            ) && (
              <div className="mx-auto mb-1 flex w-full max-w-4xl px-4">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-background/90 px-3 py-1 text-[11px] text-muted-foreground backdrop-blur">
                  <Loader2 className="h-3 w-3 animate-spin text-brand-1" />
                  Indexing your file… it will be used as soon as it's ready.
                </span>
              </div>
            )}

            {showExamBanner && (
              <div className="mx-auto w-full max-w-4xl px-4 pb-2">
                <ExamPrepCta
                  variant="banner"
                  source="intent"
                  onDismiss={() => setShowExamBanner(false)}
                />
              </div>
            )}

            <ChatComposer
              ref={composerRef}
              onSend={(t, meta) =>
                preview
                  ? previewAct("followup", t)
                  : send(t, { source: "composer", voiceUsed: meta?.voiceUsed })
              }
              onUpload={handleUpload}
              onQuizCommand={openQuizSetup}
              disabled={streaming}
              locked={!!pendingClar}
              uploading={uploads.some((u) => u.status === "uploading")}
              selectedCount={selected.size}
              onOpenFiles={() => setMediaOpen(true)}
              hasMedia={media.length > 0}
              notice={uploadNotice}
              onNoticeDismiss={() => setUploadNotice(null)}
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

      {/* Mounted (and their chunks fetched) only once first opened; kept
         mounted afterwards so close animations and state survive. */}
      {activeQuiz && (
        <Suspense fallback={null}>
          <QuizDrawer
            quiz={activeQuiz}
            open={quizOpen}
            onOpenChange={setQuizOpen}
          />
        </Suspense>
      )}

      {activeFlashcards && (
        <Suspense fallback={null}>
          <FlashcardViewer
            setId={activeFlashcards}
            open={flashcardsOpen}
            onOpenChange={setFlashcardsOpen}
          />
        </Suspense>
      )}

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
