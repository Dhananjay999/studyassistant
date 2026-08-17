import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUp,
  FolderOpen,
  Loader2,
  Mic,
  Paperclip,
  Square,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SlashCommandMenu } from "@/components/chat/SlashCommandMenu";
import { usePreferences } from "@/contexts/PreferencesContext";
import { useFeature } from "@/hooks/useFeature";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  useSpeechRecognition,
  type SpeechErrorCode,
} from "@/hooks/useSpeechRecognition";
import { filterSlashCommands, type SlashCommand } from "@/lib/slashCommands";
import { isModifier } from "@/lib/platform";
import { cn } from "@/lib/utils";

export interface ChatComposerHandle {
  focus: () => void;
  /** Focus the composer and open the slash-command menu. */
  openCommands: () => void;
}

/** Append dictated text to what was already typed, with a single space. */
function joinDictation(base: string, text: string): string {
  if (!text) return base;
  if (!base) return text;
  return /\s$/.test(base) ? base + text : `${base} ${text}`;
}

const VOICE_ERROR_MESSAGES: Record<
  SpeechErrorCode,
  { title: string; description?: string }
> = {
  permission: {
    title: "Microphone access is required for voice input.",
    description:
      "Allow microphone access in your browser settings, then tap the mic again.",
  },
  "no-mic": {
    title: "No microphone found.",
    description: "Connect a microphone and try again.",
  },
  network: {
    title: "Voice input needs an internet connection.",
    description: "Check your connection and try again.",
  },
  unknown: { title: "Voice input didn't work. Please try again." },
};

/** Five-bar waveform; animates while speech is active, settles when quiet. */
function VoiceBars({ active }: { active: boolean }) {
  return (
    <span className="voice-bars" data-active={active} aria-hidden="true">
      <span /><span /><span /><span /><span />
    </span>
  );
}

export const ChatComposer = forwardRef<
  ChatComposerHandle,
  {
    onSend: (text: string) => void;
    onUpload: (files: FileList) => void;
    onQuizCommand?: () => void;
    disabled?: boolean;
    /** Hard lock (e.g. a pending clarification): blocks typing + sending. */
    locked?: boolean;
    /** Placeholder shown while locked. */
    lockedPlaceholder?: string;
    uploading?: boolean;
    /** Number of files currently selected for context (0 = hide indicator). */
    selectedCount?: number;
    /** Open the file selector/sidebar when the indicator is tapped. */
    onOpenFiles?: () => void;
    /** Whether the user already has uploaded media (drives the mobile
     *  choose-existing-vs-upload sheet). */
    hasMedia?: boolean;
  }
>(function ChatComposer(
  {
    onSend,
    onUpload,
    onQuizCommand,
    disabled,
    locked = false,
    lockedPlaceholder = "Answer the question above to continue…",
    uploading,
    selectedCount = 0,
    onOpenFiles,
    hasMedia = false,
  },
  ref,
) {
  const [value, setValue] = useState("");
  const [showMenu, setShowMenu] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [attachOpen, setAttachOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // Composer text at the moment dictation started; the session transcript
  // is appended to this, so typed text is never overwritten.
  const dictationBaseRef = useRef("");
  const isMobile = useIsMobile();
  const voiceEnabled = useFeature("voice_input");
  // Full prompt wraps to two lines on a narrow phone (and the second line gets
  // clipped by the single-row height), so use a short one-line hint on mobile.
  const placeholder = locked
    ? lockedPlaceholder
    : isMobile
      ? "Ask anything…"
      : "Ask anything, type / for commands, or attach notes…";

  const commands = filterSlashCommands(value);
  const menuOpen =
    showMenu && value.startsWith("/") && !value.includes("\n") &&
    commands.length > 0;
  const safeIndex = Math.min(activeIndex, commands.length - 1);

  const grow = () => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const resetHeight = () =>
    requestAnimationFrame(() => {
      if (taRef.current) taRef.current.style.height = "auto";
    });

  const focusEnd = () =>
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
      grow();
    });

  // Voice input. Finalized speech is committed into `value` (editable like
  // typed text); the in-flight interim segment is shown separately, styled
  // as provisional, and never enters the textarea until it finalizes.
  const { voiceLang } = usePreferences();
  const [interim, setInterim] = useState("");
  // Fresh speech was heard recently → "Listening…" + animated bars;
  // quiet for a few seconds → "Still listening…" + settled bars.
  const [speechFresh, setSpeechFresh] = useState(true);
  const freshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceScrollRef = useRef<HTMLDivElement>(null);

  const bumpActivity = () => {
    setSpeechFresh(true);
    if (freshTimerRef.current) clearTimeout(freshTimerRef.current);
    freshTimerRef.current = setTimeout(() => setSpeechFresh(false), 3000);
  };

  const {
    supported: micSupported,
    listening,
    start: startDictation,
    stop: stopDictation,
    cancel: cancelDictation,
  } = useSpeechRecognition({
    lang: voiceLang === "auto" ? undefined : voiceLang,
    onTranscript: (finalText, interimText) => {
      setValue(joinDictation(dictationBaseRef.current, finalText));
      setInterim(interimText);
      if (finalText || interimText) bumpActivity();
      requestAnimationFrame(() => {
        grow();
        // Keep long dictation scrolled to the newest words.
        const el = taRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    },
    onError: (code) => {
      const { title, description } = VOICE_ERROR_MESSAGES[code];
      toast.error(title, description ? { description } : undefined);
    },
    onEnd: ({ transcript, canceled }) => {
      setInterim("");
      if (freshTimerRef.current) clearTimeout(freshTimerRef.current);
      if (canceled) {
        setValue(dictationBaseRef.current);
      } else if (!transcript.trim() && !dictationBaseRef.current.trim()) {
        toast.info("I couldn't hear anything. Try again.");
      }
      focusEnd();
    },
  });

  const startVoice = () => {
    if (locked || listening) return;
    dictationBaseRef.current = value;
    setInterim("");
    bumpActivity();
    startDictation();
  };
  const handleMic = () => (listening ? stopDictation() : startVoice());

  // If an admin turns the flag off mid-dictation the button unmounts, so
  // stop the session too rather than leaving the mic hot.
  useEffect(() => {
    if (!voiceEnabled && listening) stopDictation();
  }, [voiceEnabled, listening, stopDictation]);

  // Keep the mobile transcript panel scrolled to the newest words.
  useEffect(() => {
    const el = voiceScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [value, interim]);

  useEffect(
    () => () => {
      if (freshTimerRef.current) clearTimeout(freshTimerRef.current);
    },
    [],
  );

  useImperativeHandle(ref, () => ({
    focus: () => taRef.current?.focus(),
    openCommands: () => {
      setValue("/");
      setShowMenu(true);
      setActiveIndex(0);
      focusEnd();
    },
  }));

  const openPicker = () => fileRef.current?.click();
  // On mobile, if the user already has uploaded media, offer to reuse it (open
  // the file list) instead of always uploading again. No media, or desktop →
  // straight to the system picker.
  const handleAttach = () => {
    if (isMobile && hasMedia) setAttachOpen(true);
    else openPicker();
  };

  const send = () => {
    const text = value.trim();
    if (!text || disabled || locked) return;
    if (listening) stopDictation();
    onSend(text);
    setValue("");
    setShowMenu(false);
    resetHeight();
  };

  const selectCommand = (command: SlashCommand) => {
    setShowMenu(false);
    if (command.action === "quiz") {
      setValue("");
      onQuizCommand?.();
      return;
    }
    setValue(command.template);
    focusEnd();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Escape" && listening) {
      e.preventDefault();
      cancelDictation();
      return;
    }
    if (menuOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % commands.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + commands.length) % commands.length);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        selectCommand(commands[safeIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setShowMenu(false);
        return;
      }
    }
    // Cmd/Ctrl+Enter always sends, even with the menu closed.
    if (e.key === "Enter" && (isModifier(e) || !e.shiftKey)) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-4">
      <div className="relative">
        {menuOpen && (
          <SlashCommandMenu
            commands={commands}
            activeIndex={safeIndex}
            onSelect={selectCommand}
            onHover={setActiveIndex}
          />
        )}
        <AnimatePresence initial={false}>
          {selectedCount > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.18 }}
              className="mb-2 flex"
            >
              <button
                type="button"
                onClick={onOpenFiles}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1",
                  "border-brand-1/30 bg-brand-1/10 text-xs font-medium text-brand-1",
                  "transition-colors hover:bg-brand-1/20 active:scale-[0.98]",
                )}
                aria-label="View files selected for context"
              >
                <Paperclip className="h-3.5 w-3.5" />
                {selectedCount} file{selectedCount === 1 ? "" : "s"} selected
                for context
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        {/* Desktop listening indicator: the textarea stays visible/editable
            with finalized text; the interim (still-changing) segment previews
            here in muted italics until it firms up. */}
        <AnimatePresence initial={false}>
          {listening && !isMobile && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.18 }}
              className="mb-2 flex"
            >
              <div
                role="status"
                className={cn(
                  "flex min-w-0 items-center gap-2.5 rounded-full border px-3 py-1.5",
                  "border-brand-1/30 bg-brand-1/10 text-xs",
                )}
              >
                <span
                  className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-brand-1"
                  aria-hidden="true"
                />
                <span className="shrink-0 font-medium text-brand-1">
                  {speechFresh ? "Listening…" : "Still listening…"}
                </span>
                <VoiceBars active={speechFresh} />
                {interim && (
                  <span className="max-w-[16rem] truncate italic text-muted-foreground">
                    {interim}
                  </span>
                )}
                <button
                  type="button"
                  onClick={stopDictation}
                  aria-label="Stop recording"
                  className="shrink-0 rounded-full bg-primary px-3 py-0.5 font-medium text-primary-foreground transition-colors hover:bg-primary/90 active:scale-[0.98]"
                >
                  Stop
                </button>
                <button
                  type="button"
                  onClick={cancelDictation}
                  aria-label="Cancel voice input"
                  className="shrink-0 rounded-full px-1.5 py-0.5 text-muted-foreground transition-colors hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) onUpload(e.target.files);
            e.target.value = "";
          }}
        />
        <div className="composer-shell">
          {listening && isMobile ? (
            /* Mobile recording state: the composer itself expands — the
               conversation stays visible above, no separate screen. */
            <motion.div
              key="voice-panel"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
              className={cn(
                "flex flex-col items-center gap-3 bg-card/90 p-4 backdrop-blur-xl",
                "supports-[backdrop-filter]:bg-card/80",
              )}
            >
              <span className="mic-pulse relative grid h-14 w-14 place-items-center rounded-full bg-brand-1/10 text-brand-1">
                <Mic className="h-6 w-6" />
              </span>
              <div
                role="status"
                className="flex items-center gap-2 text-sm font-medium text-brand-1"
              >
                {speechFresh ? "Listening…" : "Still listening…"}
                <VoiceBars active={speechFresh} />
              </div>
              <div
                ref={voiceScrollRef}
                className="max-h-28 w-full overflow-y-auto rounded-xl bg-muted/40 px-3 py-2 text-sm leading-6"
              >
                {value || interim ? (
                  <>
                    {value}
                    {interim && (
                      <span className="italic text-muted-foreground">
                        {value ? " " : ""}
                        {interim}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-muted-foreground">Speak now…</span>
                )}
              </div>
              <div className="flex w-full gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 flex-1 rounded-xl"
                  onClick={cancelDictation}
                  aria-label="Cancel voice input"
                >
                  <X className="h-4 w-4" />
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="h-11 flex-1 rounded-xl"
                  onClick={stopDictation}
                  aria-label="Stop recording"
                >
                  <Square className="h-4 w-4" />
                  Stop
                </Button>
              </div>
            </motion.div>
          ) : (
          <div
            className={cn(
              "flex items-end gap-2 bg-card/90 p-2 backdrop-blur-xl",
              "supports-[backdrop-filter]:bg-card/80",
            )}
          >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 rounded-xl"
            disabled={uploading || locked}
            onClick={handleAttach}
            aria-label="Attach files"
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Paperclip className="h-4 w-4" />
            )}
          </Button>

          <textarea
            ref={taRef}
            rows={1}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setShowMenu(e.target.value.startsWith("/"));
              setActiveIndex(0);
              grow();
            }}
            onKeyDown={onKeyDown}
            disabled={locked}
            placeholder={placeholder}
            className="max-h-40 flex-1 resize-none bg-transparent py-2 text-sm leading-6 outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
          />

          {voiceEnabled && micSupported && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-9 w-9 shrink-0 rounded-xl",
                    listening &&
                      "bg-brand-1/15 text-brand-1 hover:bg-brand-1/20 hover:text-brand-1",
                  )}
                  disabled={locked}
                  onClick={handleMic}
                  aria-label={listening ? "Stop recording" : "Voice input"}
                  aria-pressed={listening}
                >
                  <Mic className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {listening ? "Stop recording" : "Voice input"}
              </TooltipContent>
            </Tooltip>
          )}

          <Button
            type="button"
            size="icon"
            className="h-9 w-9 shrink-0 rounded-xl"
            disabled={disabled || locked || !value.trim()}
            onClick={send}
            aria-label="Send"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
          </div>
          )}
        </div>
      </div>

      {/* Mobile attach chooser: reuse an existing file or upload a new one. */}
      <Drawer open={attachOpen} onOpenChange={setAttachOpen}>
        <DrawerContent>
          <DrawerTitle className="sr-only">Add attachment</DrawerTitle>
          <div className="mx-auto w-full max-w-md space-y-2 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
            <button
              type="button"
              onClick={() => {
                setAttachOpen(false);
                onOpenFiles?.();
              }}
              className="flex w-full items-center gap-3 rounded-2xl border border-border/60 bg-card/50 p-4 text-left transition-colors hover:bg-accent/50 active:scale-[0.99]"
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-1/10 text-brand-1">
                <FolderOpen className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">Choose existing file</span>
                <span className="block text-xs text-muted-foreground">
                  Reuse a document you've already uploaded
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setAttachOpen(false);
                openPicker();
              }}
              className="flex w-full items-center gap-3 rounded-2xl border border-border/60 bg-card/50 p-4 text-left transition-colors hover:bg-accent/50 active:scale-[0.99]"
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-2/10 text-brand-2">
                <Upload className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">Upload new file</span>
                <span className="block text-xs text-muted-foreground">
                  Pick a PDF or image from your device
                </span>
              </span>
            </button>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
});
