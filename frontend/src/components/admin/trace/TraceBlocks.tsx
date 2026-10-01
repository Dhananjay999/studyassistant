// Building blocks of the trace explorer's detail views: copyable text and
// JSON sections sized for long prompts, fact lists, notices and badges.
//
// Payloads are debugging data, so text is shown verbatim (preformatted and
// wrapped) rather than through the chat markdown renderer.

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Check,
  ChevronRight,
  CircleAlert,
  Copy,
  Info,
  Maximize2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveModal,
  ResponsiveModalBody,
  ResponsiveModalContent,
  ResponsiveModalHeader,
  ResponsiveModalTitle,
} from "@/components/ui/responsive-modal";
import { cn } from "@/lib/utils";
import {
  spanStatusMeta,
  traceStatusNote,
  traceStatusTone,
  VISIBLE_SCROLLBAR,
} from "./traceKinds";
import {
  cappedPreview,
  charLength,
  isEmptyValue,
  prettyJson,
} from "./traceModel";

// Above this a section starts folded to a short preview: one click opens it.
const LARGE_CHARS = 2000;
const PREVIEW_CHARS = 600;

export function CopyButton({
  text,
  label = "Copy",
  caption,
  className,
}: {
  /** The text, or a function building it on demand (large JSON). */
  text: string | (() => string);
  /** Accessible name and tooltip. */
  label?: string;
  /** Visible text beside the icon; icon-only when omitted. */
  caption?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>();

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        typeof text === "function" ? text() : text,
      );
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy");
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label}
      title={label}
      data-analytics-name="Copy trace value"
      className={cn(
        "inline-flex h-9 min-w-9 shrink-0 items-center justify-center gap-1 rounded-md px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:bg-accent sm:h-7 sm:min-w-7 sm:px-1.5",
        className,
      )}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
      {caption && (copied ? "Copied" : caption)}
    </button>
  );
}

/** Inline action that reads as a link (navigation stays inside the app). */
export function LinkButton({
  onClick,
  children,
  analyticsName,
}: {
  onClick: () => void;
  children: ReactNode;
  analyticsName: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-analytics-name={analyticsName}
      className="inline-flex items-center gap-1 text-left font-medium text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
    >
      {children}
    </button>
  );
}

export function SectionHeading({
  children,
  aside,
}: {
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b pb-1">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {children}
      </h3>
      {aside && (
        <span className="text-[11px] text-muted-foreground">{aside}</span>
      )}
    </div>
  );
}

const NOTICE_TONE = {
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  error: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300",
  info: "border-border bg-muted/40 text-muted-foreground",
};

export function Notice({
  tone = "warn",
  children,
}: {
  tone?: keyof typeof NOTICE_TONE;
  children: ReactNode;
}) {
  const Icon =
    tone === "error" ? CircleAlert : tone === "warn" ? TriangleAlert : Info;
  return (
    <div
      role={tone === "info" ? undefined : "status"}
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed",
        NOTICE_TONE[tone],
      )}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Badge for a step that did not end "ok"; renders nothing when it did. */
export function SpanStatusBadge({ status }: { status: string }) {
  const meta = spanStatusMeta(status);
  if (!meta) return null;
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        meta.badge,
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {meta.label}
    </span>
  );
}

/** Badge for a whole trace's status; hovering says what the status means. */
export function TraceStatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="secondary"
      title={traceStatusNote(status) ?? undefined}
      className={cn("shrink-0", traceStatusTone(status))}
    >
      {status}
    </Badge>
  );
}

/** Label → value list; rows with nothing to show are left out. */
export function Facts({
  items,
}: {
  items: Array<[string, ReactNode] | null | false | undefined>;
}) {
  const shown = items.filter(
    (item): item is [string, ReactNode] =>
      Array.isArray(item) &&
      item[1] !== null &&
      item[1] !== undefined &&
      item[1] !== "" &&
      item[1] !== false,
  );
  if (shown.length === 0) return null;
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1.5 text-xs">
      {shown.map(([label, value]) => (
        <Fragment key={label}>
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words font-medium [overflow-wrap:anywhere]">
            {value}
          </dd>
        </Fragment>
      ))}
    </dl>
  );
}

/** A value shown in monospace with a copy button (ids, hashes). */
export function CopyableValue({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-0.5 align-middle">
      <span className="min-w-0 break-all font-mono text-[11px]">{value}</span>
      <CopyButton text={value} label={`Copy ${label}`} />
    </span>
  );
}

function countLines(text: string): number {
  let lines = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) lines += 1;
  }
  return lines;
}

/**
 * Bounded, visibly scrollable text. Scrollbars are hidden app-wide, so the
 * pane re-enables its own and says so while more text is below the fold.
 */
function ScrollText({ text }: { text: string }) {
  const ref = useRef<HTMLPreElement>(null);
  const [more, setMore] = useState(false);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 8);
  }, []);

  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, text]);

  return (
    <div className="relative">
      <pre
        ref={ref}
        onScroll={measure}
        tabIndex={0}
        style={VISIBLE_SCROLLBAR}
        className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words px-3 py-2.5 font-mono text-xs leading-relaxed text-foreground [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {text}
      </pre>
      {more && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 flex h-12 items-end justify-center rounded-b-lg bg-gradient-to-t from-background via-background/80 to-transparent pb-1.5"
        >
          <span className="rounded-full border bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm">
            Scroll for more
          </span>
        </div>
      )}
    </div>
  );
}

/** Full-width reading view of one section, for long prompts. */
function ReaderDialog({
  label,
  text,
  onClose,
}: {
  label: string;
  text: string;
  onClose: () => void;
}) {
  return (
    <ResponsiveModal
      open
      onOpenChange={(open) => !open && onClose()}
      analyticsName="Admin trace reader"
    >
      <ResponsiveModalContent className="max-h-[90vh] sm:max-w-5xl">
        <ResponsiveModalHeader>
          <div className="flex items-center justify-between gap-3 sm:pr-6">
            <ResponsiveModalTitle className="min-w-0 truncate text-left text-base">
              {label}
            </ResponsiveModalTitle>
            <div className="flex shrink-0 items-center gap-2">
              <span className="font-mono text-[11px] text-muted-foreground">
                {charLength(text).toLocaleString()} chars
              </span>
              <CopyButton text={text} label={`Copy ${label}`} caption="Copy" />
            </div>
          </div>
        </ResponsiveModalHeader>
        <ResponsiveModalBody
          style={VISIBLE_SCROLLBAR}
          className="rounded-lg border bg-muted/20"
          data-analytics-private
        >
          <pre className="whitespace-pre-wrap break-words p-4 font-mono text-[13px] leading-relaxed [overflow-wrap:anywhere]">
            {text}
          </pre>
        </ResponsiveModalBody>
      </ResponsiveModalContent>
    </ResponsiveModal>
  );
}

/**
 * One titled, copyable piece of text: a system prompt, a history turn, a
 * model reply, a JSON payload. Small text is shown in full; large text
 * starts as a short preview and opens into a bounded scrolling pane, with a
 * full-width reader one click away.
 */
export function TextBlock({
  label,
  text,
  note,
  defaultOpen,
}: {
  label: string;
  text: string;
  /** Shown after the size, e.g. a role or "preview". */
  note?: ReactNode;
  defaultOpen?: boolean;
}) {
  const large = text.length > LARGE_CHARS;
  const [open, setOpen] = useState(defaultOpen ?? !large);
  const [reader, setReader] = useState(false);
  const lines = useMemo(() => countLines(text), [text]);
  const chars = useMemo(() => charLength(text), [text]);
  const empty = text.length === 0;

  return (
    <section className="overflow-hidden rounded-lg border bg-background">
      <div className="flex items-center gap-0.5 bg-muted/40 pl-1 pr-1">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          data-analytics-name="Toggle trace section"
          className="flex min-h-9 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left"
        >
          <ChevronRight
            aria-hidden
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
          />
          {/* Wraps instead of cutting: in a narrow pane the size and the
              note ("exactly as sent") move under the label. */}
          <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-1.5">
            <span className="max-w-full truncate text-xs font-semibold">
              {label}
            </span>
            <span className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
              {empty
                ? "empty"
                : `${chars.toLocaleString()} chars${
                    lines > 1 ? ` · ${lines.toLocaleString()} lines` : ""
                  }`}
            </span>
            {note && (
              <span className="text-[11px] text-muted-foreground">{note}</span>
            )}
          </span>
        </button>
        {!empty && (
          <>
            <CopyButton text={text} label={`Copy ${label}`} />
            <button
              type="button"
              onClick={() => setReader(true)}
              aria-label={`Open ${label} in the reader`}
              title="Open in reader"
              data-analytics-name="Open trace reader"
              className="inline-flex h-9 min-w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:bg-accent sm:h-7 sm:min-w-7"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>

      {empty ? (
        open && (
          <p className="border-t px-3 py-2 text-xs italic text-muted-foreground">
            (empty)
          </p>
        )
      ) : open ? (
        <div className="border-t">
          <ScrollText text={text} />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          data-analytics-name="Toggle trace section"
          className="relative block w-full border-t text-left"
        >
          <pre className="max-h-[4.25rem] overflow-hidden whitespace-pre-wrap break-words px-3 py-2 font-mono text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
            {text.slice(0, PREVIEW_CHARS)}
          </pre>
          <span className="absolute inset-x-0 bottom-0 flex h-9 items-end justify-end bg-gradient-to-t from-background via-background/85 to-transparent px-3 pb-1 text-[11px] font-medium text-primary">
            Show all {chars.toLocaleString()} chars
          </span>
        </button>
      )}

      {reader && (
        <ReaderDialog
          label={label}
          text={text}
          onClose={() => setReader(false)}
        />
      )}
    </section>
  );
}

/** Structured value as pretty JSON, with the same controls as text. */
export function JsonBlock({
  label,
  value,
  defaultOpen,
}: {
  label: string;
  value: unknown;
  defaultOpen?: boolean;
}) {
  const text = useMemo(() => prettyJson(value), [value]);
  return (
    <TextBlock
      label={label}
      text={text}
      note="JSON"
      defaultOpen={defaultOpen}
    />
  );
}

/**
 * Whatever a span stored under a key: text stays text, structures become
 * JSON, and a field the recorder capped is shown as the preview it kept.
 * Renders nothing for an empty value.
 */
export function Payload({
  label,
  value,
  defaultOpen,
}: {
  label: string;
  value: unknown;
  defaultOpen?: boolean;
}) {
  if (isEmptyValue(value)) return null;
  const capped = cappedPreview(value);
  if (capped) {
    return (
      <div className="space-y-2">
        <Notice>
          This payload was {capped.chars.toLocaleString()} characters, too large
          to store in full. Only the first{" "}
          {capped.preview.length.toLocaleString()} characters of its JSON were
          kept.
        </Notice>
        <TextBlock
          label={label}
          text={capped.preview}
          note="truncated preview"
          defaultOpen={defaultOpen}
        />
      </div>
    );
  }
  if (typeof value === "string") {
    return <TextBlock label={label} text={value} defaultOpen={defaultOpen} />;
  }
  return <JsonBlock label={label} value={value} defaultOpen={defaultOpen} />;
}
