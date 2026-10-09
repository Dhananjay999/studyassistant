// Turn-result fields that ride beside the answer: the saved note of a
// notes-generator turn and the exam-soon offer. Both travel in the `done`
// frame's `content` and in the persisted `metadata.content`, so the live
// stream and the history loaders map them with this one function and a
// reloaded conversation shows the same cards.
//
// Everything is validated here: a malformed payload yields no card instead
// of a broken one.

import type {
  ExamDateHintKind,
  ExamPrepOffer,
  GeneratedNote,
  MessageMeta,
} from "@/types";

type Content = Record<string, unknown>;

/** `response_type` the notes generator stamps on its result. */
export const NOTE_CREATED = "NOTE_CREATED";
/** Tool id of the notes generator (agent roster, `tool_used`). */
export const NOTES_TOOL = "notes_generator";

const HINT_KINDS: ReadonlySet<string> = new Set([
  "today",
  "tomorrow",
  "in_days",
  "weekday",
  "date",
]);
const NOTE_SOURCES: ReadonlySet<string> = new Set(["files", "topic", "answer"]);
const MAX_OFFER_SUBJECTS = 12;

const int = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) ? value : null;

function mapNote(content: Content): GeneratedNote | undefined {
  if (typeof content.note_id !== "string" || !content.note_id) return undefined;
  return {
    note_id: content.note_id,
    title:
      typeof content.title === "string" && content.title.trim()
        ? content.title
        : "Untitled note",
    preview: typeof content.preview === "string" ? content.preview : "",
    kind: typeof content.kind === "string" ? content.kind : undefined,
    source:
      typeof content.source === "string" && NOTE_SOURCES.has(content.source)
        ? (content.source as GeneratedNote["source"])
        : undefined,
    length: int(content.length) ?? undefined,
  };
}

function mapOffer(raw: unknown): ExamPrepOffer | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Content;
  if (typeof o.date_hint !== "string" || !HINT_KINDS.has(o.date_hint)) {
    return undefined;
  }
  return {
    exam_name:
      typeof o.exam_name === "string" && o.exam_name.trim()
        ? o.exam_name.trim()
        : null,
    date_hint: o.date_hint as ExamDateHintKind,
    days_ahead: int(o.days_ahead),
    weekday: int(o.weekday),
    day: int(o.day),
    month: int(o.month),
    year: int(o.year),
    subjects: Array.isArray(o.subjects)
      ? o.subjects
          .filter((s): s is string => typeof s === "string" && !!s.trim())
          .slice(0, MAX_OFFER_SUBJECTS)
      : [],
  };
}

/** The note / exam-offer part of a turn result (empty when it has neither). */
export function mapChatArtifacts(
  content: Content,
): Pick<MessageMeta, "note" | "exam_prep_offer"> {
  const out: Pick<MessageMeta, "note" | "exam_prep_offer"> = {};
  const note = mapNote(content);
  if (note) out.note = note;
  const offer = mapOffer(content.exam_prep_offer);
  if (offer) out.exam_prep_offer = offer;
  return out;
}
