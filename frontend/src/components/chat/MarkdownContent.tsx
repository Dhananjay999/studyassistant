import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { ExternalLink, FileText } from "lucide-react";
import "katex/dist/katex.min.css";
import "katex/dist/contrib/mhchem";
import { useDocumentViewer } from "@/contexts/DocumentViewerContext";
import {
  citationUrlTransform,
  parseCiteTarget,
  preprocessCitations,
} from "@/lib/citations";
import type { SourceInfo } from "@/types";

/** Filename/title comparison key: lowercased, extension + surrounding space stripped. */
function citeKey(value?: string): string {
  return (value ?? "").toLowerCase().replace(/\.[a-z0-9]+$/i, "").trim();
}

/** Compact, ChatGPT-style inline citation chip that opens the cited page. */
function CitationChip({
  name,
  page,
  label,
  sources,
}: {
  name: string;
  page?: number;
  label: React.ReactNode;
  sources?: SourceInfo[];
}) {
  const viewer = useDocumentViewer();
  const target = citeKey(name);
  // Only document sources (those with a media id) can be opened. Match the
  // marker name resiliently: the model often drops the extension, re-cases, or
  // truncates the filename, so exact equality alone leaves the chip dead.
  const docSources = sources?.filter((s) => s.media_id) ?? [];
  const match =
    docSources.find(
      (s) =>
        citeKey(s.document_name) === target &&
        (page == null || s.page_number == null || s.page_number === page),
    ) ??
    docSources.find((s) => citeKey(s.document_name) === target) ??
    docSources.find((s) => {
      const key = citeKey(s.document_name);
      return key !== "" && (key.includes(target) || target.includes(key));
    }) ??
    // Last resort: a single attached document is unambiguous — use it.
    (docSources.length === 1 ? docSources[0] : undefined);
  const mediaId = match?.media_id;

  return (
    <button
      type="button"
      disabled={!mediaId}
      onClick={() =>
        mediaId &&
        viewer.openDocumentByMediaId(
          mediaId,
          page ?? match?.page_number ?? undefined,
        )
      }
      title={mediaId ? "Open the cited page" : undefined}
      className="mx-0.5 inline-flex max-w-[16rem] items-center gap-1 rounded-md border border-brand-1/30 bg-brand-1/5 px-1.5 py-px align-baseline text-[0.72em] font-medium leading-tight text-brand-1 no-underline transition-colors hover:bg-brand-1/15 disabled:cursor-default disabled:opacity-70"
    >
      <FileText className="h-3 w-3 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

/**
 * Shared renderers for LLM markdown. Tables get a horizontally-scrollable,
 * bordered wrapper so wide GFM tables never break the message layout or overflow
 * the viewport on mobile — the table scrolls inside its own bordered card.
 */
const MARKDOWN_COMPONENTS: Components = {
  table: ({ children }) => (
    <div className="my-3 w-full overflow-x-auto rounded-xl border border-border/60 [scrollbar-width:thin]">
      <table className="w-full border-collapse text-left text-sm">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
      {children}
    </thead>
  ),
  th: ({ children }) => (
    <th className="whitespace-nowrap border-b border-border/60 px-3 py-2 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-border/40 px-3 py-2 align-top">
      {children}
    </td>
  ),
  tr: ({ children }) => (
    <tr className="transition-colors even:bg-muted/20 hover:bg-muted/30">
      {children}
    </tr>
  ),
};

/**
 * Renders assistant/answer markdown with GitHub-Flavored Markdown (tables,
 * strikethrough, task lists) and responsive table styling. Inline `[cite:…]`
 * markers become clickable citation chips when `sources` is supplied.
 */
export function MarkdownContent({
  content,
  sources,
}: {
  content: string;
  sources?: SourceInfo[];
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      urlTransform={citationUrlTransform}
      components={{
        ...MARKDOWN_COMPONENTS,
        a: ({ href, children }) => {
          const cite = href ? parseCiteTarget(href) : null;
          if (cite) {
            // Outside a document context (no sources) the marker still renders,
            // just as inert text rather than an openable chip.
            if (!sources) return <span>{children}</span>;
            return (
              <CitationChip
                name={cite.name}
                page={cite.page}
                label={children}
                sources={sources}
              />
            );
          }
          // External links (typically inline web-source citations) render as a
          // compact chip so citations read as citations without disrupting flow.
          return (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="mx-0.5 inline-flex max-w-[16rem] items-center gap-1 rounded-md border border-brand-1/30 bg-brand-1/5 px-1.5 py-px align-baseline text-[0.85em] font-medium leading-tight text-brand-1 no-underline transition-colors hover:bg-brand-1/15"
            >
              <span className="truncate">{children}</span>
              <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          );
        },
      }}
    >
      {preprocessCitations(content)}
    </ReactMarkdown>
  );
}
