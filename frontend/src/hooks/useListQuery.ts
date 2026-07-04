import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import type { ListConfig, ListQueryState } from "@/lib/listQuery";

/** One rendered active-filter chip. */
export interface ActiveChip {
  groupId: string;
  /** The selected raw value this chip removes (present for multi/single). */
  value: string;
  label: string;
}

export interface ListQuery<T> {
  /** Immediate search text (drives the input). */
  search: string;
  setSearch: (v: string) => void;
  /** Debounced search text (drives filtering + the URL). */
  debouncedSearch: string;
  sort: string;
  setSort: (v: string) => void;
  /** group id -> selected values. */
  filters: Record<string, string[]>;
  /** Add/remove one value in a multi group (or replace in a single group). */
  toggleFilterValue: (groupId: string, value: string) => void;
  /** Replace an entire group's selection (used by date-range pickers). */
  setFilterValue: (groupId: string, values: string[]) => void;
  /** Replace EVERY group at once in a single URL write (the filter panel's Apply). */
  setFilters: (next: Record<string, string[]>) => void;
  clearFilter: (groupId: string) => void;
  clearAll: () => void;
  activeChips: ActiveChip[];
  activeFilterCount: number;
  /** The settled state to hand to `applyListQuery`. */
  state: ListQueryState;
}

/**
 * Owns the search / sort / filter state for a listing page and mirrors it to
 * the URL query string (`?q=…&sort=…&<groupId>=a,b`) so a view survives reload,
 * Back, and sharing. Pass `persist: false` for surfaces that shouldn't touch
 * the URL (e.g. the always-mounted sessions sidebar), which keeps the same
 * state in memory instead.
 */
export function useListQuery<T>(
  config: ListConfig<T>,
  opts: { persist?: boolean } = {},
): ListQuery<T> {
  const persist = opts.persist ?? true;
  const groupIds = useMemo(
    () => config.filters.map((g) => g.id),
    [config.filters],
  );

  // --- source of truth: URL params, or a local mirror when not persisting ---
  const [urlParams, setUrlParams] = useSearchParams();
  const [localParams, setLocalParams] = useState<URLSearchParams>(
    () => new URLSearchParams(),
  );
  const params = persist ? urlParams : localParams;

  const patchParams = useCallback(
    (mutate: (p: URLSearchParams) => void) => {
      const apply = (prev: URLSearchParams) => {
        const next = new URLSearchParams(prev);
        mutate(next);
        return next;
      };
      if (persist) setUrlParams(apply, { replace: true });
      else setLocalParams(apply);
    },
    [persist, setUrlParams],
  );

  // --- search: local input for responsiveness, debounced into the params ---
  const [search, setSearch] = useState(() => params.get("q") ?? "");
  const debouncedSearch = useDebouncedValue(search, 200);

  useEffect(() => {
    const current = params.get("q") ?? "";
    if (debouncedSearch === current) return;
    patchParams((p) => {
      if (debouncedSearch) p.set("q", debouncedSearch);
      else p.delete("q");
    });
    // params intentionally omitted: we only react to the debounced value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  // --- sort ---
  const sort = params.get("sort") ?? config.defaultSort;
  const setSort = useCallback(
    (v: string) =>
      patchParams((p) => {
        if (v === config.defaultSort) p.delete("sort");
        else p.set("sort", v);
      }),
    [patchParams, config.defaultSort],
  );

  // --- filters ---
  const filters = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const id of groupIds) {
      const raw = params.get(id);
      out[id] = raw ? raw.split(",").filter(Boolean) : [];
    }
    return out;
  }, [params, groupIds]);

  const writeGroup = useCallback(
    (groupId: string, values: string[]) =>
      patchParams((p) => {
        if (values.length) p.set(groupId, values.join(","));
        else p.delete(groupId);
      }),
    [patchParams],
  );

  const toggleFilterValue = useCallback(
    (groupId: string, value: string) => {
      const group = config.filters.find((g) => g.id === groupId);
      const current = filters[groupId] ?? [];
      let next: string[];
      if (group?.kind === "single") {
        next = current.includes(value) ? [] : [value];
      } else {
        next = current.includes(value)
          ? current.filter((v) => v !== value)
          : [...current, value];
      }
      writeGroup(groupId, next);
    },
    [config.filters, filters, writeGroup],
  );

  const setFilterValue = useCallback(
    (groupId: string, values: string[]) => writeGroup(groupId, values),
    [writeGroup],
  );

  // Commit every group in ONE param write. Writing each group with a separate
  // `setFilterValue` call would clobber the others: react-router's functional
  // updater reads the render-time params, so sibling writes in the same tick
  // don't see each other and only the last one survives.
  const setFilters = useCallback(
    (next: Record<string, string[]>) =>
      patchParams((p) => {
        for (const id of groupIds) {
          const values = next[id] ?? [];
          if (values.length) p.set(id, values.join(","));
          else p.delete(id);
        }
      }),
    [patchParams, groupIds],
  );

  const clearFilter = useCallback(
    (groupId: string) => writeGroup(groupId, []),
    [writeGroup],
  );

  const clearAll = useCallback(() => {
    setSearch("");
    patchParams((p) => {
      p.delete("q");
      for (const id of groupIds) p.delete(id);
    });
  }, [patchParams, groupIds]);

  // --- active chips (one per selected value; date ranges collapse to one) ---
  const activeChips = useMemo<ActiveChip[]>(() => {
    const chips: ActiveChip[] = [];
    for (const group of config.filters) {
      const selected = filters[group.id] ?? [];
      if (!selected.length) continue;
      if (group.kind === "date") {
        chips.push({
          groupId: group.id,
          value: "",
          label: `${group.label}: ${dateChipLabel(selected)}`,
        });
        continue;
      }
      for (const value of selected) {
        const opt = group.options?.find((o) => o.value === value);
        chips.push({
          groupId: group.id,
          value,
          label: `${group.label}: ${opt?.label ?? value}`,
        });
      }
    }
    return chips;
  }, [config.filters, filters]);

  const activeFilterCount = useMemo(
    () =>
      groupIds.reduce(
        (n, id) => n + ((filters[id]?.length ?? 0) > 0 ? 1 : 0),
        0,
      ),
    [groupIds, filters],
  );

  const state = useMemo<ListQueryState>(
    () => ({ search: debouncedSearch, sort, filters }),
    [debouncedSearch, sort, filters],
  );

  return {
    search,
    setSearch,
    debouncedSearch,
    sort,
    setSort,
    filters,
    toggleFilterValue,
    setFilterValue,
    setFilters,
    clearFilter,
    clearAll,
    activeChips,
    activeFilterCount,
    state,
  };
}

/** Human label for a date filter's selection (preset name or custom range). */
function dateChipLabel(selected: string[]): string {
  const [head, from, to] = selected;
  if (head === "today") return "Today";
  if (head === "7d") return "Last 7 days";
  if (head === "30d") return "Last 30 days";
  if (head === "custom") {
    const f = from ? new Date(from).toLocaleDateString() : "…";
    const t = to ? new Date(to).toLocaleDateString() : "…";
    return `${f} – ${t}`;
  }
  return head ?? "";
}
