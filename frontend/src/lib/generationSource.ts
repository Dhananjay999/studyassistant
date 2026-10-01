import type { GenerationSource, GenerationSourceKind } from "@/types";

/** The source picker's editable state; kept by the host panel so it survives
 * closing and re-opening the panel. */
export interface SourceDraft {
  kind: GenerationSourceKind;
  /** The topic for a topic source; an optional focus for files / a note. */
  topic: string;
  mediaIds: string[];
  noteId: string | null;
}

export const EMPTY_SOURCE: SourceDraft = {
  kind: "topic",
  topic: "",
  mediaIds: [],
  noteId: null,
};

/** The request fields for a draft, or null while it is still incomplete. */
export function toGenerationSource(d: SourceDraft): GenerationSource | null {
  const topic = d.topic.trim() || undefined;
  if (d.kind === "topic") return topic ? { source: "topic", topic } : null;
  if (d.kind === "files") {
    return d.mediaIds.length
      ? { source: "files", media_ids: d.mediaIds, topic }
      : null;
  }
  return d.noteId ? { source: "note", note_id: d.noteId, topic } : null;
}

/** Short human label for a pending generation ("Algebra", "2 files"…). */
export function describeSource(s: GenerationSource): string {
  if (s.topic) return s.topic;
  if (s.source === "files") {
    const n = s.media_ids?.length ?? 0;
    return n === 1 ? "your file" : `${n} files`;
  }
  return s.source === "note" ? "your note" : "your topic";
}
