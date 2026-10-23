// "✨ Pro · Early Access" status for the profile / account surfaces. Renders
// nothing while the user is on the free plan, so those screens are unchanged
// until Pro is activated.

import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { planLabel } from "@/lib/plan";
import { cn } from "@/lib/utils";

export function ProStatusChip({ className }: { className?: string }) {
  const { user } = useAuth();
  const label = planLabel(user);
  if (!label) return null;
  return (
    <Badge
      variant="secondary"
      className={cn(
        "gap-1 border-brand-1/30 bg-brand-1/10 text-foreground",
        className,
      )}
    >
      <Sparkles className="h-3.5 w-3.5 text-brand-1" aria-hidden />
      {label}
    </Badge>
  );
}
