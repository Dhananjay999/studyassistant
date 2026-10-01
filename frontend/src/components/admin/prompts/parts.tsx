// Small building blocks shared by the Prompt Map panels: a scroll pane that
// shows it can scroll (scrollbars are hidden app-wide), a copy button, the
// placeholder-aware text view, and the common chips.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Check,
  ChevronsDown,
  Copy,
  Maximize2,
  Minimize2,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  PLACEHOLDER_INFO,
  PLACEHOLDER_KINDS,
  segmentText,
  type PlaceholderKind,
} from "./promptMapModel";

// index.css hides every scrollbar. Inside these panes a thin one is put
// back (standard properties for Firefox / current Chromium and Safari, the
// pseudo-elements for older WebKit) so long prompt text is visibly
// scrollable.
const VISIBLE_SCROLLBAR =
  "[scrollbar-width:thin] [scrollbar-color:hsl(var(--muted-foreground)/0.5)_transparent] " +
  "[&::-webkit-scrollbar]:block [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar]:w-2 " +
  "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-muted-foreground/40";

/**
 * A height-capped vertical scroll region. Overlay scrollbars (macOS, touch)
 * are invisible until used, so it also fades the edge that hides content and
 * shows a "More below" button that pages down.
 */
export function ScrollPane({
  children,
  className,
  capped = true,
  label,
}: {
  children: ReactNode;
  /** Must set the cap, e.g. `max-h-96`. */
  className?: string;
  /** False lets the content take its full height (no inner scrolling). */
  capped?: boolean;
  /** Accessible name of the region. */
  label: string;
}) {
  const paneRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ above: false, below: false });

  const measure = useCallback(() => {
    const el = paneRef.current;
    if (!el) return;
    const above = el.scrollTop > 2;
    const below = el.scrollTop + el.clientHeight < el.scrollHeight - 2;
    setEdges((prev) =>
      prev.above === above && prev.below === below ? prev : { above, below },
    );
  }, []);

  useEffect(() => {
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    if (paneRef.current) observer.observe(paneRef.current);
    if (contentRef.current) observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, [measure, capped]);

  const pageDown = () => {
    const el = paneRef.current;
    if (!el) return;
    el.scrollBy({ top: Math.max(80, el.clientHeight * 0.8), behavior: "smooth" });
  };

  return (
    <div className="relative">
      <div
        ref={paneRef}
        onScroll={measure}
        role="region"
        aria-label={label}
        // Focusable so the keyboard can scroll it.
        tabIndex={capped ? 0 : undefined}
        className={cn(
          "rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring",
          capped && "overflow-y-auto overscroll-contain",
          capped && VISIBLE_SCROLLBAR,
          capped && className,
        )}
      >
        <div ref={contentRef}>{children}</div>
      </div>
      {capped && edges.above && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-6 rounded-t-lg bg-gradient-to-b from-background/90 to-transparent"
        />
      )}
      {capped && edges.below && (
        <>
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-10 rounded-b-lg bg-gradient-to-t from-background to-transparent"
          />
          <button
            type="button"
            onClick={pageDown}
            data-analytics-name="Scroll prompt text"
            className="absolute bottom-1.5 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground shadow-sm hover:text-foreground"
          >
            <ChevronsDown className="h-3 w-3" aria-hidden />
            More below
          </button>
        </>
      )}
    </div>
  );
}

export function CopyButton({
  text,
  what,
  className,
}: {
  text: string;
  /** Names the thing copied in the toast, e.g. "System prompt". */
  what: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(`${what} copied`);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy");
    }
  };
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={cn("h-9 gap-1.5 text-xs sm:h-7", className)}
      disabled={!text}
      data-analytics-name={`Copy ${what.toLowerCase()}`}
      onClick={copy}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      Copy
    </Button>
  );
}

// Each kind differs by more than colour (border style / underline / italic),
// so the legend still reads in greyscale.
const TOKEN_TONE: Record<PlaceholderKind, string> = {
  required:
    "border border-sky-500/40 bg-sky-500/15 text-sky-700 dark:text-sky-300",
  optional:
    "border border-dashed border-amber-500/60 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  block:
    "border border-primary/50 bg-primary/15 font-semibold text-primary underline decoration-primary/50 underline-offset-2",
  marker:
    "border border-dotted border-muted-foreground/60 bg-muted italic text-muted-foreground",
  other: "border border-border bg-muted/60 text-foreground",
};

const TOKEN_BASE = "rounded px-1 py-px font-mono";

/** Key explaining the placeholder token styles. */
export function PlaceholderLegend({ className }: { className?: string }) {
  return (
    <ul
      className={cn(
        "flex flex-wrap gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground",
        className,
      )}
    >
      {PLACEHOLDER_KINDS.map((kind) => (
        <li
          key={kind}
          className="inline-flex items-center gap-1.5"
          title={PLACEHOLDER_INFO[kind].hint}
        >
          <span className={cn(TOKEN_BASE, "text-[10px]", TOKEN_TONE[kind])}>
            {"{…}"}
          </span>
          {PLACEHOLDER_INFO[kind].label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Template text, preformatted and wrapped, with every `{PLACEHOLDER}` styled
 * by how it is resolved. Shared-block tokens are buttons when `onOpenBlock`
 * can open that block.
 */
export function PromptText({
  text,
  kinds,
  onOpenBlock,
  className,
}: {
  text: string;
  kinds: Map<string, PlaceholderKind>;
  /** Returns a handler when the named placeholder opens a shared block. */
  onOpenBlock?: (placeholder: string) => (() => void) | null;
  className?: string;
}) {
  const segments = useMemo(() => segmentText(text, kinds), [text, kinds]);
  return (
    <pre
      className={cn(
        "whitespace-pre-wrap break-words bg-muted/40 p-3 font-mono text-xs leading-relaxed [overflow-wrap:anywhere]",
        className,
      )}
    >
      {segments.map((segment, i) => {
        const token = segment.placeholder;
        if (!token) return <span key={i}>{segment.text}</span>;
        const open = token.kind === "block" ? onOpenBlock?.(token.name) : null;
        const title = `${PLACEHOLDER_INFO[token.kind].label}. ${PLACEHOLDER_INFO[token.kind].hint}`;
        return open ? (
          <button
            key={i}
            type="button"
            onClick={open}
            title={`${title} Click to open the block.`}
            data-analytics-name="Open shared block"
            className={cn(TOKEN_BASE, TOKEN_TONE[token.kind], "cursor-pointer hover:bg-primary/25")}
          >
            {segment.text}
          </button>
        ) : (
          <span
            key={i}
            title={title}
            className={cn(TOKEN_BASE, TOKEN_TONE[token.kind])}
          >
            {segment.text}
          </span>
        );
      })}
    </pre>
  );
}

/**
 * One channel (or block) of prompt text: title, size, copy, and the text in
 * a capped scroll pane that can be expanded to full height.
 */
export function TextPanel({
  title,
  note,
  text,
  what,
  kinds,
  onOpenBlock,
  emptyText,
}: {
  title: ReactNode;
  /** Secondary line under the title. */
  note?: ReactNode;
  text: string;
  /** Names the text for the copy toast and the region label. */
  what: string;
  kinds: Map<string, PlaceholderKind>;
  onOpenBlock?: (placeholder: string) => (() => void) | null;
  emptyText: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const lines = text ? text.split("\n").length : 0;
  return (
    <div className="rounded-lg border bg-background">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2">
        <div className="min-w-0 flex-1 basis-44">
          <p className="break-words text-sm font-medium [overflow-wrap:anywhere]">
            {title}
          </p>
          {note && <p className="text-[11px] text-muted-foreground">{note}</p>}
        </div>
        <span className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
          {text.length.toLocaleString()} chars · {lines.toLocaleString()}{" "}
          {lines === 1 ? "line" : "lines"}
        </span>
        <div className="flex items-center gap-1.5">
          {text && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-9 gap-1.5 text-xs text-muted-foreground sm:h-7"
              aria-pressed={expanded}
              data-analytics-name="Toggle prompt text height"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? (
                <Minimize2 className="h-3 w-3" />
              ) : (
                <Maximize2 className="h-3 w-3" />
              )}
              {expanded ? "Collapse" : "Expand"}
            </Button>
          )}
          <CopyButton text={text} what={what} />
        </div>
      </div>
      {text ? (
        <ScrollPane
          label={what}
          capped={!expanded}
          className="max-h-[26rem]"
        >
          <PromptText
            text={text}
            kinds={kinds}
            onOpenBlock={onOpenBlock}
            className="rounded-b-lg"
          />
        </ScrollPane>
      ) : (
        <p className="px-3 py-4 text-sm text-muted-foreground">{emptyText}</p>
      )}
    </div>
  );
}

/** Live / unused marker for a template. */
export function LiveBadge({ live, className }: { live: boolean; className?: string }) {
  return live ? (
    <Badge
      variant="secondary"
      className={cn(
        "bg-emerald-500/15 text-[10px] text-emerald-600 dark:text-emerald-400",
        className,
      )}
    >
      Live
    </Badge>
  ) : (
    <Badge
      variant="secondary"
      title="No code path renders this template."
      className={cn(
        "bg-amber-500/15 text-[10px] text-amber-600 dark:text-amber-400",
        className,
      )}
    >
      Unused
    </Badge>
  );
}

/** Version hash, monospace. */
export function HashChip({ hash, className }: { hash: string; className?: string }) {
  return (
    <span
      title={`Version (content hash) ${hash}`}
      className={cn(
        "rounded border border-border/70 bg-muted/40 px-1.5 py-px font-mono text-[11px] text-muted-foreground",
        className,
      )}
    >
      {hash || "—"}
    </span>
  );
}

/** Titled group inside a detail panel. */
export function DetailSection({
  title,
  icon: Icon,
  aside,
  children,
}: {
  title: string;
  icon: LucideIcon;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <h3 className="text-sm font-semibold">{title}</h3>
        {aside && <div className="ml-auto">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/** Label over value, as in the other admin inspectors. */
export function Fact({
  label,
  children,
  mono = false,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <div
        className={cn(
          "break-words text-sm font-medium [overflow-wrap:anywhere]",
          mono && "font-mono text-xs",
        )}
      >
        {children}
      </div>
    </div>
  );
}
