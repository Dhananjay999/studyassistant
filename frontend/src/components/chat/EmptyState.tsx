import { motion } from "framer-motion";
import { Globe, FileText, ListChecks } from "lucide-react";
import { BrandLogo } from "@/components/common/BrandLogo";

const PROMPTS = [
  { icon: Globe, text: "Explain how a B-tree index works" },
  { icon: ListChecks, text: "Make a 5-question quiz on photosynthesis" },
  { icon: FileText, text: "Summarize the key points from my notes" },
];

export function EmptyState({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-6 px-4 text-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
      >
        <BrandLogo withWordmark={false} className="scale-150" />
      </motion.div>
      <div>
        <h2 className="font-display text-2xl font-bold">Ask Aeva anything</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Ask a question, attach your notes, or generate a quiz.
        </p>
      </div>
      <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
        {PROMPTS.map((p, i) => (
          <motion.button
            key={p.text}
            type="button"
            onClick={() => onPick(p.text)}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.06 }}
            className="glass flex items-center gap-2 rounded-xl px-4 py-2.5 text-left text-sm transition-transform hover:-translate-y-0.5"
          >
            <p.icon className="h-4 w-4 shrink-0 text-brand-1" />
            {p.text}
          </motion.button>
        ))}
      </div>
    </div>
  );
}
