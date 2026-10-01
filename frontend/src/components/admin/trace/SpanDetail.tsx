// Details of one recorded step, rendered for what the step is rather than as
// a JSON dump: an LLM call shows exactly what was sent (system prompt, each
// history turn, user message, schema, attachments) and what came back; a
// prompt shows the runtime value of every placeholder; the router shows which
// branches were checked and which rules rewrote the plan; and so on. The raw
// span is always one toggle away.
//
// Mounted for the selected step only. Give it `key={span.id}` so the
// open/closed state of its sections starts fresh for each step.

import { Fragment, useState, type ReactNode } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  X,
} from "lucide-react";
import { formatBytes } from "@/lib/adminFormat";
import { cn } from "@/lib/utils";
import type { AdminTraceSpan } from "@/types/adminTrace";
import {
  CopyableValue,
  CopyButton,
  Facts,
  JsonBlock,
  LinkButton,
  Notice,
  Payload,
  SectionHeading,
  SpanStatusBadge,
  TextBlock,
} from "./TraceBlocks";
import { PersonalizationParts, PromptComposition } from "./PromptComposition";
import {
  parsePersonalizationParts,
  parseSegments,
  type SentPrompt,
} from "./promptCompositionModel";
import { kindMeta, traceStatusNote, VISIBLE_SCROLLBAR } from "./traceKinds";
import {
  ancestorsOf,
  asArray,
  asRecord,
  asText,
  cappedPreview,
  charLength,
  formatMs,
  isEmptyValue,
  isProblemStatus,
  omitKeys,
  planSummary,
  prettyJson,
  shortHash,
  type TraceNode,
  type TraceTree,
} from "./traceModel";

export interface SpanDetailProps {
  node: TraceNode;
  tree: TraceTree;
  onSelectSpan: (spanId: string) => void;
  /** Opens the Prompt Map on a template (`?v=prompts&p=<name>`). */
  onOpenPrompt: (name: string) => void;
  /** Opens the Traces list filtered by a prompt or a tool. */
  onOpenTraces: (filter: { prompt?: string; tool?: string }) => void;
}

type BodyProps = SpanDetailProps & { span: AdminTraceSpan };

const charCount = (value: unknown): string | null =>
  typeof value === "number" ? `${value.toLocaleString()} chars` : null;

const yesNo = (value: unknown): string | null =>
  typeof value === "boolean" ? (value ? "yes" : "no") : null;

/** A scalar as text, a structure as compact JSON, nothing for null. */
function show(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return (
    asText(value) ?? (typeof value === "string" ? null : prettyJson(value))
  );
}

function countOf(value: unknown): string | null {
  if (Array.isArray(value)) return String(value.length);
  return asText(value);
}

function MiniTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div
      style={VISIBLE_SCROLLBAR}
      className="overflow-x-auto rounded-lg border"
    >
      <table className="w-full text-left text-xs">
        <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
          <tr>
            {head.map((title) => (
              <th
                key={title}
                className="whitespace-nowrap px-3 py-1.5 font-semibold"
              >
                {title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, column) => (
                <td
                  key={column}
                  className="whitespace-nowrap px-3 py-1.5 align-middle font-mono"
                >
                  {cell ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Metadata the view did not already show, as JSON. */
function OtherMeta({
  span,
  known,
}: {
  span: AdminTraceSpan;
  known: readonly string[];
}) {
  const rest = omitKeys(span.meta, [...known, "truncated"]);
  if (!rest) return null;
  return <JsonBlock label="Other metadata" value={rest} />;
}

function PromptRef({
  name,
  hash,
  onOpenPrompt,
}: {
  name: string;
  hash: string | null;
  onOpenPrompt: (name: string) => void;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
      <span className="font-mono">
        {name}
        {hash && (
          <span className="text-muted-foreground" title={`Version ${hash}`}>
            {" "}
            @ {shortHash(hash)}
          </span>
        )}
      </span>
      <LinkButton
        onClick={() => onOpenPrompt(name)}
        analyticsName="Open prompt in Prompt Map"
      >
        Prompt Map
        <ArrowUpRight className="h-3 w-3" aria-hidden />
      </LinkButton>
    </span>
  );
}

/* --------------------------------- LLM --------------------------------- */

const LLM_INPUT_KEYS = [
  "system_prompt",
  "history",
  "user_message",
  "attachments",
  "response_schema",
  "use_search",
];

const LLM_META_KEYS = [
  "method",
  "label",
  "config_key",
  "prompt_span_id",
  "input_chars",
  "history_turns",
  "output_chars",
  "chunks",
  "ttft_ms",
  "system_prompt_defaulted",
  "usage",
  "finish_reason",
  "provider_additions",
];

function HistoryTurns({ turns }: { turns: unknown[] }) {
  const items = turns.map((turn) => {
    const record = asRecord(turn);
    return {
      role: asText(record?.role) ?? "unknown role",
      text: prettyJson(record ? (record.content ?? "") : turn),
    };
  });
  const total = items.reduce((sum, item) => sum + charLength(item.text), 0);
  const [open, setOpen] = useState(items.length <= 6 && total <= 6000);

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        data-analytics-name="Toggle trace section"
        className="flex min-h-9 w-full items-center gap-1.5 rounded-lg border bg-muted/40 px-2.5 text-left"
      >
        <ChevronRight
          aria-hidden
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
        <span className="text-xs font-semibold">History</span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {items.length} {items.length === 1 ? "turn" : "turns"} ·{" "}
          {total.toLocaleString()} chars
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-l-2 border-border pl-2.5">
          {items.map((item, index) => (
            <TextBlock
              key={index}
              label={`${index + 1}. ${item.role}`}
              text={item.text}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function LlmInput({ span }: { span: AdminTraceSpan }) {
  const input = asRecord(span.input);
  // A capped or unexpected input has no sections to pull apart.
  if (!input || cappedPreview(span.input)) {
    return span.input === null || span.input === undefined ? (
      <p className="text-xs text-muted-foreground">No input was recorded.</p>
    ) : (
      <Payload label="Input" value={span.input} />
    );
  }
  const history = asArray(input.history);
  const attachments = asArray(input.attachments);
  const rest = omitKeys(input, LLM_INPUT_KEYS);
  const system = input.system_prompt;

  return (
    <>
      {typeof system === "string" ? (
        <TextBlock
          label="System prompt"
          text={system}
          note={
            span.meta?.system_prompt_defaulted === true
              ? "default: the caller passed none"
              : undefined
          }
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          No system prompt was sent with this call.
        </p>
      )}
      {history.length > 0 ? (
        <HistoryTurns turns={history} />
      ) : (
        <p className="text-xs text-muted-foreground">No history turns.</p>
      )}
      <TextBlock
        label="User message"
        text={prettyJson(input.user_message ?? "")}
      />
      {input.response_schema !== undefined &&
        input.response_schema !== null && (
          <JsonBlock label="Response schema" value={input.response_schema} />
        )}
      {attachments.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold">
            Attachments{" "}
            <span className="font-normal text-muted-foreground">
              (type and size only; file bytes are never stored)
            </span>
          </p>
          <MiniTable
            head={["#", "Mime type", "Size"]}
            rows={attachments.map((item, index) => {
              const record = asRecord(item);
              const bytes = record?.bytes;
              return [
                index + 1,
                asText(record?.mime_type) ?? "unknown",
                typeof bytes === "number" ? formatBytes(bytes) : "unknown",
              ];
            })}
          />
        </div>
      )}
      {rest && <JsonBlock label="Other input" value={rest} />}
    </>
  );
}

function LlmOutput({ span }: { span: AdminTraceSpan }) {
  if (span.output === null || span.output === undefined) {
    return (
      <p className="text-xs text-muted-foreground">
        No output was recorded
        {isProblemStatus(span.status) ? ": the call did not complete." : "."}
      </p>
    );
  }
  const output = asRecord(span.output);
  if (!output || cappedPreview(span.output)) {
    return <Payload label="Output" value={span.output} defaultOpen />;
  }
  const image = asRecord(output.image);
  const rest = omitKeys(output, ["text", "json", "image"]);
  return (
    <>
      {typeof output.text === "string" && (
        <TextBlock
          label="Text"
          note="raw model output"
          text={output.text}
          defaultOpen
        />
      )}
      {output.json !== undefined && output.json !== null && (
        <JsonBlock label="Structured output" value={output.json} defaultOpen />
      )}
      {image && (
        <Facts
          items={[
            ["Image", asText(image.mime_type) ?? "generated image"],
            [
              "Size",
              typeof image.bytes === "number" ? formatBytes(image.bytes) : null,
            ],
            ["Caption", asText(image.caption)],
          ]}
        />
      )}
      {rest && <JsonBlock label="Other output" value={rest} />}
    </>
  );
}

function LlmBody({ span, tree, onSelectSpan, onOpenPrompt }: BodyProps) {
  const meta = span.meta ?? {};
  const usage = asRecord(meta.usage);
  const promptSpanId = asText(meta.prompt_span_id);
  const promptNode = promptSpanId ? tree.byId.get(promptSpanId) : undefined;
  const promptSegments = parseSegments(promptNode?.span.meta?.segments);
  const tokens = usage
    ? [
        ["in", usage.input_tokens],
        ["out", usage.output_tokens],
        ["total", usage.total_tokens],
      ]
        .filter(([, count]) => typeof count === "number")
        .map(
          ([label, count]) => `${(count as number).toLocaleString()} ${label}`,
        )
        .join(" · ")
    : null;

  return (
    <>
      <Facts
        items={[
          [
            "Provider / model",
            [span.provider, span.model].filter(Boolean).join(" / ") || null,
          ],
          [
            "Prompt template",
            span.prompt_name ? (
              <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                <PromptRef
                  name={span.prompt_name}
                  hash={span.prompt_hash}
                  onOpenPrompt={onOpenPrompt}
                />
                {promptNode && (
                  <LinkButton
                    onClick={() => onSelectSpan(promptNode.span.id)}
                    analyticsName="Go to prompt step"
                  >
                    Placeholder values
                  </LinkButton>
                )}
              </span>
            ) : (
              <span className="font-normal text-muted-foreground">
                none: this text was not built from a prompt template
              </span>
            ),
          ],
          ["Method", asText(meta.method)],
          ["Config key", asText(meta.config_key)],
          ["Tokens", tokens || null],
          ["Finish reason", asText(meta.finish_reason)],
          [
            "Time to first token",
            typeof meta.ttft_ms === "number" ? formatMs(meta.ttft_ms) : null,
          ],
          ["Stream chunks", asText(meta.chunks)],
          ["Input size", charCount(meta.input_chars)],
          ["Output size", charCount(meta.output_chars)],
          [
            "Web search",
            asRecord(span.input)?.use_search === true ? "enabled" : null,
          ],
        ]}
      />
      {promptNode && promptSegments.length > 0 && (
        <>
          <SectionHeading aside="every part of this prompt, in order">
            What this prompt is made of
          </SectionHeading>
          <PromptComposition
            segments={promptSegments}
            values={asRecord(asRecord(promptNode.span.input)?.values) ?? {}}
            sent={sentPromptOf(span)}
            node={promptNode}
            byId={tree.byId}
            onSelectSpan={onSelectSpan}
          />
        </>
      )}
      <SectionHeading aside="what the model received">Input</SectionHeading>
      <LlmInput span={span} />
      <ProviderAdditions span={span} />
      <SectionHeading aside="what the model returned">Output</SectionHeading>
      <LlmOutput span={span} />
      <OtherMeta span={span} known={LLM_META_KEYS} />
    </>
  );
}

/* -------------------------------- Prompt ------------------------------- */

/** The rendered prompt an LLM call stored, for slicing parts out of it. */
function sentPromptOf(llm: AdminTraceSpan | undefined): SentPrompt | null {
  const input = asRecord(llm?.input);
  if (!input) return null;
  return {
    system:
      typeof input.system_prompt === "string" ? input.system_prompt : null,
    user: typeof input.user_message === "string" ? input.user_message : null,
  };
}

/** Text a provider appended to the prompt after the template was rendered. */
function ProviderAdditions({ span }: { span: AdminTraceSpan }) {
  const additions = asArray(span.meta?.provider_additions);
  if (additions.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <Notice tone="info">
        The provider added text to this prompt after it was rendered. It is part
        of what the model received but of no template, so it is not in the
        prompt text shown above.
      </Notice>
      {additions.map((item, index) => {
        const record = asRecord(item);
        if (!record) return null;
        const channel =
          asText(record.channel) === "system"
            ? "system prompt"
            : "user message";
        return (
          <div key={index} className="space-y-1">
            <p className="text-xs text-muted-foreground">
              Appended to the {channel}: {asText(record.reason)}
            </p>
            <TextBlock
              label={`Added to the ${channel}`}
              text={asText(record.text) ?? ""}
              defaultOpen={false}
            />
          </div>
        );
      })}
    </div>
  );
}

function PlaceholderValue({ name, value }: { name: string; value: unknown }) {
  const text = prettyJson(value ?? "");
  if (text.length === 0) {
    return (
      <span className="text-xs italic text-muted-foreground">
        (empty string)
      </span>
    );
  }
  if (text.length <= 200 && !text.includes("\n")) {
    return (
      <div className="flex items-start gap-1">
        <span className="min-w-0 flex-1 whitespace-pre-wrap break-words pt-1 font-mono text-xs [overflow-wrap:anywhere] sm:pt-0.5">
          {text}
        </span>
        <CopyButton text={text} label={`Copy ${name}`} />
      </div>
    );
  }
  return <TextBlock label={name} text={text} />;
}

function PromptBody({
  span,
  node,
  tree,
  onSelectSpan,
  onOpenPrompt,
  onOpenTraces,
}: BodyProps) {
  const meta = span.meta ?? {};
  const segments = parseSegments(meta.segments);
  const name = span.prompt_name ?? span.name;
  const values = asRecord(asRecord(span.input)?.values) ?? {};
  const entries = Object.entries(values);
  const blocks = asArray(meta.blocks).map(String);
  const notSupplied = asArray(meta.optional)
    .map(String)
    .filter((key) => !(key in values));
  const output = asRecord(span.output);
  // The LLM call that sent the text this build produced.
  let sentBy: TraceNode | undefined;
  tree.byId.forEach((candidate) => {
    if (candidate.span.meta?.prompt_span_id === span.id) sentBy = candidate;
  });

  return (
    <>
      <Facts
        items={[
          [
            "Template",
            <PromptRef
              key="template"
              name={name}
              hash={null}
              onOpenPrompt={onOpenPrompt}
            />,
          ],
          [
            "Version",
            span.prompt_hash ? (
              <CopyableValue value={span.prompt_hash} label="version hash" />
            ) : null,
          ],
          [
            "Rendered size",
            output
              ? [
                  charCount(output.system_chars) &&
                    `system ${charCount(output.system_chars)}`,
                  charCount(output.user_chars) &&
                    `user ${charCount(output.user_chars)}`,
                ]
                  .filter(Boolean)
                  .join(" · ") || null
              : null,
          ],
          ["Takes history", yesNo(meta.uses_history)],
          ["Takes attachments", yesNo(meta.uses_attachments)],
          [
            "Sent by",
            sentBy ? (
              <LinkButton
                onClick={() => onSelectSpan((sentBy as TraceNode).span.id)}
                analyticsName="Go to LLM call"
              >
                LLM call {sentBy.span.name}
                {sentBy.span.model ? ` (${sentBy.span.model})` : ""}
              </LinkButton>
            ) : null,
          ],
          [
            "Other traces",
            <LinkButton
              key="traces"
              onClick={() => onOpenTraces({ prompt: name })}
              analyticsName="Open traces for prompt"
            >
              Traces that rendered this prompt
            </LinkButton>,
          ],
        ]}
      />

      {segments.length > 0 && (
        <>
          <SectionHeading aside="every part of the prompt, in order">
            How this prompt was assembled
          </SectionHeading>
          <PromptComposition
            segments={segments}
            values={values}
            sent={sentPromptOf((sentBy as TraceNode | undefined)?.span)}
            node={node}
            byId={tree.byId}
            onSelectSpan={onSelectSpan}
          />
        </>
      )}

      <SectionHeading aside="text defined once, embedded in this template">
        Shared blocks
      </SectionHeading>
      {blocks.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {blocks.map((block) => (
            <span
              key={block}
              className="rounded-md border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px]"
            >
              {block}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          This template embeds no shared block.
        </p>
      )}

      <SectionHeading aside="the data passed into the template">
        Placeholder values
      </SectionHeading>
      {entries.length > 0 ? (
        <div className="overflow-hidden rounded-lg border">
          <div className="hidden grid-cols-[minmax(0,11rem)_minmax(0,1fr)] gap-3 border-b bg-muted/40 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid">
            <span>Placeholder</span>
            <span>Runtime value</span>
          </div>
          <div className="divide-y">
            {entries.map(([key, value]) => (
              <div
                key={key}
                className="grid gap-x-3 gap-y-1 px-3 py-2 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]"
              >
                <div className="min-w-0 break-all font-mono text-xs font-semibold sm:pt-0.5">
                  {key}
                </div>
                <div className="min-w-0">
                  <PlaceholderValue name={key} value={value} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No placeholder values were recorded for this build.
        </p>
      )}
      {notSupplied.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Optional and not supplied:{" "}
          <span className="font-mono">{notSupplied.join(", ")}</span>
        </p>
      )}
      <OtherMeta
        span={span}
        known={[
          "segments",
          "blocks",
          "optional",
          "supplied",
          "uses_history",
          "uses_attachments",
        ]}
      />
    </>
  );
}

/* -------------------------------- Router ------------------------------- */

function RouterBody({ span, node, onSelectSpan }: BodyProps) {
  const input = asRecord(span.input);
  const output = asRecord(span.output);
  const checked = asArray(span.meta?.checked);
  const steps = asArray(output?.steps);
  const decisions = node.children.filter(
    (child) => child.span.kind === "decision",
  );

  return (
    <>
      <Facts
        items={[
          ["Route source", asText(output?.source)],
          ["Final action", asText(output?.action)],
          [
            "Steps planned",
            steps.length > 0 ? (
              <span className="font-mono">
                {steps
                  .map((step) => planSummary(step))
                  .filter(Boolean)
                  .join(" → ")}
              </span>
            ) : null,
          ],
          ["Files selected", countOf(input?.media_ids)],
          ["Answering a clarification", yesNo(input?.has_clarification)],
        ]}
      />

      <SectionHeading aside="in evaluation order">
        Branches checked
      </SectionHeading>
      {checked.length > 0 ? (
        <ol className="space-y-1">
          {checked.map((item, index) => {
            const record = asRecord(item);
            const matched = record?.matched === true;
            const why = asText(record?.reason) ?? asText(record?.detail);
            return (
              <li
                key={index}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1 text-xs",
                  matched
                    ? "bg-emerald-500/10 font-medium"
                    : "text-muted-foreground",
                )}
              >
                <span className="w-4 shrink-0 text-right font-mono text-[11px]">
                  {index + 1}
                </span>
                {matched ? (
                  <Check
                    aria-hidden
                    className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                  />
                ) : (
                  <X aria-hidden className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className="min-w-0 break-words font-mono">
                  {asText(record?.branch) ?? prettyJson(item)}
                  {why && (
                    <span className="font-sans font-normal"> · {why}</span>
                  )}
                </span>
                <span className="ml-auto shrink-0 text-[11px]">
                  {matched ? "matched" : "not matched"}
                </span>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-xs text-muted-foreground">
          The list of branches checked was not recorded.
        </p>
      )}

      <SectionHeading aside="rule: reason, then before → after">
        Decisions
      </SectionHeading>
      {decisions.length > 0 ? (
        <ol className="space-y-1.5">
          {decisions.map((child) => {
            const reason = asText(child.span.meta?.reason);
            const before = planSummary(child.span.input);
            const after = planSummary(child.span.output);
            return (
              <li key={child.span.id}>
                <button
                  type="button"
                  onClick={() => onSelectSpan(child.span.id)}
                  data-analytics-name="Go to decision step"
                  className="block w-full rounded-lg border px-3 py-2 text-left hover:bg-accent/50 active:bg-accent/60"
                >
                  <span className="block text-xs leading-relaxed">
                    <span className="font-mono font-semibold">
                      {child.span.name}
                    </span>
                    {reason ? `: ${reason}` : ""}
                  </span>
                  {(before || after) && (
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                      {before && <span>{before}</span>}
                      {before && after && (
                        <ArrowRight aria-hidden className="h-3 w-3 shrink-0" />
                      )}
                      {after && (
                        <span className="text-foreground">{after}</span>
                      )}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-xs text-muted-foreground">
          No routing rule recorded a decision under this step.
        </p>
      )}

      <Payload label="Message routed" value={input?.message} />
      <Payload label="Final plan" value={output?.plan} />
      <Payload
        label="Other input"
        value={omitKeys(input, ["message", "media_ids", "has_clarification"])}
      />
      <Payload
        label="Other output"
        value={omitKeys(output, ["source", "action", "steps", "plan"])}
      />
      <OtherMeta span={span} known={["checked"]} />
    </>
  );
}

/* ------------------------------- Decision ------------------------------ */

function DecisionBody({ span }: BodyProps) {
  const output = asRecord(span.output);
  const reason = asText(span.meta?.reason) ?? asText(output?.reason);
  const before = planSummary(span.input);
  const after = planSummary(span.output);

  return (
    <>
      {reason ? (
        <div className="rounded-r-lg border-l-4 border-primary bg-primary/5 px-3 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Why
          </p>
          <p className="mt-0.5 text-sm leading-relaxed">{reason}</p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No reason was recorded for this decision.
        </p>
      )}
      {span.name === "resolve_model" && (
        <Facts
          items={[
            ["Model", asText(output?.model)],
            ["Config key", asText(output?.config_key)],
            ["Chosen by", asText(output?.source)],
          ]}
        />
      )}
      {span.name === "outcome" && (
        <Facts items={[["Outcome", asText(output?.outcome)]]} />
      )}
      {before && after && before !== after && (
        <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs">
          <span className="text-muted-foreground">{before}</span>
          <ArrowRight aria-hidden className="h-3.5 w-3.5 shrink-0" />
          <span className="font-semibold">{after}</span>
        </div>
      )}
      <Payload label="Input (before)" value={span.input} />
      <Payload label="Output (after)" value={span.output} />
      <OtherMeta span={span} known={["reason"]} />
    </>
  );
}

/* --------------------------------- Tool -------------------------------- */

const STEP_KIND_NOTE: Record<string, string> = {
  answer: "answer (produces the reply the user reads)",
  generator: "generator (builds an artefact beside the answer)",
};

const THREAD_NOTE: Record<string, string> = {
  request: "request (the thread serving the user)",
  worker: "worker (a pool thread, in parallel)",
};

function ToolBody({ span, onOpenTraces }: BodyProps) {
  const meta = span.meta ?? {};
  const input = asRecord(span.input);
  const output = asRecord(span.output);
  const prior = asArray(input?.prior_results);
  const stepKind = asText(meta.step_kind);
  const thread = asText(meta.thread);
  const answer = output?.answer ?? output?.text;

  return (
    <>
      <Facts
        items={[
          ["Purpose", asText(input?.purpose)],
          [
            "Step kind",
            stepKind ? (STEP_KIND_NOTE[stepKind] ?? stepKind) : null,
          ],
          ["Step input", asText(meta.step_input)],
          ["Thread", thread ? (THREAD_NOTE[thread] ?? thread) : null],
          ["Model", asText(meta.model)],
          ["Config key", asText(meta.config_key)],
          ["Streamed", yesNo(meta.streamed)],
          ["Step id", asText(meta.step_id)],
          [
            "Other traces",
            <LinkButton
              key="traces"
              onClick={() => onOpenTraces({ tool: span.name })}
              analyticsName="Open traces for tool"
            >
              Traces that ran this tool
            </LinkButton>,
          ],
        ]}
      />

      <SectionHeading aside="what the tool was given">Input</SectionHeading>
      {isEmptyValue(input?.params) ? (
        <p className="text-xs text-muted-foreground">No params.</p>
      ) : (
        <Payload label="Params" value={input?.params} defaultOpen />
      )}
      {prior.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold">
            Results received from earlier steps
          </p>
          <MiniTable
            head={["From tool", "Text", "Sources"]}
            rows={prior.map((item) => {
              const record = asRecord(item);
              return [
                asText(record?.tool) ?? prettyJson(item),
                charCount(record?.text_chars),
                countOf(record?.sources),
              ];
            })}
          />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No earlier results were passed to this step.
        </p>
      )}
      <Payload
        label="Other input"
        value={omitKeys(input, ["params", "purpose", "prior_results"])}
      />
      {!input && <Payload label="Input" value={span.input} />}

      <SectionHeading aside="what the tool returned">Result</SectionHeading>
      {typeof answer === "string" && answer.length > 0 && (
        <TextBlock label="Answer text" text={answer} defaultOpen />
      )}
      {span.output === null || span.output === undefined ? (
        <p className="text-xs text-muted-foreground">
          No result was recorded
          {isProblemStatus(span.status) ? ": the tool did not complete." : "."}
        </p>
      ) : (
        <Payload
          label="Result"
          value={span.output}
          defaultOpen={typeof answer === "string" ? false : undefined}
        />
      )}
      <OtherMeta
        span={span}
        known={[
          "step_id",
          "step_kind",
          "step_input",
          "model",
          "config_key",
          "thread",
          "streamed",
        ]}
      />
    </>
  );
}

/* ------------------------------ Retrieval ------------------------------ */

const RETRIEVAL_OUTPUT_KEYS = [
  "query_used",
  "chunks",
  "excerpts",
  "sources",
  "context_chars",
  "coverage",
  "diagnostics",
];

function RetrievalBody({ span }: BodyProps) {
  const input = asRecord(span.input);
  const output = asRecord(span.output);
  const query = asText(input?.query);
  const queryUsed = asText(output?.query_used);
  const chunks = asArray(output?.chunks);
  const media = asArray(input?.media)
    .map((item) => {
      const record = asRecord(item);
      return asText(record?.name) ?? asText(record?.id) ?? asText(item);
    })
    .filter(Boolean);
  const excerpts = output?.excerpts;
  const hasChunks = Array.isArray(output?.chunks);

  return (
    <>
      <Facts
        items={[
          ["Query", query],
          [
            "Query used",
            queryUsed ? (
              <>
                {queryUsed}
                {query && queryUsed !== query && (
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    (rewritten)
                  </span>
                )}
              </>
            ) : null,
          ],
          ["Documents", media.length > 0 ? media.join(", ") : null],
          ["Context size", charCount(output?.context_chars)],
          ["Coverage", show(output?.coverage)],
          [
            "Excerpts",
            Array.isArray(excerpts)
              ? String(excerpts.length)
              : asText(excerpts),
          ],
        ]}
      />

      {hasChunks && (
        <>
          <SectionHeading aside={`${chunks.length} returned`}>
            Chunks
          </SectionHeading>
          {chunks.length > 0 ? (
            <MiniTable
              head={["Chunk id", "Score", "Origin", "Document", "Index"]}
              rows={chunks.map((item) => {
                const record = asRecord(item);
                const score = record?.score;
                const chunkId = asText(record?.id);
                return [
                  chunkId ? (
                    <CopyableValue value={chunkId} label="chunk id" />
                  ) : null,
                  typeof score === "number" ? score.toFixed(3) : asText(score),
                  asText(record?.origin),
                  asText(record?.media_id),
                  asText(record?.chunk_index),
                ];
              })}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              Retrieval returned no chunks.
            </p>
          )}
        </>
      )}

      <Payload label="Diagnostics" value={output?.diagnostics} defaultOpen />
      <Payload label="Options" value={input?.options} />
      {Array.isArray(excerpts) && <Payload label="Excerpts" value={excerpts} />}
      <Payload label="Sources" value={output?.sources} />
      <Payload
        label="Other input"
        value={omitKeys(input, ["query", "media", "options"])}
      />
      <Payload
        label="Other output"
        value={omitKeys(output, RETRIEVAL_OUTPUT_KEYS)}
      />
      {!input && <Payload label="Input" value={span.input} />}
      {!output && <Payload label="Output" value={span.output} />}
      <OtherMeta span={span} known={[]} />
    </>
  );
}

/* ------------------------------ Other kinds ---------------------------- */

function EmbeddingBody({ span }: BodyProps) {
  const input = asRecord(span.input);
  const output = asRecord(span.output);
  const texts = asArray(input?.texts);
  return (
    <>
      <Facts
        items={[
          [
            "Provider / model",
            [span.provider, span.model].filter(Boolean).join(" / ") || null,
          ],
          ["Task type", asText(input?.task_type)],
          ["Texts embedded", asText(input?.count)],
          ["Total size", charCount(input?.total_chars)],
          ["Dimensions", asText(input?.dim)],
          ["Vectors returned", asText(output?.vectors)],
          [
            "Tokens",
            typeof asRecord(span.meta?.usage)?.total_tokens === "number"
              ? (
                  asRecord(span.meta?.usage)?.total_tokens as number
                ).toLocaleString()
              : null,
          ],
        ]}
      />
      {texts.map((text, index) => (
        <TextBlock
          key={index}
          label={`Text ${index + 1}`}
          text={prettyJson(text)}
        />
      ))}
      <Payload
        label="Other input"
        value={omitKeys(input, [
          "task_type",
          "count",
          "total_chars",
          "dim",
          "texts",
        ])}
      />
      <Payload label="Other output" value={omitKeys(output, ["vectors"])} />
      <OtherMeta span={span} known={["usage"]} />
    </>
  );
}

function ContextBody({ span }: BodyProps) {
  const input = asRecord(span.input);
  const output = asRecord(span.output);
  const session = asRecord(output?.session);
  const personalization = parsePersonalizationParts(
    output?.personalization_parts,
  );
  return (
    <>
      <Facts
        items={[
          ["Session", asText(session?.title)],
          [
            "Session id",
            asText(session?.id ?? input?.session_id) ? (
              <CopyableValue
                value={asText(session?.id ?? input?.session_id) as string}
                label="session id"
              />
            ) : null,
          ],
          ["Space", asText(session?.space_name) ?? asText(session?.space_id)],
          ["Debug user", yesNo(output?.is_debug_user)],
          [
            "Response language",
            // Traces recorded before migration 025 used preferred_language.
            asText(output?.response_language ?? output?.preferred_language),
          ],
          ["History messages", countOf(output?.history_messages)],
          ["Source content attached", yesNo(output?.source_content)],
        ]}
      />
      <Payload label="Enriched message" value={output?.enriched_message} />
      {personalization.length > 0 && (
        <>
          <SectionHeading aside="what becomes {USER_PROFILE} in the prompts">
            Prompt parts built from the user's details
          </SectionHeading>
          <PersonalizationParts parts={personalization} />
        </>
      )}
      <Payload
        label="Personalization (full text)"
        value={output?.personalization}
      />
      <Payload
        label="Clarification resumed"
        value={output?.clarification_resume}
      />
      <Payload
        label="Other output"
        value={omitKeys(output, [
          "session",
          "is_debug_user",
          "response_language",
          "preferred_language",
          "history_messages",
          "personalization",
          "personalization_parts",
          "enriched_message",
          "source_content",
          "clarification_resume",
        ])}
      />
      {!output && <Payload label="Output" value={span.output} />}
      <Payload label="Other input" value={omitKeys(input, ["session_id"])} />
      <OtherMeta span={span} known={[]} />
    </>
  );
}

function TurnBody({ span }: BodyProps) {
  const input = asRecord(span.input);
  const output = asRecord(span.output);
  const tools = asArray(output?.tools_used).map(String);
  const outcome = asText(span.meta?.outcome);
  const outcomeNote = outcome ? traceStatusNote(outcome) : null;
  return (
    <>
      <Facts
        items={[
          [
            "Outcome",
            outcome && outcomeNote ? `${outcome} (${outcomeNote})` : outcome,
          ],
          [
            "Tools used",
            tools.length > 0 ? tools.join(", ") : asText(output?.tool_used),
          ],
          ["Files selected", countOf(input?.media_ids)],
          ["Run id", asText(input?.run_id)],
          ["Pasted source content", charCount(input?.source_content_chars)],
        ]}
      />
      <SectionHeading aside="what the user sent">Request</SectionHeading>
      <Payload label="User message" value={input?.message} defaultOpen />
      <Payload
        label="Other request fields"
        value={omitKeys(input, ["message", "run_id", "source_content_chars"])}
      />
      {!input && <Payload label="Input" value={span.input} />}
      <SectionHeading aside="what the user received">Answer</SectionHeading>
      {output ? (
        <>
          <Payload
            label="Displayed text"
            value={output.display_text}
            defaultOpen
          />
          <Payload
            label="Other output"
            value={omitKeys(output, [
              "display_text",
              "tool_used",
              "tools_used",
            ])}
          />
        </>
      ) : span.output === null || span.output === undefined ? (
        <p className="text-xs text-muted-foreground">
          No answer was recorded for this turn.
        </p>
      ) : (
        <Payload label="Output" value={span.output} />
      )}
      <OtherMeta span={span} known={["outcome"]} />
    </>
  );
}

function PersistBody({ span }: BodyProps) {
  const output = asRecord(span.output);
  const messageId = asText(output?.message_id);
  return (
    <>
      <Facts
        items={[
          [
            "Message id",
            messageId ? (
              <CopyableValue value={messageId} label="message id" />
            ) : null,
          ],
        ]}
      />
      <Payload label="Input" value={span.input} />
      <Payload label="Other output" value={omitKeys(output, ["message_id"])} />
      {!output && <Payload label="Output" value={span.output} />}
      <OtherMeta span={span} known={[]} />
    </>
  );
}

function GenericBody({ span }: BodyProps) {
  return (
    <>
      <Facts
        items={[
          [
            "Provider / model",
            [span.provider, span.model].filter(Boolean).join(" / ") || null,
          ],
          ["Prompt", span.prompt_name],
        ]}
      />
      <Payload label="Input" value={span.input} />
      <Payload label="Output" value={span.output} />
      <OtherMeta span={span} known={[]} />
    </>
  );
}

const BODIES: Record<string, (props: BodyProps) => JSX.Element> = {
  llm: LlmBody,
  prompt: PromptBody,
  router: RouterBody,
  decision: DecisionBody,
  tool: ToolBody,
  retrieval: RetrievalBody,
  embedding: EmbeddingBody,
  context: ContextBody,
  turn: TurnBody,
  persist: PersistBody,
};

/* -------------------------------- Shell -------------------------------- */

export function SpanDetail(props: SpanDetailProps) {
  const { node, onSelectSpan } = props;
  const { span } = node;
  const [raw, setRaw] = useState(false);
  const kind = kindMeta(span.kind);
  const Icon = kind.icon;
  const trail = ancestorsOf(node);
  const Body = BODIES[span.kind] ?? GenericBody;

  return (
    <div className="space-y-3.5" data-analytics-private>
      <header className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
              kind.chip,
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {kind.label}
          </span>
          <SpanStatusBadge status={span.status} />
          <span className="ml-auto font-mono text-[11px] text-muted-foreground">
            started +{formatMs(span.start_ms)} · took{" "}
            {formatMs(span.duration_ms)}
          </span>
        </div>
        <h2 className="break-all font-mono text-base font-semibold leading-snug">
          {span.name}
        </h2>
        {trail.length > 0 && (
          <nav
            aria-label="Parent steps"
            className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[11px] text-muted-foreground"
          >
            <span>inside</span>
            {trail.map((ancestor, index) => (
              <Fragment key={ancestor.span.id}>
                {index > 0 && <ChevronRight aria-hidden className="h-3 w-3" />}
                <button
                  type="button"
                  onClick={() => onSelectSpan(ancestor.span.id)}
                  data-analytics-name="Go to parent step"
                  className="font-mono underline decoration-dotted underline-offset-2 hover:text-foreground"
                >
                  {ancestor.span.name}
                </button>
              </Fragment>
            ))}
          </nav>
        )}
        <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
          span
          <CopyableValue value={span.id} label="span id" />
        </p>
      </header>

      {span.error && (
        <Notice tone="error">
          <p className="font-semibold">Error</p>
          <pre className="mt-0.5 whitespace-pre-wrap break-words font-mono text-xs [overflow-wrap:anywhere]">
            {span.error}
          </pre>
        </Notice>
      )}
      {(span.status === "unfinished" || span.status === "running") && (
        <Notice>
          This step was still running when the trace was written (for example a
          worker thread abandoned after a timeout). Its duration is the time
          until the trace ended, and its output may be missing.
        </Notice>
      )}
      {span.meta?.truncated === true && (
        <Notice>
          Some of this step's data was longer than the storage limit and was
          cut. A truncated string ends with “… [truncated N chars]”.
        </Notice>
      )}
      {node.orphan && (
        <Notice tone="info">
          The step this ran under was not stored with the trace, so it is listed
          at the top level.
        </Notice>
      )}

      <Body {...props} span={span} />

      <div className="space-y-2 border-t pt-2">
        <button
          type="button"
          onClick={() => setRaw((value) => !value)}
          aria-expanded={raw}
          data-analytics-name="Toggle raw span"
          className="inline-flex min-h-9 items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <Braces className="h-3.5 w-3.5" aria-hidden />
          Raw
          <ChevronDown
            aria-hidden
            className={cn(
              "h-3.5 w-3.5 transition-transform",
              raw && "rotate-180",
            )}
          />
        </button>
        {raw && <JsonBlock label="Span JSON" value={span} defaultOpen />}
      </div>
    </div>
  );
}
