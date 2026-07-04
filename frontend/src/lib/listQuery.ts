// Config-driven, client-side search / sort / filter for listing pages.
//
// Each page describes its data with a `ListConfig<T>`: the sort options (each
// carrying its own comparator), the filter groups (each carrying its own
// predicate), and which fields search matches against. `applyListQuery` is a
// pure function that turns raw items + the live query state into the rendered
// list — page-agnostic and unit-testable. The URL <-> state plumbing lives in
// `useListQuery`; the toolbar UI lives in `components/common/list/`.

/** One selectable sort order. `compare` is a standard Array.sort comparator. */
export interface SortOption<T> {
  value: string;
  label: string;
  compare: (a: T, b: T) => number;
}

export type FilterKind = "multi" | "single" | "date";

/**
 * One filter group (e.g. "Difficulty"). `predicate` decides whether an item
 * passes given the currently-selected values for this group; it is only called
 * when `selected` is non-empty, so an empty group never filters anything.
 *
 * For `kind: "date"` the selected values are the range endpoints as ISO date
 * strings: `[from]`, `[, to]`, or `[from, to]` (either may be blank).
 */
export interface FilterGroup<T> {
  id: string;
  label: string;
  kind: FilterKind;
  /** Choices for multi/single groups. Omitted for date groups. */
  options?: { value: string; label: string }[];
  predicate: (item: T, selected: string[]) => boolean;
}

export interface ListConfig<T> {
  sorts: SortOption<T>[];
  defaultSort: string;
  filters: FilterGroup<T>[];
  /** Lowercased-and-substring-matched against the debounced search term. */
  searchFields: (item: T) => Array<string | null | undefined>;
}

/** The live query state applied to a list (produced by `useListQuery`). */
export interface ListQueryState {
  search: string;
  sort: string;
  /** group id -> selected values (comma-decoded from the URL). */
  filters: Record<string, string[]>;
}

/** Filters (search + every active group) then sorts a list per its config. */
export function applyListQuery<T>(
  items: T[],
  config: ListConfig<T>,
  state: ListQueryState,
): T[] {
  const q = state.search.trim().toLowerCase();

  let out = items.filter((item) => {
    if (q) {
      const hay = config
        .searchFields(item)
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    for (const group of config.filters) {
      const selected = state.filters[group.id];
      if (selected && selected.length > 0 && !group.predicate(item, selected)) {
        return false;
      }
    }
    return true;
  });

  const sort =
    config.sorts.find((s) => s.value === state.sort) ??
    config.sorts.find((s) => s.value === config.defaultSort);
  if (sort) out = out.slice().sort(sort.compare);
  return out;
}

/** Convenience comparators for building `SortOption.compare`. */
export const byDateDesc = (a?: string | null, b?: string | null): number =>
  new Date(b ?? 0).getTime() - new Date(a ?? 0).getTime();
export const byDateAsc = (a?: string | null, b?: string | null): number =>
  new Date(a ?? 0).getTime() - new Date(b ?? 0).getTime();

/** Standard relative-date filter values shared by every "Date" filter group. */
export const DATE_PRESETS = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
] as const;

/**
 * Shared predicate for a relative/absolute date filter group. `selected` is
 * either one preset value (`["today"|"7d"|"30d"]`) or a custom ISO range
 * (`["custom", from, to]`, either endpoint blank). `getDate` reads the item's
 * timestamp.
 */
export function matchesDateFilter<T>(
  item: T,
  selected: string[],
  getDate: (item: T) => string | null | undefined,
): boolean {
  const raw = getDate(item);
  if (!raw) return false;
  const t = new Date(raw).getTime();
  const now = Date.now();
  const day = 86_400_000;

  const [head, from, to] = selected;
  if (head === "today") return now - t < day;
  if (head === "7d") return now - t < 7 * day;
  if (head === "30d") return now - t < 30 * day;
  if (head === "custom") {
    if (from && t < new Date(from).getTime()) return false;
    // Include the whole "to" day by extending to its end.
    if (to && t > new Date(to).getTime() + day - 1) return false;
    return true;
  }
  return true;
}
