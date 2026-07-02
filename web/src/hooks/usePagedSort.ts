import { useEffect, useState } from "react";
import type { SortDir } from "../components/SortHeader";

export const PAGE_SIZE_OPTIONS = [20, 40, 60] as const;
export const DEFAULT_PAGE_SIZE = 20;

// Shared pagination + sort state for the list tables. `filterDeps` lists the
// (debounced) filter values the table queries with; whenever one of them — or
// the sort — changes, `page` resets to 1 so the new result set starts from its
// first page. `setPageSize` resets `page` too, so switching rows-per-page never
// strands the user past the last page.
export function usePagedSort<F extends string>(initialSortField: F, filterDeps: unknown[]) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [sortField, setSortField] = useState<F>(initialSortField);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...filterDeps, sortField, sortDir]);

  const sortParam = `${sortDir === "desc" ? "-" : ""}${sortField}`;

  function toggleSort(field: F) {
    if (field === sortField) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  function changePageSize(size: number) {
    setPageSize(size);
    setPage(1);
  }

  return {
    page,
    setPage,
    pageSize,
    setPageSize: changePageSize,
    sortField,
    sortDir,
    sortParam,
    toggleSort,
  };
}
