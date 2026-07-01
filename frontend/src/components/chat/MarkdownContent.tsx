import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { FileText } from "lucide-react";
import { useDocumentViewer } from "@/contexts/DocumentViewerContext";
import {
  citationUrlTransform,
  parseCiteTarget,
  preprocessCitations,
} from "@/lib/citations";
import type { SourceInfo } from "@/types";

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
  const lname = name.toLowerCase();
  const match =
    sources?.find(
      (s) =>
        s.document_name?.toLowerCase() === lname &&
        (page == null || s.page_number == null || s.page_number === page),
    ) ?? sources?.find((s) => s.document_name?.toLowerCase() === lname);
  const mediaId = match?.media_id;

  return (
    <button
      type="button"
      disabled={!mediaId}
      onClick={() =>
        mediaId && viewer.openDocumentByMediaId(mediaId, page ?? undefined)
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
      remarkPlugins={[remarkGfm]}
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
          return (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          );
        },
      }}
    >
      {preprocessCitations(content)}
    </ReactMarkdown>
  );
}
