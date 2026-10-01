// Shapes and parsers for the prompt-composition view: the ordered parts a
// prompt was assembled from, and the breakdown of the part built from the
// user's details. No React in here.

import { asArray, asRecord, asText, type TraceNode } from "./traceModel";

export interface PromptSegment {
  channel: string;
  /** block | value | optional | marker | text | unknown */
  kind: string;
  name: string | null;
  chars: number;
  /** Offsets into the rendered channel; null when they were not recorded. */
  start: number | null;
  end: number | null;
  /** What a shared block embeds, when it has placeholders of its own. */
  parts: PromptSegment[];
}

/** The rendered text of each channel, as stored on the LLM call. */
export interface SentPrompt {
  system: string | null;
  user: string | null;
}

export interface PersonalizationPart {
  part: string;
  label: string;
  included: boolean;
  reason: string;
  chars: number;
  /** Lines that reached the prompt, each with the user detail behind it. */
  lines: Array<{ source: string; line: string }>;
  /** Details that exist but were not used, and why. */
  ignored: Array<{ source: string; line: string | null; reason: string }>;
  /** Size of the fixed "how to apply the profile" rules appended to it. */
  rulesChars: number | null;
  /** The fragment exactly as it went into the prompt. */
  text: string | null;
}

export function parseSegments(
  value: unknown,
  channel?: string,
): PromptSegment[] {
  return asArray(value).flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];
    const own = asText(record.channel) ?? channel ?? "";
    return [
      {
        channel: own,
        kind: asText(record.kind) ?? "unknown",
        name: asText(record.name),
        chars: typeof record.chars === "number" ? record.chars : 0,
        start: typeof record.start === "number" ? record.start : null,
        end: typeof record.end === "number" ? record.end : null,
        parts: parseSegments(record.parts, own),
      },
    ];
  });
}

// The recorder cuts an over-long string and appends this marker.
const TRUNCATION = /… \[truncated \d+ chars\]$/;

/**
 * The exact text one part contributed, sliced out of the prompt the LLM call
 * stored. Null when it cannot be given exactly: no offsets, no stored prompt,
 * or the slice reaches into the part of a stored prompt that was cut.
 */
export function segmentText(
  segment: PromptSegment,
  sent: SentPrompt | null,
): string | null {
  if (segment.start === null || segment.end === null || !sent) return null;
  const text = segment.channel === "system" ? sent.system : sent.user;
  if (typeof text !== "string") return null;
  const points = codePoints(text);
  if (segment.end > points.usable) return null;
  return points.chars.slice(segment.start, segment.end).join("");
}

// The recorder counts offsets in code points (Python strings); a JS string
// index counts UTF-16 units, which differ for every emoji or maths symbol.
// Split each stored prompt once and slice by code point.
const pointCache = new Map<string, { chars: string[]; usable: number }>();

function codePoints(text: string): { chars: string[]; usable: number } {
  const cached = pointCache.get(text);
  if (cached) return cached;
  const chars = Array.from(text);
  const cut = text.search(TRUNCATION);
  // Code points before the truncation marker, when the prompt was cut.
  const usable =
    cut === -1 ? chars.length : Array.from(text.slice(0, cut)).length;
  const entry = { chars, usable };
  if (pointCache.size >= 8) pointCache.clear();
  pointCache.set(text, entry);
  return entry;
}

export function parsePersonalizationParts(
  value: unknown,
): PersonalizationPart[] {
  return asArray(value).flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];
    return [
      {
        part: asText(record.part) ?? "",
        label: asText(record.label) ?? asText(record.part) ?? "Part",
        included: record.included === true,
        reason: asText(record.reason) ?? "",
        chars: typeof record.chars === "number" ? record.chars : 0,
        lines: asArray(record.lines).flatMap((line) => {
          const entry = asRecord(line);
          return entry
            ? [
                {
                  source: asText(entry.source) ?? "",
                  line: asText(entry.line) ?? "",
                },
              ]
            : [];
        }),
        ignored: asArray(record.ignored).flatMap((line) => {
          const entry = asRecord(line);
          return entry
            ? [
                {
                  source: asText(entry.source) ?? "",
                  line: asText(entry.line),
                  reason: asText(entry.reason) ?? "",
                },
              ]
            : [];
        }),
        rulesChars:
          typeof record.rules_chars === "number" ? record.rules_chars : null,
        text: typeof record.text === "string" ? record.text : null,
      },
    ];
  });
}

/** The breakdown recorded by the turn's `load_context` step, if any. */
export function personalizationPartsOf(
  byId: Map<string, TraceNode>,
): { parts: PersonalizationPart[]; spanId: string } | null {
  let found: { parts: PersonalizationPart[]; spanId: string } | null = null;
  byId.forEach((node) => {
    if (found || node.span.name !== "load_context") return;
    const parts = parsePersonalizationParts(
      asRecord(node.span.output)?.personalization_parts,
    );
    if (parts.length > 0) found = { parts, spanId: node.span.id };
  });
  return found;
}
