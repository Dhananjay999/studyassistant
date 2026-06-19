import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { Send, Paperclip, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  onSend: (message: string) => void;
  onUpload: (files: FileList) => void;
  disabled?: boolean;
  isUploading?: boolean;
}

export function ChatInput({
  onSend,
  onUpload,
  disabled,
  isUploading,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-border/50 bg-background/80 px-4 py-3 backdrop-blur-sm pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) onUpload(e.target.files);
            e.target.value = "";
          }}
        />
        <Button
          size="icon"
          variant="ghost"
          className="shrink-0 rounded-xl"
          onClick={() => fileRef.current?.click()}
          disabled={disabled || isUploading}
        >
          {isUploading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Paperclip className="h-5 w-5" />
          )}
        </Button>

        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything — attach notes to ask from them..."
          disabled={disabled}
          rows={1}
          className={cn(
            "min-h-[44px] max-h-32 resize-none rounded-2xl border-border/50 bg-muted/50 px-4 py-3 text-base",
          )}
        />

        <motion.div whileTap={{ scale: 0.9 }}>
          <Button
            size="icon"
            className="h-11 w-11 shrink-0 rounded-xl bg-gradient-to-r from-violet-600 to-sky-600"
            onClick={handleSend}
            disabled={disabled || !value.trim()}
          >
            <Send className="h-5 w-5" />
          </Button>
        </motion.div>
      </div>
    </div>
  );
}

export default ChatInput;
