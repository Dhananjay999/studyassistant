import { Sparkles } from "lucide-react";

/** Gemini-style "thinking" state: a status pill + shimmering skeleton lines. */
export function ThinkingIndicator({ hint }: { hint?: "quiz" }) {
  const label = hint === "quiz" ? "Creating your quiz…" : "Aeva is thinking…";
  return (
    <div className="space-y-3">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-1/10 px-2.5 py-1 text-xs font-medium text-brand-1">
        <Sparkles className="h-3 w-3 animate-pulse" />
        {label}
      </span>
      <div className="space-y-2">
        {[92, 78, 64].map((w) => (
          <div
            key={w}
            style={{ width: `${w}%` }}
            className="motion-loop h-3 animate-shimmer rounded-full bg-gradient-to-r from-muted via-muted/30 to-muted bg-[length:200%_100%]"
          />
        ))}
      </div>
    </div>
  );
}
