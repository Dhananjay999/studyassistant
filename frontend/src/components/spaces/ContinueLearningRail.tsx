// "Continue Learning" rail on the empty chat screen: the user's most recent
// Study Spaces, one tap from picking up where they left off. Strictly opt-in
// UI — renders nothing until the user has created at least one real space,
// so non-adopters keep the exact pre-spaces home screen.

import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useSpaces } from "@/hooks/api";
import { realSpaces, spaceColor, spaceIcon } from "@/lib/spaces";
import { cn } from "@/lib/utils";

function lastStudied(iso: string | null): string {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

export function ContinueLearningRail() {
  const navigate = useNavigate();
  const { data } = useSpaces();
  const spaces = realSpaces(data).slice(0, 4);
  if (spaces.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="mx-auto w-full max-w-2xl px-4"
    >
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Continue learning
      </p>
      <div className="flex snap-x gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {spaces.map((space) => {
          const color = spaceColor(space.color);
          const Icon = spaceIcon(space.icon);
          return (
            <button
              key={space.id}
              type="button"
              onClick={() => navigate(`/spaces/${space.id}`)}
              className="group flex shrink-0 snap-start items-center gap-2.5 rounded-xl border border-border/60 bg-card/50 py-2 pl-2.5 pr-3 transition-colors hover:border-brand-1/40 hover:bg-card"
            >
              <span
                className={cn(
                  "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
                  color.tint,
                  color.text,
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="text-left">
                <span className="block max-w-[140px] truncate text-sm font-medium leading-tight">
                  {space.name}
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  Studied {lastStudied(space.last_activity_at)}
                </span>
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}
