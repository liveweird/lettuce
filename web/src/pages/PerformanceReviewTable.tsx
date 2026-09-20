import type { ParseKeys } from "i18next";
import { Alert, Select, Stack, Text } from "@mantine/core";
import ResponsiveTable from "../components/ResponsiveTable";
import { useDebouncedValue } from "@mantine/hooks";
import { IconClipboardText, IconEye, IconPencil } from "@tabler/icons-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getUserId } from "../api/session";
import { listPerformanceReviews, type PerformanceReviewListItem, type PerformanceReviewListView, type PerformanceReviewStatus } from "../api/reviews";
import ClearableTextInput from "../components/ClearableTextInput";
import DateCell from "../components/DateCell";
import EmptyState from "../components/EmptyState";
import RowActions from "../components/RowActions";
import FilterPanel from "../components/FilterPanel";
import PaginationBar from "../components/PaginationBar";
import PerformanceReviewStatusBadge from "../components/PerformanceReviewStatusBadge";
import PersonCell from "../components/PersonCell";
import { RatingCells } from "../components/RatingBadge";
import SortHeader from "../components/SortHeader";
import TableLoadingRow from "../components/TableLoadingRow";
import { usePagedSort } from "../hooks/usePagedSort";
import { renderPeriodOption, useReviewPeriodOptions } from "../hooks/useReviewPeriodOptions";
import { isOneOfOrNull, isString, useStoredState } from "../hooks/useStoredState";
import { formatMonthRange } from "../utils/datetime";
import { reviewEditLink, reviewViewLink } from "../utils/performanceReviewLinks";
import { REVIEW_CATEGORIES } from "../utils/reviewRatings";
import { loadErrorMessage } from "../utils/saveError";

const BASE_SORT_FIELDS = ["periodStart", "status", "createdAt"] as const;
type SortField = (typeof BASE_SORT_FIELDS)[number] | "managerName" | "subordinateName";

const STATUS_VALUES = ["DRAFT", "CALIBRATION", "PUBLISHED"] as const;

// The one filterable + sortable person column a view shows (the GoalTable idiom): whose
// reviews these are is pinned by the embedding page, so the *other* party is the column.
type PersonColumn = {
  field: "managerName" | "subordinateName";
  labelKey: ParseKeys;
  clearFilterLabelKey: ParseKeys;
  id: (r: PerformanceReviewListItem) => number;
  name: (r: PerformanceReviewListItem) => string;
  deleted: (r: PerformanceReviewListItem) => boolean;
};

const MANAGER_COLUMN: PersonColumn = {
  field: "managerName",
  labelKey: "performanceReview.manager",
  clearFilterLabelKey: "performanceReview.clearManagerFilter",
  id: (r) => r.managerId,
  name: (r) => r.managerName,
  deleted: (r) => r.managerDeleted,
};

const SUBORDINATE_COLUMN: PersonColumn = {
  field: "subordinateName",
  labelKey: "performanceReview.subordinate",
  clearFilterLabelKey: "performanceReview.clearSubordinateFilter",
  id: (r) => r.subordinateId,
  name: (r) => r.subordinateName,
  deleted: (r) => r.subordinateDeleted,
};

// Per-view differences, declaratively (the GoalTable shape). The row action is NOT per-view:
// at any view the review's manager edits their DRAFT rows and everyone else views (the view
// screen owns the CALIBRATION-phase actions). view=team exists server-side but has no UI surface (the
// reviews dashboard covers team browsing) — the goals precedent.
const VIEW_CONFIG: Record<
  Exclude<PerformanceReviewListView, "team">,
  { personColumns: PersonColumn[] }
> = {
  own: { personColumns: [MANAGER_COLUMN] },
  managed: { personColumns: [SUBORDINATE_COLUMN] },
  user: { personColumns: [MANAGER_COLUMN, SUBORDINATE_COLUMN] },
};

/**
 * The performance-reviews list — filters (person substring, period, status), sortable columns,
 * paging; rating columns carry the bare numbers (calculations run on numbers — the wording
 * lives on the detail screens). Exercised by the Performance page's own tab (unpinned) and the
 * /users/:id/performance-reviews drill-downs. The person column hides when its party is
 * pinned — the embedding page already names that person in its title.
 */
export default function PerformanceReviewTable({
  view,
  managerId,
  subordinateId,
  userId,
  settingsKey,
  backTo,
  includeIndirect,
  tourId,
}: {
  view: Exclude<PerformanceReviewListView, "team">;
  /** Scope to one manager's reviews (the "reviews from this manager" drill-down). */
  managerId?: number;
  /** Scope to one subordinate's reviews (the per-subordinate drill-down). */
  subordinateId?: number;
  /** Required with view="user" (the HR auditor view): whose reviews to list. */
  userId?: number;
  /** Override the localStorage view-settings namespace when embedded outside the main pages. */
  settingsKey?: string;
  /** When set, action links carry a back=… override so detail pages return here. */
  backTo?: string;
  /** Widen view=managed to chain-authored reviews (the per-subordinate "all reviews" drill-down). */
  includeIndirect?: boolean;
  /** Forwarded to the Filters toggle as `data-tour` (a tutorial anchor). Only Performance.tsx
   *  passes it — PerformanceReviewTable is also embedded by UserPerformanceReviews. */
  tourId?: string;
}) {
  const { t, i18n } = useTranslation();
  const currentUserId = getUserId();
  const { personColumns } = VIEW_CONFIG[view];
  // A person column hides when a drill-down pins that party — the page names them already.
  const visibleColumns = personColumns.filter(
    (c) =>
      !(c.field === "managerName" && managerId != null) &&
      !(c.field === "subordinateName" && subordinateId != null),
  );
  const sortFields: readonly SortField[] = [
    ...BASE_SORT_FIELDS,
    ...visibleColumns.map((c) => c.field),
  ];
  // Sortable columns + the five (unsortable) rating columns + the actions column.
  const columnCount = sortFields.length + REVIEW_CATEGORIES.length + 1;

  const storeKey = settingsKey ?? `performanceReviews.${view}`;
  const [managerFilter, setManagerFilter] = useStoredState(
    `${storeKey}.filter.manager`, "", isString,
  );
  const [subordinateFilter, setSubordinateFilter] = useStoredState(
    `${storeKey}.filter.subordinate`, "", isString,
  );
  const personFilters: Record<
    PersonColumn["field"],
    { value: string; set: (v: string) => void }
  > = {
    managerName: { value: managerFilter, set: setManagerFilter },
    subordinateName: { value: subordinateFilter, set: setSubordinateFilter },
  };
  const [statusFilter, setStatusFilter] = useStoredState<PerformanceReviewStatus | null>(
    `${storeKey}.filter.status`, null, isOneOfOrNull(STATUS_VALUES),
  );
  // The period filter persists the period ID as a string ("" = all); a stale stored id (a
  // deleted period) simply matches nothing until cleared.
  const [periodFilter, setPeriodFilter] = useStoredState(
    `${storeKey}.filter.period`, "", isString,
  );
  const activeFilterCount =
    visibleColumns.filter((c) => personFilters[c.field].value.trim()).length +
    (statusFilter ? 1 : 0) +
    (periodFilter ? 1 : 0);

  const [debouncedManager] = useDebouncedValue(managerFilter, 300);
  const [debouncedSubordinate] = useDebouncedValue(subordinateFilter, 300);
  const managerVisible = visibleColumns.some((c) => c.field === "managerName");
  const subordinateVisible = visibleColumns.some((c) => c.field === "subordinateName");

  const { page, setPage, pageSize, setPageSize, sortField, sortDir, sortParam, toggleSort } =
    usePagedSort<SortField>(
      "createdAt",
      [debouncedManager, debouncedSubordinate, statusFilter, periodFilter],
      { key: storeKey, sortFields },
      "desc", // newest reviews first (the server's default order)
    );

  // The period filter's options — the whole (small, unpaged) timeline, newest first.
  const { options: periodOptions } = useReviewPeriodOptions();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: [
      "performanceReviews",
      view,
      managerId,
      subordinateId,
      userId,
      includeIndirect,
      page,
      pageSize,
      sortParam,
      debouncedManager,
      debouncedSubordinate,
      statusFilter,
      periodFilter,
    ],
    queryFn: () =>
      listPerformanceReviews({
        view,
        page,
        pageSize,
        sort: sortParam,
        managerName: (managerVisible && debouncedManager) || undefined,
        subordinateName: (subordinateVisible && debouncedSubordinate) || undefined,
        status: statusFilter ?? undefined,
        managerId,
        subordinateId,
        periodId: periodFilter ? Number(periodFilter) : undefined,
        includeIndirect: includeIndirect || undefined,
        userId,
      }),
    placeholderData: keepPreviousData,
  });

  const total = data?.total ?? 0;

  return (
    <Stack gap="md">
      <FilterPanel activeFilterCount={activeFilterCount} storageKey={storeKey} tourId={tourId}>
        {visibleColumns.map((c) => (
          <ClearableTextInput
            key={c.field}
            label={t(c.labelKey)}
            value={personFilters[c.field].value}
            onChange={personFilters[c.field].set}
            clearLabel={t(c.clearFilterLabelKey)}
          />
        ))}
        <Select
          label={t("performanceReview.period")}
          data={[{ value: "", label: t("common.state.all") }, ...periodOptions]}
          value={periodFilter}
          onChange={(v) => setPeriodFilter(v ?? "")}
          allowDeselect={false}
          renderOption={renderPeriodOption}
          w={240}
        />
        <Select
          label={t("common.field.status")}
          data={[
            { value: "", label: t("common.state.any") },
            ...STATUS_VALUES.map((s) => ({ value: s, label: t(`performanceReview.status.${s}`) })),
          ]}
          value={statusFilter ?? ""}
          onChange={(v) => setStatusFilter((v as PerformanceReviewStatus) || null)}
          allowDeselect={false}
          w={180}
        />
      </FilterPanel>

      {isError && (
        <Alert color="red" variant="light" title={t("performanceReview.loadListError")}>
          {loadErrorMessage(error, t)}
        </Alert>
      )}

      <ResponsiveTable density="wide">
        <ResponsiveTable.Thead>
          <ResponsiveTable.Tr>
            {visibleColumns.map((c) => (
              <ResponsiveTable.Th sortable key={c.field}><SortHeader
                  field={c.field}
                  label={t(c.labelKey)}
                  activeField={sortField}
                  activeDir={sortDir}
                  onToggle={toggleSort}
                />
              </ResponsiveTable.Th>
            ))}
            <ResponsiveTable.Th sortable><SortHeader
                field="periodStart"
                label={t("performanceReview.period")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </ResponsiveTable.Th>
            <ResponsiveTable.Th sortable><SortHeader
                field="status"
                label={t("common.field.status")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </ResponsiveTable.Th>
            {REVIEW_CATEGORIES.map((c) => (
              <ResponsiveTable.Th key={c}>
                {t(`performanceReview.categoryShort.${c}`)}
              </ResponsiveTable.Th>
            ))}
            <ResponsiveTable.Th sortable><SortHeader
                field="createdAt"
                label={t("performanceReview.createdAt")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </ResponsiveTable.Th>
            <ResponsiveTable.Th actions aria-label={t("common.table.actions")} />
          </ResponsiveTable.Tr>
        </ResponsiveTable.Thead>
        <ResponsiveTable.Tbody>
          {isLoading && !data ? (
            <TableLoadingRow colSpan={columnCount} />
          ) : data && data.items.length > 0 ? (
            data.items.map((r) => {
              // DRAFT only: a CALIBRATION row opens the view screen, which owns the lifecycle
              // actions (Publish/Return to draft) and links onward to the editor.
              const canEdit =
                currentUserId != null && r.managerId === currentUserId && r.status === "DRAFT";
              const backParam = backTo || undefined;
              const period = formatMonthRange(r.periodStartMonth, r.periodEndMonth, i18n.language);
              const ratings = [
                r.attitudeRating,
                r.deliveryRating,
                r.skillsRating,
                r.aptitudeRating,
                r.overallRating,
              ];
              return (
                <ResponsiveTable.Tr key={r.id}>
                  {visibleColumns.map((c) => (
                    <ResponsiveTable.Td key={c.field} label={t(c.labelKey)}>
                      <PersonCell
                        userId={c.id(r)}
                        name={c.name(r)}
                        deleted={c.deleted(r)}
                        currentUserId={currentUserId}
                      />
                    </ResponsiveTable.Td>
                  ))}
                  <ResponsiveTable.Td label={t("performanceReview.period")}>
                    <Text size="sm">{period}</Text>
                  </ResponsiveTable.Td>
                  <ResponsiveTable.Td label={t("common.field.status")}>
                    <PerformanceReviewStatusBadge status={r.status} />
                  </ResponsiveTable.Td>
                  <RatingCells ratings={ratings} labels={REVIEW_CATEGORIES.map((c) => t(`performanceReview.categoryShort.${c}`))} />
                  <ResponsiveTable.Td label={t("performanceReview.createdAt")}>
                    <DateCell value={r.createdAt} mode="date" />
                  </ResponsiveTable.Td>
                  <ResponsiveTable.Td actions>
                    {canEdit ? (
                      <RowActions
                        primary={{
                          icon: <IconPencil size={16} />,
                          label: t("common.action.edit"),
                          ariaLabel: t("performanceReview.editAria", { name: r.subordinateName }),
                          to: reviewEditLink(r.id, view, backParam),
                        }}
                      />
                    ) : (
                      <RowActions
                        primary={{
                          icon: <IconEye size={16} />,
                          label: t("common.action.view"),
                          ariaLabel: t("performanceReview.viewAria", { name: r.subordinateName }),
                          to: reviewViewLink(r.id, view, backParam),
                        }}
                      />
                    )}
                  </ResponsiveTable.Td>
                </ResponsiveTable.Tr>
              );
            })
          ) : !isError ? (
            <ResponsiveTable.Tr>
              <ResponsiveTable.Td colSpan={columnCount}>
                <EmptyState
                  icon={
                    <IconClipboardText size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />
                  }
                  label={t("performanceReview.noReviews")}
                />
              </ResponsiveTable.Td>
            </ResponsiveTable.Tr>
          ) : null}
        </ResponsiveTable.Tbody>
      </ResponsiveTable>

      <PaginationBar
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        rowsPerPageLabelKey="performanceReview.rowsPerPage"
      />
    </Stack>
  );
}
