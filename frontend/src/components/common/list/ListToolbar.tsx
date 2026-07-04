import type { ReactNode } from "react";
import type { ListConfig } from "@/lib/listQuery";
import type { ListQuery } from "@/hooks/useListQuery";
import { SearchBar } from "./SearchBar";
import { SortMenu } from "./SortMenu";
import { FilterControl } from "./FilterControl";
import { ActiveFilterChips } from "./ActiveFilterChips";

/**
 * The consistent listing header used across pages: a full-width search bar with
 * a `[Sort ▼] [Filter ▼]` row beneath, then removable active-filter chips.
 * Wires a page's `ListConfig` to its `useListQuery` state; `extra` slots page-
 * specific controls (e.g. a multi-select toggle) into the sort/filter row.
 */
export function ListToolbar<T>({
  config,
  query,
  placeholder,
  extra,
  className,
}: {
  config: ListConfig<T>;
  query: ListQuery<T>;
  placeholder?: string;
  extra?: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchBar
          value={query.search}
          onChange={query.setSearch}
          placeholder={placeholder}
        />
        <div className="flex items-center gap-2">
          <SortMenu
            options={config.sorts}
            value={query.sort}
            onChange={query.setSort}
          />
          {config.filters.length > 0 && (
            <FilterControl
              groups={config.filters}
              filters={query.filters}
              activeCount={query.activeFilterCount}
              onApply={(draft) => query.setFilters(draft)}
              onClearAll={query.clearAll}
            />
          )}
          {extra}
        </div>
      </div>
      {query.activeChips.length > 0 && (
        <ActiveFilterChips
          className="mt-3"
          chips={query.activeChips}
          onRemove={query.toggleFilterValue}
          onRemoveGroup={query.clearFilter}
          onClearAll={query.clearAll}
        />
      )}
    </div>
  );
}
