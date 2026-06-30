import { useState } from "react";
import { motion } from "framer-motion";
import { Copy, ExternalLink, FileText, Globe } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useDocumentViewer } from "@/contexts/DocumentViewerContext";
import { isDocSource, type SourceInfo } from "@/types";

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

/**
 * A document citation rendered as a compact, ChatGPT-style chip: document name
 * + cited page, a tooltip with the section/snippet, and a click that opens the
 * viewer jumped to that page. Many chips scroll horizontally rather than
 * stacking into a long list.
 */
function DocCitationChip({
  source,
  onOpen,
}: {
  source: SourceInfo;
  onOpen: () => void;
}) {
  const name = source.document_name || "Document";
  const page = source.page_number;
  const hasDetail = Boolean(source.section || source.snippet);

  const chip = (
    <motion.button
      type="button"
      onClick={onOpen}
      whileHover={{ y: -1 }}
      whileTap={{ scale: 0.97 }}
      className="group inline-flex max-w-[230px] shrink-0 snap-start items-center gap-1.5 rounded-full border border-border/70 bg-card/60 py-1 pl-1.5 pr-2.5 text-xs transition-colors hover:border-brand-1/50 hover:bg-card"
    >
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-1/10 text-brand-1">
        <FileText className="h-3 w-3" />
      </span>
      <span className="truncate font-medium">{name}</span>
      {page != null && (
        <span className="shrink-0 whitespace-nowrap text-muted-foreground">
          · p.{page}
        </span>
      )}
    </motion.button>
  );

  if (!hasDetail) return chip;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{chip}</TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        {source.section && (
          <p className="text-[11px] font-semibold">{source.section}</p>
        )}
        {source.snippet && (
          <p className="mt-0.5 line-clamp-4 text-[11px] text-muted-foreground">
            {source.snippet}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

export function SourceCards({ sources }: { sources: SourceInfo[] }) {
  const viewer = useDocumentViewer();
  if (!sources.length) return null;
  const docs = sources.filter(isDocSource);
  const webs = sources.filter((s) => !isDocSource(s));
  const allDocs = webs.length === 0;

  return (
    <div className="mt-3 border-t border-border/40 pt-2.5">
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {allDocs ? (
          <FileText className="h-3.5 w-3.5 text-brand-1" />
        ) : (
          <Globe className="h-3.5 w-3.5 text-brand-1" />
        )}
        <span className="text-xs font-medium">
          Sources used for this answer
        </span>
        <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
          {sources.length}
        </Badge>
      </div>

      {/* Document citations: a compact, horizontally scrollable chip row. */}
      {docs.length > 0 && (
        <div className="flex snap-x scroll-smooth gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {docs.map((s, i) => (
            <DocCitationChip
              key={`doc-${i}`}
              source={s}
              onOpen={() => {
                if (s.media_id) {
                  void viewer.openDocumentByMediaId(
                    s.media_id,
                    s.page_number ?? undefined,
                  );
                }
              }}
            />
          ))}
        </div>
      )}

      {/* Web results keep their richer preview cards. */}
      {webs.length > 0 && (
        <div className="mt-2 flex snap-x scroll-smooth gap-2 overflow-x-auto pb-1 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {webs.map((s, i) => (
            <SourceCard key={`web-${i}`} source={s} />
          ))}
        </div>
      )}
    </div>
  );
}
