import { memo, useCallback, useMemo, useState, type ReactNode } from "react";
import { Alert, Badge, Button, Checkbox, Group, MultiSelect, Stack, Text } from "@mantine/core";
import { IconShare, IconUsers } from "@tabler/icons-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { ShareableResourceType, ShareBatchItem } from "../api/shares";
import { getUserId } from "../api/session";
import { useDictionaryOptions } from "../hooks/useDictionaryOptions";
import { usePagedSort } from "../hooks/usePagedSort";
import { isString, isStringArray, useStoredState } from "../hooks/useStoredState";
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
import { pickLocalized } from "../utils/localized";
import { loadErrorMessage } from "../utils/saveError";
import EmptyState from "./EmptyState";
import ListToolbar from "./ListToolbar";
import MassShareDialog, { type MassShareKind } from "./MassShareDialog";
import MetaStrip, { type MetaStripItem } from "./MetaStrip";
import PageHeader from "./PageHeader";
import PaginationBar from "./PaginationBar";
import PersonCell from "./PersonCell";
import ResponsiveTable from "./ResponsiveTable";
import SortHeader from "./SortHeader";
import TableLoadingRow from "./TableLoadingRow";

/** A kind-specific column after the six person columns (the reviews' Status and Overall). */
export type MassShareColumn = {
  key: string;
  header: (t: TFunction) => string;
  /** Set to make the header sortable by that field. */
  sortField?: MassShareSortField;
  cell: (row: MassShareRow, t: TFunction) => ReactNode;
};

/** A kind's own facets: their stored state lives with the kind's page, the shell only composes them. */
export type MassShareExtraFilters = {
  /** Merged over the shell's people facets. Memoized by the caller — it is a filter dependency. */
  values: Partial<MassShareFilters>;
  /** How many of the extra facets are active (counts toward the toolbar's badge). */
  activeCount: number;
  /** The stored picks, for the page-reset dependency list (stable references, constant length). */
  deps: readonly unknown[];
  onClear: () => void;
  /** The facet inputs, rendered after the people facets. */
  children: ReactNode;
};

export type MassSharePageProps = {
  resourceType: ShareableResourceType;
  kind: MassShareKind;
  /** The view-settings namespace (`lettuce.viewSettings.<settingsKey>.*`) — filters, sort, page size. */
  settingsKey: string;
  backTo: string;
  /** The destination's name, fed to the shared "Back to …" template. */
  backLabel: string;
  title: string;
  description: string;
  /** The label the caller reads as in the direct-manager column and facet. */
  youLabel: string;
  /** The person column's header (and its compact-row label). */
  personLabel: string;
  /** Every candidate row, built by the kind's page; `[]` until `ready`. */
  rows: MassShareRow[];
  /** The candidates read has answered (an empty answer is "nobody to share", not "still loading"). */
  ready: boolean;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  /** Why a row cannot be selected, as text (the checkbox's accessible name); null for a shareable row. */
  reasonText: (row: MassShareRow, t: TFunction) => string | null;
  /** Cells shown before the shell's own Selected/Shareable/People counters. */
  extraMeta?: MetaStripItem[];
  extraFilters?: MassShareExtraFilters;
  extraColumns?: readonly MassShareColumn[];
  /** After a run settled: refetch the candidates. The selection is already updated by the shell. */
  onSettled: () => void;
};

/** The picks of a stored facet that still exist among its options (a stale pick must never hide everyone). */
function keepKnown(values: string[], options: readonly { value: string }[], ready = true): string[] {
  return ready ? values.filter((v) => options.some((o) => o.value === v)) : values;
}

const NO_COLUMNS: readonly MassShareColumn[] = [];

/**
 * The mass-share picker's shell (v4.10.0 as the reviews page, kind-generic since v4.11.0): the
 * people in the caller's reporting line, narrowed client-side by facets, selected (incl. "select
 * all matching") and shared in one batch through `MassShareDialog`. People the caller cannot share
 * stay listed, greyed out with the reason. A kind's page supplies the candidate rows, its extra
 * facets/columns and the wording; identity never comes from the URL — names are the fetched rows'.
 * The selection is plain state (never persisted), so mount this keyed by whatever scopes the rows.
 */
export default function MassSharePage({
  resourceType,
  kind,
  settingsKey,
  backTo,
  backLabel,
  title,
  description,
  youLabel,
  personLabel,
  rows: allRows,
  ready: dataReady,
  isLoading,
  isError,
  error,
  reasonText,
  extraMeta = [],
  extraFilters,
  extraColumns = NO_COLUMNS,
  onSettled,
}: MassSharePageProps) {
  const { t, i18n } = useTranslation();
  const currentUserId = getUserId();
  const context = kind === "reviews" ? undefined : kind;

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

  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [dialogOpen, setDialogOpen] = useState(false);

  const pathDict = useDictionaryOptions("career-paths");
  const specDict = useDictionaryOptions("career-specializations");
  const seniorityDict = useDictionaryOptions("seniority-levels");
  const notSetLabel = t("career.pyramid.notSet");
  const pathOptions = useMemo(
    () => [{ value: MASS_SHARE_UNSET, label: notSetLabel }, ...pathDict.options],
    [pathDict.options, notSetLabel],
  );
  const specOptions = useMemo(
    () => [{ value: MASS_SHARE_UNSET, label: notSetLabel }, ...specDict.options],
    [specDict.options, notSetLabel],
  );
  const seniorityOptions = useMemo(
    () => [{ value: MASS_SHARE_UNSET, label: notSetLabel }, ...seniorityDict.options],
    [seniorityDict.options, notSetLabel],
  );

  const teamOpts = useMemo(() => teamOptions(allRows).map((n) => ({ value: n, label: n })), [allRows]);
  const managerOpts = useMemo(() => managerOptions(allRows, currentUserId, youLabel), [allRows, currentUserId, youLabel]);

  const pathReady = !pathDict.loading;
  const specReady = !specDict.loading;
  const seniorityReady = !seniorityDict.loading;
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
  const filtersActive = activeFilterCount > 0;

  const { page, setPage, pageSize, setPageSize, sortField, sortDir, toggleSort } = usePagedSort<MassShareSortField>(
    "name",
    // The STORED picks (stable references), never the per-render pruned copies.
    [query, teamNames, managerIds, pathIds, specIds, seniorityIds, ...(extraFilters?.deps ?? [])],
    { key: settingsKey, sortFields: MASS_SHARE_SORT_FIELDS },
  );

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
  const shareableMatching = useMemo(
    () => filteredRows.filter((r) => r.shareable).length,
    [filteredRows],
  );

  // What a submission would actually include (the count the dialog and the button both show).
  const submittable = useMemo(() => submittableRows(allRows, selected), [allRows, selected]);
  const selectedCount = submittable.length;
  const hiddenSelected = useMemo(() => {
    const filteredIds = new Set(filteredRows.map((r) => r.person.userId));
    return submittable.filter((r) => !filteredIds.has(r.person.userId)).length;
  }, [filteredRows, submittable]);
  const pageShareable = pageRows.filter((r) => r.shareable);
  const pageAllSelected = pageShareable.length > 0 && pageShareable.every((r) => selected.has(r.person.userId));
  const pageSomeSelected = pageShareable.some((r) => selected.has(r.person.userId));

  function clearFilters() {
    setQuery("");
    setTeamNames([]);
    setManagerIds([]);
    setPathIds([]);
    setSpecIds([]);
    setSeniorityIds([]);
    extraFilters?.onClear();
  }

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

  // The checkbox column, the six person columns, then the kind's own.
  const columnCount = 7 + extraColumns.length;
  const noPeople = dataReady && allRows.length === 0;

  return (
    <Stack gap="md">
      <PageHeader
        back={{
          to: backTo,
          label: t("feedback.backToLabel", { label: backLabel }),
        }}
        title={title}
        description={description}
      />

      <MetaStrip
        items={[
          ...extraMeta,
          { key: "selected", label: t("sharing.massShare.meta.selected"), value: selectedCount },
          { key: "shareable", label: t("sharing.massShare.meta.shareable"), value: shareableMatching },
          {
            key: "people",
            label: t("sharing.massShare.meta.people"),
            value: filtersActive
              ? t("sharing.massShare.peopleOf", { count: filteredRows.length, total: allRows.length })
              : allRows.length,
          },
        ]}
      />

      {isError && (
        <Alert color="red" variant="light" title={t("sharing.massShare.loadError")}>
          {loadErrorMessage(error, t)}
        </Alert>
      )}

      {noPeople ? (
        <EmptyState
          icon={<IconUsers size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
          label={t("sharing.massShare.noReports")}
        />
      ) : (
        <>
          <ListToolbar
            search={{
              label: t("sharing.massShare.searchLabel"),
              value: query,
              onChange: setQuery,
              clearLabel: t("sharing.massShare.searchClear"),
            }}
            filters={{
              activeCount: activeFilterCount,
              storageKey: settingsKey,
              onClear: clearFilters,
              children: (
                <>
                  <MultiSelect
                    label={t("sharing.massShare.facet.teams")}
                    data={teamOpts}
                    value={filters.teamNames}
                    onChange={setTeamNames}
                    searchable
                    clearable
                    w={220}
                  />
                  <MultiSelect
                    label={t("sharing.massShare.facet.manager")}
                    description={t("sharing.massShare.facet.managerHint")}
                    data={managerOpts}
                    value={filters.managerIds}
                    onChange={setManagerIds}
                    searchable
                    clearable
                    w={280}
                  />
                  <MultiSelect
                    label={t("common.field.careerPath")}
                    data={pathOptions}
                    value={filters.careerPathIds}
                    onChange={setPathIds}
                    searchable
                    clearable
                    w={220}
                  />
                  <MultiSelect
                    label={t("performanceReview.dashboard.specialty")}
                    data={specOptions}
                    value={filters.careerSpecializationIds}
                    onChange={setSpecIds}
                    searchable
                    clearable
                    w={220}
                  />
                  <MultiSelect
                    label={t("common.field.seniorityLevel")}
                    data={seniorityOptions}
                    value={filters.seniorityLevelIds}
                    onChange={setSeniorityIds}
                    searchable
                    clearable
                    w={220}
                  />
                  {extraFilters?.children}
                </>
              ),
            }}
          />

          <Group gap="sm" align="center" wrap="wrap">
            <Button
              variant="default"
              size="xs"
              disabled={shareableMatching === 0}
              onClick={() => setSelected(selectAllMatching(selected, filteredRows))}
            >
              {t("sharing.massShare.selectAllMatching", { count: shareableMatching })}
            </Button>
            <Button variant="subtle" size="xs" disabled={selectedCount === 0} onClick={() => setSelected(new Set())}>
              {t("sharing.massShare.clearSelection")}
            </Button>
            <Button
              leftSection={<IconShare size={16} />}
              disabled={selectedCount === 0}
              onClick={() => setDialogOpen(true)}
            >
              {t("sharing.massShare.shareN", { context, count: selectedCount })}
            </Button>
            {hiddenSelected > 0 && (
              <Text size="sm" c="dimmed">
                {t("sharing.massShare.hiddenSelected", { count: hiddenSelected })}
              </Text>
            )}
          </Group>

          <ResponsiveTable mode="matrix">
            <ResponsiveTable.Thead>
              <ResponsiveTable.Tr>
                <ResponsiveTable.Th>
                  <Checkbox
                    aria-label={t("sharing.massShare.selectAllOnPage")}
                    checked={pageAllSelected}
                    indeterminate={!pageAllSelected && pageSomeSelected}
                    disabled={pageShareable.length === 0}
                    onChange={() =>
                      setSelected(
                        pageAllSelected
                          ? deselectMatching(selected, pageShareable)
                          : selectAllMatching(selected, pageShareable),
                      )
                    }
                  />
                </ResponsiveTable.Th>
                <ResponsiveTable.Th sortable>
                  <SortHeader
                    field="name"
                    label={personLabel}
                    activeField={sortField}
                    activeDir={sortDir}
                    onToggle={toggleSort}
                  />
                </ResponsiveTable.Th>
                <ResponsiveTable.Th sortable>
                  <SortHeader
                    field="team"
                    label={t("performanceReview.dashboard.team")}
                    activeField={sortField}
                    activeDir={sortDir}
                    onToggle={toggleSort}
                  />
                </ResponsiveTable.Th>
                <ResponsiveTable.Th>{t("users.profile.path")}</ResponsiveTable.Th>
                <ResponsiveTable.Th>{t("performanceReview.dashboard.specialty")}</ResponsiveTable.Th>
                <ResponsiveTable.Th>{t("users.profile.seniority")}</ResponsiveTable.Th>
                <ResponsiveTable.Th>{t("sharing.massShare.col.managers")}</ResponsiveTable.Th>
                {extraColumns.map((column) =>
                  column.sortField ? (
                    <ResponsiveTable.Th key={column.key} sortable>
                      <SortHeader
                        field={column.sortField}
                        label={column.header(t)}
                        activeField={sortField}
                        activeDir={sortDir}
                        onToggle={toggleSort}
                      />
                    </ResponsiveTable.Th>
                  ) : (
                    <ResponsiveTable.Th key={column.key}>{column.header(t)}</ResponsiveTable.Th>
                  ),
                )}
              </ResponsiveTable.Tr>
            </ResponsiveTable.Thead>
            <ResponsiveTable.Tbody>
              {isLoading ? (
                <TableLoadingRow colSpan={columnCount} />
              ) : pageRows.length > 0 ? (
                pageRows.map((row) => (
                  <MassShareTableRow
                    key={row.person.userId}
                    row={row}
                    checked={selected.has(row.person.userId)}
                    onToggle={toggleRow}
                    currentUserId={currentUserId}
                    personLabel={personLabel}
                    reasonText={reasonText}
                    extraColumns={extraColumns}
                  />
                ))
              ) : !isError ? (
                <ResponsiveTable.Tr>
                  <ResponsiveTable.Td colSpan={columnCount}>
                    <EmptyState
                      icon={<IconUsers size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
                      label={t("sharing.massShare.empty")}
                    />
                  </ResponsiveTable.Td>
                </ResponsiveTable.Tr>
              ) : null}
            </ResponsiveTable.Tbody>
          </ResponsiveTable>

          <PaginationBar
            total={filteredRows.length}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            rowsPerPageLabelKey="sharing.massShare.rowsPerPage"
          />
        </>
      )}

      <MassShareDialog
        opened={dialogOpen}
        onClose={() => setDialogOpen(false)}
        resourceType={resourceType}
        kind={kind}
        rows={allRows}
        selected={selected}
        onSettled={handleSettled}
      />
    </Stack>
  );
}

/** One person: checkbox (disabled with the reason as its name when unshareable), the profile cells, the kind's cells. */
const MassShareTableRow = memo(function MassShareTableRow({
  row,
  checked,
  onToggle,
  currentUserId,
  personLabel,
  reasonText,
  extraColumns,
}: {
  row: MassShareRow;
  checked: boolean;
  onToggle: (userId: number, checked: boolean) => void;
  currentUserId: number | null;
  personLabel: string;
  reasonText: MassSharePageProps["reasonText"];
  extraColumns: readonly MassShareColumn[];
}) {
  const { t, i18n } = useTranslation();
  const p = row.person;
  const lang = i18n.resolvedLanguage;
  const dict = (entry: typeof p.careerPath) => (entry ? pickLocalized(entry.values, lang) : "—");
  return (
    // Unshareable rows read as dimmed text on the AA-checked token — never `opacity`, which
    // would take the cells under the contrast floor.
    <ResponsiveTable.Tr c={row.shareable ? undefined : "dimmed"}>
      <ResponsiveTable.Td>
        <Checkbox
          aria-label={
            row.shareable
              ? t("sharing.massShare.selectAria", { name: p.name })
              : t("sharing.massShare.unavailableAria", { name: p.name, reason: reasonText(row, t) ?? "" })
          }
          checked={checked && row.shareable}
          disabled={!row.shareable}
          onChange={(e) => onToggle(p.userId, e.currentTarget.checked)}
        />
      </ResponsiveTable.Td>
      <ResponsiveTable.Td label={personLabel}>
        <Group gap="xs" wrap="wrap">
          <PersonCell userId={p.userId} name={p.name} currentUserId={currentUserId} />
          {p.deactivated && (
            <Badge variant="light" color="gray">
              {t("users.inactiveBadge")}
            </Badge>
          )}
        </Group>
      </ResponsiveTable.Td>
      <ResponsiveTable.Td label={t("performanceReview.dashboard.team")}>
        <Group gap={4}>
          {row.teamNames.map((name) => (
            <Badge key={name} variant="light" color="gray">
              {name}
            </Badge>
          ))}
        </Group>
      </ResponsiveTable.Td>
      <ResponsiveTable.Td label={t("users.profile.path")}>
        <Text size="sm" c={p.careerPath ? undefined : "dimmed"}>
          {dict(p.careerPath)}
        </Text>
      </ResponsiveTable.Td>
      <ResponsiveTable.Td label={t("performanceReview.dashboard.specialty")}>
        <Text size="sm" c={p.careerSpecialization ? undefined : "dimmed"}>
          {dict(p.careerSpecialization)}
        </Text>
      </ResponsiveTable.Td>
      <ResponsiveTable.Td label={t("users.profile.seniority")}>
        <Text size="sm" c={p.seniorityLevel ? undefined : "dimmed"}>
          {dict(p.seniorityLevel)}
        </Text>
      </ResponsiveTable.Td>
      <ResponsiveTable.Td label={t("sharing.massShare.col.managers")}>
        <Text size="sm" c={row.managerLabel ? undefined : "dimmed"}>
          {row.managerLabel || "—"}
        </Text>
      </ResponsiveTable.Td>
      {extraColumns.map((column) => (
        <ResponsiveTable.Td key={column.key} label={column.header(t)}>
          {column.cell(row, t)}
        </ResponsiveTable.Td>
      ))}
    </ResponsiveTable.Tr>
  );
});
