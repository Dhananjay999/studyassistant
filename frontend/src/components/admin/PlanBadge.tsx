// Plan tier chip for admin user rows and the user detail header.
// "Pro" is filled so it stands out in a list; "Free" is a quiet outline so
// the common case does not shout. A missing plan (older backend) reads as
// free, matching `lib/plan.ts` on the user side.

import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Plan } from "@/types";

export function PlanBadge({ plan }: { plan: Plan | undefined }) {
  if (plan === "pro") {
    return (
      <Badge className="gap-1 whitespace-nowrap">
        <Sparkles aria-hidden className="h-3 w-3" />
        Pro
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="whitespace-nowrap text-muted-foreground">
      Free
    </Badge>
  );
}
