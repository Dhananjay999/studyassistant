import { Info } from "lucide-react";

/**
 * One-line reminder that Aeva's memory is per-chat: a new chat starts fresh.
 * Shown on the empty-chat screens so students aren't surprised when a
 * preference or introduction from an earlier chat isn't remembered. Lasting
 * preferences (language, style, level) belong in Settings → Learning Profile.
 */
export function MemoryHint() {
  return (
    <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground/80">
      <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        Aeva remembers only this chat — new chats start fresh. Your language
        preference is saved to your profile; set other lasting preferences in{" "}
        <span className="font-medium">Settings → Learning Profile</span>.
      </span>
    </p>
  );
}
