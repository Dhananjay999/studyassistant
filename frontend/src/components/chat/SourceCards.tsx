import { useState } from "react";
import { motion } from "framer-motion";
import { Copy, ExternalLink, Globe } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import type { SourceInfo } from "@/types";

function domainOf(url?: string): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function SourceCard({ source }: { source: SourceInfo }) {
  const domain = domainOf(source.url);
  const [iconOk, setIconOk] = useState(true);
  const favicon = domain
    ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64`
    : "";

  const copy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(source.url ?? "");
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy link");
    }
  };

  return (
    <motion.a
      href={source.url}
      target="_blank"
      rel="noopener noreferrer"
      whileHover={{ y: -2 }}
      className="group flex w-[220px] shrink-0 snap-start flex-col gap-1.5 rounded-xl border border-border/60 bg-card/50 p-2.5 transition-colors hover:border-brand-1/40 hover:bg-card"
    >
      <div className="flex items-center gap-1.5">
        {favicon && iconOk ? (
          <img
            src={favicon}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setIconOk(false)}
            className="h-4 w-4 shrink-0 rounded"
          />
        ) : (
          <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate text-[11px] font-medium text-muted-foreground">
          {domain || "source"}
        </span>
        <button
          type="button"
          onClick={copy}
          aria-label="Copy link"
          className="ml-auto text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
        >
          <Copy className="h-3 w-3" />
        </button>
        <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
      </div>
      <p className="line-clamp-2 text-xs font-medium leading-snug">
        {source.title || domain}
      </p>
    </motion.a>
  );
}

export function SourceCards({ sources }: { sources: SourceInfo[] }) {
  if (!sources.length) return null;
  return (
    <div className="mt-3 border-t border-border/40 pt-2.5">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <Globe className="h-3.5 w-3.5 text-brand-1" />
        <span className="text-xs font-medium">
          Sources used for this answer
        </span>
        <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
          {sources.length}
        </Badge>
        <Badge className="h-5 gap-1 bg-brand-gradient px-1.5 text-[10px] text-white">
          Web search
        </Badge>
      </div>
      <div className="flex snap-x scroll-smooth gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {sources.map((s, i) => (
          <SourceCard key={i} source={s} />
        ))}
      </div>
    </div>
  );
}
