import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export function BrandLogo({
  className,
  withWordmark = true,
}: {
  className?: string;
  withWordmark?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="relative grid h-9 w-9 place-items-center rounded-xl bg-brand-gradient shadow-glow">
        <Sparkles className="h-5 w-5 text-white" />
      </span>
      {withWordmark && (
        <span className="font-display text-lg font-bold tracking-tight">
          StudyAssistant
        </span>
      )}
    </span>
  );
}
