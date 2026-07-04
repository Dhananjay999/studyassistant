import { useState } from "react";
import { Check, Copy, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ChatError } from "@/types";

/**
 * An in-thread, assistant-styled error card. When a turn fails we keep the
 * message in the conversation (rather than dropping it to a transient toast)
 * and show calm, student-facing copy with a way to try again — so a hiccup
 * reads like Aeva having a moment, not a broken app.
 */
export function ChatErrorCard({
  error,
  onRetry,
}: {
  error: ChatError;
  onRetry: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(error.prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — nothing actionable to surface */
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-sm leading-relaxed text-foreground">{error.message}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="default"
          className="h-8 gap-1.5"
          onClick={() => onRetry(error)}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Retry
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5"
          onClick={copyPrompt}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {copied ? "Copied" : "Copy prompt"}
        </Button>
      </div>
    </div>
  );
}
