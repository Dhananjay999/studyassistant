// How one prompt was assembled: the ordered parts of each channel (shared
// blocks, runtime values, optional parts left out, the template's own text)
// and, for the part built from the user's details, which detail produced
// which line. A prompt is more than the text the template file shows: parts
// are added or dropped per user and per turn, and this is where that shows.

import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { LinkButton, TextBlock } from "./TraceBlocks";
import {
  personalizationPartsOf,
  segmentText,
  type PersonalizationPart,
  type PromptSegment,
  type SentPrompt,
} from "./promptCompositionModel";
import { prettyJson, type TraceNode } from "./traceModel";

/**
 * What a runtime placeholder carries, and the step that decided its content
 * (`why`: span names to look for next to the prompt). Only placeholders whose
 * content is chosen per user or per turn are listed.
 */
const PLACEHOLDER_NOTES: Record<string, { note: string; why?: string[] }> = {
  USER_PROFILE: {
    note: "Built from the user's details: name, learning profile, Study Space.",
  },
  SEARCH_MODE: {
    note: "Instruction block for the search intent chosen for this question.",
    why: ["search_intent"],
  },
  SKILL_LABEL: {
    note: "From the image skill picked for this request.",
    why: ["image_skill"],
  },
  SKILL_INSTRUCTIONS: {
    note: "From the image skill picked for this request.",
    why: ["image_skill"],
  },
  SKILL_AVOID: {
    note: "From the image skill picked for this request.",
    why: ["image_skill"],
  },
  IMAGE_SKILLS: { note: "The image skills offered to the planner." },
  AVAILABLE_TOOLS: {
    note: "One line per tool that feature flags allow, with its models.",
  },
  MEDIA_HINT: { note: "Whether files are selected, and which." },
  CLARIFICATION_HINT: {
    note: "Added only after the user answered or skipped a clarification.",
  },
  PLANNER_NOTE: {
    note: "The planner's restatement of the request; empty when it added nothing.",
  },
  DOCUMENT_CONTEXT: {
    note: "Excerpts retrieved from the user's files.",
    why: ["retrieve"],
  },
  ATTACHED_FILES: {
    note: "Files attached whole (images, documents that are not indexed).",
    why: ["media_prepare"],
  },
  SOURCE_CONTEXT: {
    note: "Material this generator is grounded on, e.g. the previous step's answer.",
    why: ["grounding"],
  },
  PARAPHRASE_RULE: {
    note: "Depends on whether multi-query retrieval is on.",
  },
};

const KIND_LABEL: Record<string, string> = {
  block: "Shared block",
  value: "Runtime value",
  optional: "Optional",
  marker: "History",
  text: "Template text",
  unknown: "Unresolved",
};

const KIND_TONE: Record<string, string> = {
  block: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  value: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  optional: "bg-muted text-muted-foreground",
  marker: "bg-muted text-muted-foreground",
  text: "bg-muted text-muted-foreground",
  unknown: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
};

const BAR_TONE: Record<string, string> = {
  block: "bg-sky-500/70",
  value: "bg-emerald-500/70",
  text: "bg-muted-foreground/40",
};

const CHANNEL_LABEL: Record<string, string> = {
  system: "System prompt",
  user: "User message",
};

/** The nearest step (looking outward from the prompt) with one of `names`. */
function findRelated(node: TraceNode, names: string[]): TraceNode | null {
  const search = (root: TraceNode, depth: number): TraceNode | null => {
    for (const child of root.children) {
      if (names.includes(child.span.name)) return child;
      if (depth > 0) {
        const below = search(child, depth - 1);
        if (below) return below;
      }
    }
    return null;
  };
  // Stay inside the step that built the prompt: a same-named decision under
  // another tool explains that tool's prompt, not this one.
  for (let scope = node.parent; scope; scope = scope.parent) {
    const hit = search(scope, 1);
    if (hit) return hit;
    if (scope.span.kind === "tool" || scope.span.kind === "router") break;
  }
  return null;
}

function statusText(segment: PromptSegment): string | null {
  if (segment.kind === "optional") return "not added this turn";
  if (segment.kind === "marker") return "sent as separate history turns";
  if (segment.kind === "value" && segment.chars === 0) {
    return "empty: added nothing this turn";
  }
  return null;
}

/** `profile.learning_traits.x`, allowed to wrap after each dot. */
function DottedPath({ path }: { path: string }) {
  return (
    <>
      {path.split(".").map((piece, index) => (
        <Fragment key={index}>
          {index > 0 && (
            <>
              .<wbr />
            </>
          )}
          {piece}
        </Fragment>
      ))}
    </>
  );
}

export function PersonalizationParts({
  parts,
}: {
  parts: PersonalizationPart[];
}) {
  return (
    <div className="space-y-2" data-analytics-private>
      {parts.map((part) => (
        <div key={part.part} className="rounded-lg border">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-muted/30 px-3 py-1.5">
            <span className="text-xs font-semibold">{part.label}</span>
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                part.included
                  ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {part.included ? "Added" : "Not added"}
            </span>
            {part.included && (
              <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                {part.chars.toLocaleString()} chars
              </span>
            )}
          </div>
          <div className="space-y-2 px-3 py-2">
            <p className="text-xs leading-relaxed text-muted-foreground">
              {part.reason}
            </p>
            {part.lines.length > 0 && (
              <div className="overflow-hidden rounded-md border">
                <div className="hidden grid-cols-[minmax(0,14rem)_minmax(0,1fr)] gap-3 border-b bg-muted/40 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid">
                  <span>User detail</span>
                  <span>Line added to the prompt</span>
                </div>
                <div className="divide-y">
                  {part.lines.map((line, index) => (
                    <div
                      key={`${line.source}-${index}`}
                      className="grid gap-x-3 gap-y-0.5 px-2.5 py-1.5 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]"
                    >
                      <span className="min-w-0 font-mono text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
                        <DottedPath path={line.source} />
                      </span>
                      <span className="min-w-0 whitespace-pre-wrap font-mono text-xs [overflow-wrap:anywhere]">
                        {line.line}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {part.text && (
              <TextBlock
                label={`${part.label}: text added`}
                text={part.text}
                defaultOpen={false}
              />
            )}
            {part.rulesChars !== null && part.rulesChars > 0 && (
              <p className="text-xs text-muted-foreground">
                Plus the fixed rules on how to apply the profile (
                {part.rulesChars.toLocaleString()} chars), which are the same
                for every user.
              </p>
            )}
            {part.ignored.length > 0 && (
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Set on the user but not used
                </p>
                <ul className="space-y-0.5">
                  {part.ignored.map((item, index) => (
                    <li
                      key={`${item.source}-${index}`}
                      className="text-xs text-muted-foreground"
                    >
                      <span className="font-mono text-[11px] [overflow-wrap:anywhere]">
                        <DottedPath path={item.source} />
                      </span>
                      {item.line && (
                        <span className="font-mono text-[11px]">
                          {" "}
                          ({item.line})
                        </span>
                      )}
                      : {item.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function SegmentRow({
  segment,
  index,
  channelChars,
  values,
  sent,
  node,
  personalization,
  onSelectSpan,
}: {
  segment: PromptSegment;
  index: number;
  channelChars: number;
  values: Record<string, unknown>;
  sent: SentPrompt | null;
  node: TraceNode;
  personalization: { parts: PersonalizationPart[]; spanId: string } | null;
  onSelectSpan: (spanId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const info = segment.name ? PLACEHOLDER_NOTES[segment.name] : undefined;
  const isProfile = segment.name === "USER_PROFILE";
  // The exact text as sent when it can be sliced out of the LLM call; for a
  // runtime value, else, the copy kept on the prompt step (may be shortened).
  const exact = segmentText(segment, sent);
  const stored =
    segment.kind === "value" && segment.name
      ? prettyJson(values[segment.name] ?? "")
      : null;
  const text = exact ?? stored;
  const hasText = text !== null && text.length > 0;
  const showProfile = isProfile && personalization !== null;
  const expandable = hasText || showProfile || segment.parts.length > 0;
  const related = info?.why ? findRelated(node, info.why) : null;
  const status = statusText(segment);
  const share =
    channelChars > 0 ? Math.round((segment.chars / channelChars) * 100) : 0;
  const Chevron = open ? ChevronDown : ChevronRight;
  const label = segment.name ?? "Template text";

  return (
    <li className="px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="w-4 shrink-0 text-right font-mono text-[11px] text-muted-foreground">
          {index + 1}
        </span>
        <span
          className={cn(
            "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            KIND_TONE[segment.kind] ?? KIND_TONE.unknown,
          )}
        >
          {KIND_LABEL[segment.kind] ?? segment.kind}
        </span>
        {segment.name && (
          <span className="min-w-0 break-all font-mono text-xs font-semibold">
            {segment.name}
          </span>
        )}
        {status && (
          <span className="text-xs italic text-muted-foreground">{status}</span>
        )}
        <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">
          {segment.chars.toLocaleString()}{" "}
          {segment.chars === 1 ? "char" : "chars"}
          {share > 0 ? ` · ${share}%` : ""}
        </span>
      </div>
      {segment.chars > 0 && (
        <div className="ml-6 mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full",
              BAR_TONE[segment.kind] ?? "bg-muted-foreground/40",
            )}
            style={{ width: `${Math.max(share, 1)}%` }}
          />
        </div>
      )}
      <div className="ml-6 mt-1.5 space-y-1.5 empty:hidden">
        {info && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {info.note}
          </p>
        )}
        {(expandable || related) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            {expandable && (
              <button
                type="button"
                onClick={() => setOpen((current) => !current)}
                aria-expanded={open}
                data-analytics-name="Toggle prompt part"
                className="inline-flex items-center gap-1 font-medium text-primary"
              >
                <Chevron className="h-3.5 w-3.5" aria-hidden />
                {open ? "Hide" : "Show"}{" "}
                {showProfile ? "text and the user details behind it" : "text"}
              </button>
            )}
            {related && (
              <LinkButton
                onClick={() => onSelectSpan(related.span.id)}
                analyticsName="Go to deciding step"
              >
                Why: step “{related.span.name}”
              </LinkButton>
            )}
          </div>
        )}
        {segment.chars > 0 && !hasText && (
          <p className="text-xs text-muted-foreground">
            The text of this part is not stored on its own; read it in the full
            prompt on the LLM call.
          </p>
        )}
        {open && showProfile && personalization && (
          <PersonalizationParts parts={personalization.parts} />
        )}
        {open && hasText && (
          <div data-analytics-private>
            <TextBlock
              label={label}
              text={text as string}
              note={
                exact === null ? "copy kept on this step" : "exactly as sent"
              }
              defaultOpen
            />
          </div>
        )}
        {open && segment.parts.length > 0 && (
          <div className="overflow-hidden rounded-lg border">
            <p className="border-b bg-muted/40 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Inside this block
            </p>
            <ol className="divide-y">
              {segment.parts.map((inner, innerIndex) => (
                <SegmentRow
                  key={innerIndex}
                  segment={inner}
                  index={innerIndex}
                  channelChars={segment.chars}
                  values={values}
                  sent={sent}
                  node={node}
                  personalization={personalization}
                  onSelectSpan={onSelectSpan}
                />
              ))}
            </ol>
          </div>
        )}
      </div>
    </li>
  );
}

/**
 * The prompt as an ordered list of every part it was assembled from, one
 * list per channel, each part openable to its text. `sent` is the rendered
 * prompt stored on the LLM call; with it each part shows exactly what was
 * sent. Returns nothing for a trace recorded before composition was captured.
 */
export function PromptComposition({
  segments,
  values,
  sent,
  node,
  byId,
  onSelectSpan,
}: {
  segments: PromptSegment[];
  values: Record<string, unknown>;
  sent: SentPrompt | null;
  node: TraceNode;
  byId: Map<string, TraceNode>;
  onSelectSpan: (spanId: string) => void;
}) {
  if (segments.length === 0) return null;
  const personalization = personalizationPartsOf(byId);
  const channels = ["system", "user"].filter((channel) =>
    segments.some((segment) => segment.channel === channel),
  );
  return (
    <div className="space-y-3">
      {channels.map((channel) => {
        const parts = segments.filter((segment) => segment.channel === channel);
        const total = parts.reduce((sum, segment) => sum + segment.chars, 0);
        return (
          <div key={channel} className="overflow-hidden rounded-lg border">
            <div className="flex items-baseline justify-between gap-3 border-b bg-muted/40 px-3 py-1.5">
              <span className="text-xs font-semibold">
                {CHANNEL_LABEL[channel] ?? channel}
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {parts.length} parts · {total.toLocaleString()} chars
              </span>
            </div>
            <ol className="divide-y">
              {parts.map((segment, index) => (
                <SegmentRow
                  key={`${channel}-${index}`}
                  segment={segment}
                  index={index}
                  channelChars={total}
                  values={values}
                  sent={sent}
                  node={node}
                  personalization={personalization}
                  onSelectSpan={onSelectSpan}
                />
              ))}
            </ol>
          </div>
        );
      })}
    </div>
  );
}
