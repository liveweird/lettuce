import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ShareBatchItem } from "../api/shares";
import { getUserId } from "../api/session";
import type { MassShareExtraFilters } from "../components/massShareTypes";
import {
  deselectMatching,
  EMPTY_MASS_SHARE_FILTERS,
  filterMassShareRows,
  managerOptions,
  MASS_SHARE_SORT_FIELDS,
  MASS_SHARE_UNSET,
  retainUnsettled,
  selectAllMatching,
  sortMassShareRows,
  submittableRows,
  teamOptions,
  type MassShareFilters,
  type MassShareRow,
  type MassShareSortField,
} from "../utils/massShare";
import { useDictionaryOptions } from "./useDictionaryOptions";
import { usePagedSort } from "./usePagedSort";
import { isString, isStringArray, useStoredState } from "./useStoredState";

type Option = { value: string; label: string };

/** The picks of a stored facet that still exist among its options (a stale pick must never hide everyone). */
function keepKnown(values: string[], options: readonly { value: string }[], ready = true): string[] {
  return ready ? values.filter((v) => options.some((o) => o.value === v)) : values;
}

/** A dictionary's options behind the leading "Not set" entry the facets offer. */
function useUnsetFirstOptions(name: "career-paths" | "career-specializations" | "seniority-levels", notSet: string) {
  const dict = useDictionaryOptions(name);
  const options = useMemo<Option[]>(
    () => [{ value: MASS_SHARE_UNSET, label: notSet }, ...dict.options],
    [dict.options, notSet],
  );
  return { options, ready: !dict.loading };
}

/** What the facet inputs need: the pruned values, their options and the setters of the STORED picks. */
export type MassShareFacetState = {
  filters: MassShareFilters;
  teamOpts: Option[];
  managerOpts: Option[];
  pathOptions: Option[];
  specOptions: Option[];
  seniorityOptions: Option[];
  setTeamNames: (v: string[]) => void;
  setManagerIds: (v: string[]) => void;
  setPathIds: (v: string[]) => void;
  setSpecIds: (v: string[]) => void;
  setSeniorityIds: (v: string[]) => void;
};

type StateInput = {
  settingsKey: string;
  youLabel: string;
  rows: MassShareRow[];
  ready: boolean;
  extraFilters?: MassShareExtraFilters;
};

/** Stored filters, their live options, the pruned filter set and the filtered/sorted/paged rows. */
function useMassShareFilters({ settingsKey, youLabel, rows: allRows, ready: dataReady, extraFilters }: StateInput) {
  const { t, i18n } = useTranslation();
  const currentUserId = getUserId();

  const [query, setQuery] = useStoredState(`${settingsKey}.filter.name`, "", isString);
  const [teamNames, setTeamNames] = useStoredState<string[]>(`${settingsKey}.filter.teams`, [], isStringArray);
  const [managerIds, setManagerIds] = useStoredState<string[]>(`${settingsKey}.filter.managers`, [], isStringArray);
  const [pathIds, setPathIds] = useStoredState<string[]>(`${settingsKey}.filter.careerPath`, [], isStringArray);
  const [specIds, setSpecIds] = useStoredState<string[]>(
    `${settingsKey}.filter.careerSpecialization`, [], isStringArray,
  );
  const [seniorityIds, setSeniorityIds] = useStoredState<string[]>(
    `${settingsKey}.filter.seniorityLevel`, [], isStringArray,
  );

  const notSetLabel = t("career.pyramid.notSet");
  const { options: pathOptions, ready: pathReady } = useUnsetFirstOptions("career-paths", notSetLabel);
  const { options: specOptions, ready: specReady } = useUnsetFirstOptions("career-specializations", notSetLabel);
  const { options: seniorityOptions, ready: seniorityReady } = useUnsetFirstOptions("seniority-levels", notSetLabel);

  const teamOpts = useMemo(() => teamOptions(allRows).map((n) => ({ value: n, label: n })), [allRows]);
  const managerOpts = useMemo(() => managerOptions(allRows, currentUserId, youLabel), [allRows, currentUserId, youLabel]);

  const extraValues = extraFilters?.values;
  // Stored picks pruned against the live options (a stale pick must never hide everyone); memoized
  // so the filter/sort below only re-runs when an input really changed.
  const filters = useMemo<MassShareFilters>(
    () => ({
      ...EMPTY_MASS_SHARE_FILTERS,
      teamNames: keepKnown(teamNames, teamOpts, dataReady),
      managerIds: keepKnown(managerIds, managerOpts, dataReady),
      careerPathIds: keepKnown(pathIds, pathOptions, pathReady),
      careerSpecializationIds: keepKnown(specIds, specOptions, specReady),
      seniorityLevelIds: keepKnown(seniorityIds, seniorityOptions, seniorityReady),
      ...extraValues,
    }),
    [
      teamNames, teamOpts, managerIds, managerOpts, pathIds, pathOptions, specIds, specOptions,
      seniorityIds, seniorityOptions, extraValues, dataReady, pathReady, specReady, seniorityReady,
    ],
  );
  const activeFilterCount =
    (query.trim() ? 1 : 0) +
    filters.teamNames.length +
    filters.managerIds.length +
    filters.careerPathIds.length +
    filters.careerSpecializationIds.length +
    filters.seniorityLevelIds.length +
    (extraFilters?.activeCount ?? 0);

  const paging = usePagedSort<MassShareSortField>(
    "name",
    // The STORED picks (stable references), never the per-render pruned copies.
    [query, teamNames, managerIds, pathIds, specIds, seniorityIds, ...(extraFilters?.deps ?? [])],
    { key: settingsKey, sortFields: MASS_SHARE_SORT_FIELDS },
  );
  const { page, pageSize, sortField, sortDir } = paging;

  // Client-side over the one dataset; memoized so a checkbox toggle (selection state) never re-filters
  // or re-sorts the list (100+ people).
  const filteredRows = useMemo(
    () => sortMassShareRows(filterMassShareRows(allRows, filters, query), sortField, sortDir, i18n.resolvedLanguage),
    [allRows, filters, query, sortField, sortDir, i18n.resolvedLanguage],
  );
  const pageRows = useMemo(
    () => filteredRows.slice((page - 1) * pageSize, page * pageSize),
    [filteredRows, page, pageSize],
  );
  const shareableMatching = useMemo(() => filteredRows.filter((r) => r.shareable).length, [filteredRows]);

  function clearFilters() {
    setQuery("");
    setTeamNames([]);
    setManagerIds([]);
    setPathIds([]);
    setSpecIds([]);
    setSeniorityIds([]);
    extraFilters?.onClear();
  }

  const facets: MassShareFacetState = {
    filters,
    teamOpts,
    managerOpts,
    pathOptions,
    specOptions,
    seniorityOptions,
    setTeamNames,
    setManagerIds,
    setPathIds,
    setSpecIds,
    setSeniorityIds,
  };
  return {
    query,
    setQuery,
    facets,
    activeFilterCount,
    filtersActive: activeFilterCount > 0,
    clearFilters,
    paging,
    filteredRows,
    pageRows,
    shareableMatching,
  };
}

/** The selection (plain state, never persisted) over the filtered/paged rows, and what a run settles. */
function useMassShareSelection(
  allRows: MassShareRow[],
  filteredRows: MassShareRow[],
  pageRows: MassShareRow[],
  onSettled: () => void,
) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set());

  // What a submission would actually include (the count the dialog and the button both show).
  const submittable = useMemo(() => submittableRows(allRows, selected), [allRows, selected]);
  const hiddenSelected = useMemo(() => {
    const filteredIds = new Set(filteredRows.map((r) => r.person.userId));
    return submittable.filter((r) => !filteredIds.has(r.person.userId)).length;
  }, [filteredRows, submittable]);
  const pageShareable = pageRows.filter((r) => r.shareable);
  const pageAllSelected = pageShareable.length > 0 && pageShareable.every((r) => selected.has(r.person.userId));
  const pageSomeSelected = pageShareable.some((r) => selected.has(r.person.userId));

  const toggleRow = useCallback((userId: number, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(userId);
      else next.delete(userId);
      return next;
    });
  }, []);

  function handleSettled(items: readonly ShareBatchItem[], rowsAtRun: MassShareRow[]) {
    // People answered for every recipient leave the selection; the rest stay for a retry. The
    // PRE-run rows decide who answered — the refetch below may already have changed the list.
    setSelected((prev) => retainUnsettled(prev, rowsAtRun, items));
    onSettled();
  }

  return {
    selected,
    selectedCount: submittable.length,
    hiddenSelected,
    pageSelection: { shareableCount: pageShareable.length, allSelected: pageAllSelected, someSelected: pageSomeSelected },
    toggleRow,
    togglePage: () =>
      setSelected(pageAllSelected ? deselectMatching(selected, pageShareable) : selectAllMatching(selected, pageShareable)),
    selectAllMatching: () => setSelected(selectAllMatching(selected, filteredRows)),
    clearSelection: () => setSelected(new Set()),
    handleSettled,
  };
}

/**
 * The mass-share shell's state (checkup #38 M6, split out of `MassSharePage`): the stored facets
 * and their pruned filter set, the one filtered/sorted/paged client-side dataset, and the
 * selection with its select-all/page/settled transitions. The page only lays the pieces out.
 */
export function useMassShareState(input: StateInput & { onSettled: () => void }) {
  const filtering = useMassShareFilters(input);
  const selection = useMassShareSelection(input.rows, filtering.filteredRows, filtering.pageRows, input.onSettled);
  return { ...filtering, ...selection };
}
