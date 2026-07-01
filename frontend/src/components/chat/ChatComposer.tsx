import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Loader2, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SlashCommandMenu } from "@/components/chat/SlashCommandMenu";
import { useIsMobile } from "@/hooks/use-mobile";
import { filterSlashCommands, type SlashCommand } from "@/lib/slashCommands";
import { isModifier } from "@/lib/platform";
import { cn } from "@/lib/utils";

export interface ChatComposerHandle {
  focus: () => void;
  /** Focus the composer and open the slash-command menu. */
  openCommands: () => void;
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
  },
  ref,
) {
  const [value, setValue] = useState("");
  const [showMenu, setShowMenu] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const isMobile = useIsMobile();
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

  useImperativeHandle(ref, () => ({
    focus: () => taRef.current?.focus(),
    openCommands: () => {
      setValue("/");
      setShowMenu(true);
      setActiveIndex(0);
      focusEnd();
    },
  }));

  const send = () => {
    const text = value.trim();
    if (!text || disabled || locked) return;
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
        <div
          className={cn(
            "glass-strong flex items-end gap-2 rounded-2xl p-2 shadow-glow",
            "focus-within:ring-2 focus-within:ring-ring/40",
          )}
        >
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
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 rounded-xl"
            disabled={uploading || locked}
            onClick={() => fileRef.current?.click()}
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
      </div>
    </div>
  );
});
