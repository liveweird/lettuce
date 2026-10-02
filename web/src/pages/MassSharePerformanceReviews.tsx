import { memo, useCallback, useMemo, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { Alert, Badge, Button, Checkbox, Group, MultiSelect, Select, Stack, Text } from "@mantine/core";
import { IconShare, IconUsers } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { listShareCandidates } from "../api/reviews";
import type { ShareBatchItem } from "../api/shares";
import { getUserId, hasFeature } from "../api/session";
import EmptyState from "../components/EmptyState";
import ListToolbar from "../components/ListToolbar";
import MassShareDialog from "../components/MassShareDialog";
import MetaStrip from "../components/MetaStrip";
import PageHeader from "../components/PageHeader";
import PaginationBar from "../components/PaginationBar";
import PerformanceReviewStatusBadge from "../components/PerformanceReviewStatusBadge";
import PersonCell from "../components/PersonCell";
import RatingBadge from "../components/RatingBadge";
import ResponsiveTable from "../components/ResponsiveTable";
import SortHeader from "../components/SortHeader";
import TableLoadingRow from "../components/TableLoadingRow";
import { useDictionaryOptions } from "../hooks/useDictionaryOptions";
import { usePagedSort } from "../hooks/usePagedSort";
import { useReviewPeriodOptions } from "../hooks/useReviewPeriodOptions";
import { isOneOf, isStringArray, isString, useStoredState } from "../hooks/useStoredState";
import {
  buildMassShareRows,
  deselectMatching,
  EMPTY_MASS_SHARE_FILTERS,
  filterMassShareRows,
  managerOptions,
  MASS_SHARE_SORT_FIELDS,
  MASS_SHARE_STATUS_VALUES,
  MASS_SHARE_UNSET,
  reasonKey,
  retainUnsettled,
  selectAllMatching,
    sortMassShareRows,
  submittableRows,
  teamOptions,
  type MassShareFilters,
  type MassShareRow,
  type MassShareSortField,
  type MassShareStatus,
} from "../utils/massShare";
import { loadErrorMessage } from "../utils/saveError";
import { RATING_VALUES, ratingOptions } from "../utils/reviewRatings";
import { pickLocalized } from "../utils/localized";

const SETTINGS_KEY = "massShare";
const BACK_TO = "/performance?tab=managed";

// "" (off) or one of the rating scale's values — a stale stored value must not silently hide everyone.
const MIN_OVERALL_VALUES = ["", ...RATING_VALUES.map(String)] as const;

const isStatusArray = (v: unknown): v is MassShareStatus[] =>
  isStringArray(v) && v.every((s) => (MASS_SHARE_STATUS_VALUES as readonly string[]).includes(s));

/** The picks of a stored facet that still exist among its options (a stale pick must never hide everyone). */
function keepKnown(values: string[], options: readonly { value: string }[], ready = true): string[] {
  return ready ? values.filter((v) => options.some((o) => o.value === v)) : values;
}

/** `periodId` from the URL: a positive integer or null (missing/malformed — the page bounces away). */
function parsePeriodId(raw: string | null): number | null {
  return raw != null && /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : null;
}

/**
 * The mass-share picker (v4.10.0, `/performance-reviews/mass-share?periodId=`): everyone in the
 * caller's reporting line for ONE review period, narrowed client-side by facets, selected
 * (incl. "select all matching") and shared in one batch through `MassShareDialog`. People the
 * caller cannot share (no review, another manager's draft) stay listed, greyed out with the reason.
 * Identity never comes from the URL — names are the fetched rows'.
 */
export default function MassSharePerformanceReviews() {
  const [searchParams] = useSearchParams();
  if (!hasFeature("PERFORMANCE_REVIEWS")) return <Navigate to="/" replace />;
  const periodId = parsePeriodId(searchParams.get("periodId"));
  if (periodId == null) return <Navigate to={BACK_TO} replace />;
  // Keyed by period so the selection (plain state, never persisted) cannot leak across periods.
  return <MassShareContent key={periodId} periodId={periodId} />;
}

function MassShareContent({ periodId }: { periodId: number }) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const currentUserId = getUserId();
  const youLabel = t("performanceReview.massShare.you");

  const [query, setQuery] = useStoredState(`${SETTINGS_KEY}.filter.name`, "", isString);
  const [teamNames, setTeamNames] = useStoredState<string[]>(`${SETTINGS_KEY}.filter.teams`, [], isStringArray);
  const [managerIds, setManagerIds] = useStoredState<string[]>(`${SETTINGS_KEY}.filter.managers`, [], isStringArray);
  const [pathIds, setPathIds] = useStoredState<string[]>(`${SETTINGS_KEY}.filter.careerPath`, [], isStringArray);
  const [specIds, setSpecIds] = useStoredState<string[]>(
    `${SETTINGS_KEY}.filter.careerSpecialization`, [], isStringArray,
  );
  const [seniorityIds, setSeniorityIds] = useStoredState<string[]>(
    `${SETTINGS_KEY}.filter.seniorityLevel`, [], isStringArray,
  );
  const [statuses, setStatuses] = useStoredState<MassShareStatus[]>(`${SETTINGS_KEY}.filter.status`, [], isStatusArray);
  const [minOverall, setMinOverall] = useStoredState(
    `${SETTINGS_KEY}.filter.minOverall`, EMPTY_MASS_SHARE_FILTERS.minOverall, isOneOf(MIN_OVERALL_VALUES),
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

  const { periods, options: periodOptions, isLoading: periodsLoading } = useReviewPeriodOptions();
  const periodLabel = periodOptions.find((o) => o.value === String(periodId))?.label;

  const candidatesKey = useMemo(() => ["performanceReviews", "shareCandidates", periodId] as const, [periodId]);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: candidatesKey,
    queryFn: () => listShareCandidates(periodId),
    // The grid must not reshuffle under a half-made selection on a window refocus.
    refetchOnWindowFocus: false,
  });

  const allRows = useMemo(
    () => buildMassShareRows(data?.items ?? [], currentUserId, youLabel),
    [data, currentUserId, youLabel],
  );
  const teamOpts = useMemo(() => teamOptions(allRows).map((n) => ({ value: n, label: n })), [allRows]);
  const managerOpts = useMemo(() => managerOptions(allRows, currentUserId, youLabel), [allRows, currentUserId, youLabel]);
  const statusOpts = MASS_SHARE_STATUS_VALUES.map((s) => ({
    value: s,
    label: s === "NO_REVIEW" ? t("performanceReview.massShare.statusNoReview") : t(`performanceReview.status.${s}`),
  }));

  const dataReady = data != null;
  const pathReady = !pathDict.loading;
  const specReady = !specDict.loading;
  const seniorityReady = !seniorityDict.loading;
  // Stored picks pruned against the live options (a stale pick must never hide everyone); memoized
  // so the filter/sort below only re-runs when an input really changed.
  const filters = useMemo<MassShareFilters>(
    () => ({
      teamNames: keepKnown(teamNames, teamOpts, dataReady),
      managerIds: keepKnown(managerIds, managerOpts, dataReady),
      careerPathIds: keepKnown(pathIds, pathOptions, pathReady),
      careerSpecializationIds: keepKnown(specIds, specOptions, specReady),
      seniorityLevelIds: keepKnown(seniorityIds, seniorityOptions, seniorityReady),
      statuses,
      minOverall,
    }),
    [
      teamNames, teamOpts, managerIds, managerOpts, pathIds, pathOptions, specIds, specOptions,
      seniorityIds, seniorityOptions, statuses, minOverall, dataReady, pathReady, specReady, seniorityReady,
    ],
  );
  const activeFilterCount =
    (query.trim() ? 1 : 0) +
    filters.teamNames.length +
    filters.managerIds.length +
    filters.careerPathIds.length +
    filters.careerSpecializationIds.length +
    filters.seniorityLevelIds.length +
    filters.statuses.length +
    (minOverall ? 1 : 0);
  const filtersActive = activeFilterCount > 0;

  const { page, setPage, pageSize, setPageSize, sortField, sortDir, toggleSort } = usePagedSort<MassShareSortField>(
    "name",
    // The STORED picks (stable references), never the per-render pruned copies.
    [query, teamNames, managerIds, pathIds, specIds, seniorityIds, statuses, minOverall],
    { key: SETTINGS_KEY, sortFields: MASS_SHARE_SORT_FIELDS },
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
    () => filteredRows.filter((r) => r.candidate.shareable).length,
    [filteredRows],
  );

  // What a submission would actually include (the count the dialog and the button both show).
  const submittable = useMemo(() => submittableRows(allRows, selected), [allRows, selected]);
  const selectedCount = submittable.length;
  const hiddenSelected = useMemo(() => {
    const filteredIds = new Set(filteredRows.map((r) => r.candidate.userId));
    return submittable.filter((r) => !filteredIds.has(r.candidate.userId)).length;
  }, [filteredRows, submittable]);
  const pageShareable = pageRows.filter((r) => r.candidate.shareable);
  const pageAllSelected = pageShareable.length > 0 && pageShareable.every((r) => selected.has(r.candidate.userId));
  const pageSomeSelected = pageShareable.some((r) => selected.has(r.candidate.userId));

  function clearFilters() {
    setQuery("");
    setTeamNames([]);
    setManagerIds([]);
    setPathIds([]);
    setSpecIds([]);
    setSeniorityIds([]);
    setStatuses([]);
    setMinOverall("");
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
    void queryClient.invalidateQueries({ queryKey: candidatesKey });
  }

  if (periods != null && !periodsLoading && periodLabel == null) {
    // A period that no longer exists (a stale link): the server would 400 the candidates read.
    return <Navigate to={BACK_TO} replace />;
  }

  const columnCount = 9;
  const noPeople = data != null && data.items.length === 0;

  return (
    <Stack gap="md">
      <PageHeader
        back={{
          to: BACK_TO,
          label: t("feedback.backToLabel", { label: t("performanceReview.massShare.backLabel") }),
        }}
        title={t("performanceReview.massShare.title")}
        description={t("performanceReview.massShare.description")}
      />

      <MetaStrip
        items={[
          { key: "period", label: t("performanceReview.period"), value: periodLabel ?? "—" },
          { key: "selected", label: t("performanceReview.massShare.meta.selected"), value: selectedCount },
          { key: "shareable", label: t("performanceReview.massShare.meta.shareable"), value: shareableMatching },
          {
            key: "people",
            label: t("performanceReview.massShare.meta.people"),
            value: filtersActive
              ? t("performanceReview.massShare.peopleOf", { count: filteredRows.length, total: allRows.length })
              : allRows.length,
          },
        ]}
      />

      {isError && (
        <Alert color="red" variant="light" title={t("performanceReview.massShare.loadError")}>
          {loadErrorMessage(error, t)}
        </Alert>
      )}

      {noPeople ? (
        <EmptyState
          icon={<IconUsers size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
          label={t("performanceReview.massShare.noReports")}
        />
      ) : (
        <>
          <ListToolbar
            search={{
              label: t("performanceReview.massShare.searchLabel"),
              value: query,
              onChange: setQuery,
              clearLabel: t("performanceReview.massShare.searchClear"),
            }}
            filters={{
              activeCount: activeFilterCount,
              storageKey: SETTINGS_KEY,
              onClear: clearFilters,
              children: (
                <>
                  <MultiSelect
                    label={t("performanceReview.massShare.facet.teams")}
                    data={teamOpts}
                    value={filters.teamNames}
                    onChange={setTeamNames}
                    searchable
                    clearable
                    w={220}
                  />
                  <MultiSelect
                    label={t("performanceReview.massShare.facet.manager")}
                    description={t("performanceReview.massShare.facet.managerHint")}
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
                  <MultiSelect
                    label={t("performanceReview.massShare.facet.status")}
                    data={statusOpts}
                    value={filters.statuses}
                    onChange={(v) => setStatuses(v as MassShareStatus[])}
                    clearable
                    w={220}
                  />
                  <Select
                    label={t("performanceReview.massShare.facet.minOverall")}
                    data={ratingOptions(t)}
                    value={minOverall || null}
                    onChange={(v) => setMinOverall(v ?? "")}
                    clearable
                    w={260}
                  />
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
              {t("performanceReview.massShare.selectAllMatching", { count: shareableMatching })}
            </Button>
            <Button variant="subtle" size="xs" disabled={selectedCount === 0} onClick={() => setSelected(new Set())}>
              {t("performanceReview.massShare.clearSelection")}
            </Button>
            <Button
              leftSection={<IconShare size={16} />}
              disabled={selectedCount === 0}
              onClick={() => setDialogOpen(true)}
            >
              {t("performanceReview.massShare.shareN", { count: selectedCount })}
            </Button>
            {hiddenSelected > 0 && (
              <Text size="sm" c="dimmed">
                {t("performanceReview.massShare.hiddenSelected", { count: hiddenSelected })}
              </Text>
            )}
          </Group>

          <ResponsiveTable mode="matrix">
            <ResponsiveTable.Thead>
              <ResponsiveTable.Tr>
                <ResponsiveTable.Th>
                  <Checkbox
                    aria-label={t("performanceReview.massShare.selectAllOnPage")}
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
                    label={t("performanceReview.subordinate")}
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
                <ResponsiveTable.Th>{t("performanceReview.massShare.col.managers")}</ResponsiveTable.Th>
                <ResponsiveTable.Th sortable>
                  <SortHeader
                    field="status"
                    label={t("common.field.status")}
                    activeField={sortField}
                    activeDir={sortDir}
                    onToggle={toggleSort}
                  />
                </ResponsiveTable.Th>
                <ResponsiveTable.Th sortable>
                  <SortHeader
                    field="overall"
                    label={t("performanceReview.category.overall")}
                    activeField={sortField}
                    activeDir={sortDir}
                    onToggle={toggleSort}
                  />
                </ResponsiveTable.Th>
              </ResponsiveTable.Tr>
            </ResponsiveTable.Thead>
            <ResponsiveTable.Tbody>
              {isLoading ? (
                <TableLoadingRow colSpan={columnCount} />
              ) : pageRows.length > 0 ? (
                pageRows.map((row) => (
                  <MassShareTableRow
                    key={row.candidate.userId}
                    row={row}
                    checked={selected.has(row.candidate.userId)}
                    onToggle={toggleRow}
                    currentUserId={currentUserId}
                  />
                ))
              ) : !isError ? (
                <ResponsiveTable.Tr>
                  <ResponsiveTable.Td colSpan={columnCount}>
                    <EmptyState
                      icon={<IconUsers size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
                      label={t("performanceReview.massShare.empty")}
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
            rowsPerPageLabelKey="performanceReview.massShare.rowsPerPage"
          />
        </>
      )}

      <MassShareDialog
        opened={dialogOpen}
        onClose={() => setDialogOpen(false)}
        rows={allRows}
        selected={selected}
        onSettled={handleSettled}
      />
    </Stack>
  );
}

/** One person: checkbox (disabled with the reason as its name when unshareable), the profile cells, status, overall. */
const MassShareTableRow = memo(function MassShareTableRow({
  row,
  checked,
  onToggle,
  currentUserId,
}: {
  row: MassShareRow;
  checked: boolean;
  onToggle: (userId: number, checked: boolean) => void;
  currentUserId: number | null;
}) {
  const { t, i18n } = useTranslation();
  const c = row.candidate;
  const reason = reasonKey(row);
  const reasonText =
    reason === "noReview"
      ? t("performanceReview.massShare.reason.noReview")
      : reason === "draftBy"
        ? t("performanceReview.massShare.reason.draftBy", { name: c.review?.managerName ?? "" })
        : null;
  const lang = i18n.resolvedLanguage;
  const dict = (entry: typeof c.careerPath) => (entry ? pickLocalized(entry.values, lang) : "—");
  return (
    // Unshareable rows read as dimmed text on the AA-checked token — never `opacity`, which
    // would take the cells under the contrast floor.
    <ResponsiveTable.Tr c={c.shareable ? undefined : "dimmed"}>
      <ResponsiveTable.Td>
        <Checkbox
          aria-label={
            c.shareable
              ? t("performanceReview.massShare.selectAria", { name: c.name })
              : t("performanceReview.massShare.unavailableAria", { name: c.name, reason: reasonText ?? "" })
          }
          checked={checked && c.shareable}
          disabled={!c.shareable}
          onChange={(e) => onToggle(c.userId, e.currentTarget.checked)}
        />
      </ResponsiveTable.Td>
      <ResponsiveTable.Td label={t("performanceReview.subordinate")}>
        <Group gap="xs" wrap="wrap">
          <PersonCell userId={c.userId} name={c.name} currentUserId={currentUserId} />
          {c.deactivated && (
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
        <Text size="sm" c={c.careerPath ? undefined : "dimmed"}>
          {dict(c.careerPath)}
        </Text>
      </ResponsiveTable.Td>
      <ResponsiveTable.Td label={t("performanceReview.dashboard.specialty")}>
        <Text size="sm" c={c.careerSpecialization ? undefined : "dimmed"}>
          {dict(c.careerSpecialization)}
        </Text>
      </ResponsiveTable.Td>
      <ResponsiveTable.Td label={t("users.profile.seniority")}>
        <Text size="sm" c={c.seniorityLevel ? undefined : "dimmed"}>
          {dict(c.seniorityLevel)}
        </Text>
      </ResponsiveTable.Td>
      <ResponsiveTable.Td label={t("performanceReview.massShare.col.managers")}>
        <Text size="sm" c={row.managerLabel ? undefined : "dimmed"}>
          {row.managerLabel || "—"}
        </Text>
      </ResponsiveTable.Td>
      <ResponsiveTable.Td label={t("common.field.status")}>
        {reasonText != null || c.review == null ? (
          <Text size="sm" c="dimmed">
            {reasonText ?? "—"}
          </Text>
        ) : (
          <PerformanceReviewStatusBadge status={c.review.status} />
        )}
      </ResponsiveTable.Td>
      <ResponsiveTable.Td label={t("performanceReview.category.overall")}>
        {c.review?.overallRating != null ? (
          <RatingBadge rating={c.review.overallRating} />
        ) : (
          <Text size="sm" c="dimmed">
            —
          </Text>
        )}
      </ResponsiveTable.Td>
    </ResponsiveTable.Tr>
  );
});
