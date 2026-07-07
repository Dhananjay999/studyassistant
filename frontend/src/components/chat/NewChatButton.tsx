import { motion } from "framer-motion";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Premium "New Chat" action: a brand-gradient pill with a glow, a sheen sweep
 * on hover, a "+" that rotates on hover, and a spring press/scale on tap — so it
 * reads as the primary action without shouting. Used in the mobile chat header.
 */
export function NewChatButton({
  onClick,
  className,
}: {
  onClick: () => void;
  className?: string;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.9 }}
      whileHover={{ scale: 1.04 }}
      transition={{ type: "spring", stiffness: 400, damping: 20 }}
      aria-label="New chat"
      className={cn(
        "group relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden",
        "rounded-xl bg-brand-gradient text-white shadow-glow",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-1/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
    >
      {/* Sheen sweep on hover. */}
      <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full" />
      <motion.span
        className="relative"
        whileHover={{ rotate: 90 }}
        transition={{ type: "spring", stiffness: 300, damping: 18 }}
      >
        <Plus className="h-[18px] w-[18px]" strokeWidth={2.6} />
      </motion.span>
    </motion.button>
  );
}
