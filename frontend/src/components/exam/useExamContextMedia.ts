// Which uploads the exam coach answers from on a topic page. The plan's
// study material is selected by default (what the student picked at setup);
// the student can add any other upload or drop one, and the choice is kept
// per plan in this browser so it survives navigating around the plan.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMedia } from "@/hooks/api";
import { analytics, AnalyticsEvent } from "@/lib/analytics";
import type { ExamPlan, MediaItem } from "@/types";

const STORAGE_PREFIX = "aeva_exam_context_";

function storageKey(planId: string): string {
  return `${STORAGE_PREFIX}${planId}`;
}

function loadStored(planId: string): string[] | null {
  try {
    const raw = localStorage.getItem(storageKey(planId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : null;
  } catch {
    return null;
  }
}

function store(planId: string, ids: Iterable<string>): void {
  try {
    localStorage.setItem(storageKey(planId), JSON.stringify(Array.from(ids)));
  } catch {
    /* private mode: the choice just does not persist */
  }
}

/** A document counts once it is indexed; images are usable as they are. */
export function isUsableContext(m: MediaItem): boolean {
  if (m.mime_type.startsWith("image/")) return true;
  return m.processing_status !== "failed";
}

export interface ExamContextMedia {
  /** The student's uploads, newest first (what the panel lists). */
  items: MediaItem[];
  /** Ids currently used as context. */
  selected: Set<string>;
  /** Items in `selected`, in list order. */
  selectedItems: MediaItem[];
  /** Items not selected: the accordion's "other uploads". */
  otherItems: MediaItem[];
  /** Ids that were chosen at plan setup. */
  planIds: Set<string>;
  loading: boolean;
  toggle: (id: string) => void;
  /** Latest ids for a send; stable across renders. */
  selectedRef: React.MutableRefObject<string[]>;
}

export function useExamContextMedia(plan: ExamPlan): ExamContextMedia {
  const media = useMedia();
  const items = useMemo(
    () => (media.data ?? []).filter(isUsableContext),
    [media.data],
  );
  const planIds = useMemo(
    () => new Set(plan.material_media_ids ?? []),
    [plan.material_media_ids],
  );

  // Default to the plan's material until the student changes the selection.
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(loadStored(plan.id) ?? plan.material_media_ids ?? []),
  );
  const customised = useRef(loadStored(plan.id) !== null);
  useEffect(() => {
    if (customised.current) return;
    setSelected(new Set(plan.material_media_ids ?? []));
  }, [plan.material_media_ids]);

  // Never send an id for an upload that no longer exists.
  const known = useMemo(() => new Set(items.map((m) => m.id)), [items]);
  const effective = useMemo(() => {
    if (!media.data) return selected;
    return new Set(Array.from(selected).filter((id) => known.has(id)));
  }, [known, media.data, selected]);

  const selectedRef = useRef<string[]>([]);
  selectedRef.current = Array.from(effective);

  const toggle = useCallback(
    (id: string) => {
      setSelected((prev) => {
        const next = new Set(prev);
        const on = !next.has(id);
        if (on) next.add(id);
        else next.delete(id);
        customised.current = true;
        store(plan.id, next);
        analytics.track(AnalyticsEvent.EXAM_PREP_CONTEXT_MEDIA_TOGGLED, {
          plan_id: plan.id,
          selected: on,
          selected_count: next.size,
          source: planIds.has(id) ? "plan" : "other",
        });
        return next;
      });
    },
    [plan.id, planIds],
  );

  const selectedItems = useMemo(
    () => items.filter((m) => effective.has(m.id)),
    [effective, items],
  );
  const otherItems = useMemo(
    () => items.filter((m) => !effective.has(m.id)),
    [effective, items],
  );

  return {
    items,
    selected: effective,
    selectedItems,
    otherItems,
    planIds,
    loading: media.isLoading,
    toggle,
    selectedRef,
  };
}
