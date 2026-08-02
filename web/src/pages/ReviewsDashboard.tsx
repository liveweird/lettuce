import { Link as RouterLink } from "react-router-dom";
import { Alert, Badge, Button, Group, Select, Stack, Table, Text } from "@mantine/core";
import { IconClipboardText, IconEye, IconPencil, IconPlus } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { getUserId, listAllPerformanceReviews, listAllTeamMembers } from "../api/client";
import EmptyState from "../components/EmptyState";
import FilterPanel from "../components/FilterPanel";
import PaginationBar from "../components/PaginationBar";
import PersonaChip from "../components/PersonaChip";
import PerformanceReviewStatusBadge from "../components/PerformanceReviewStatusBadge";
import { RatingCells } from "../components/RatingBadge";
import ReportsScopeSelect from "../components/ReportsScopeSelect";
import SortHeader from "../components/SortHeader";
import TableLoadingRow from "../components/TableLoadingRow";
import { useDictionaryOptions } from "../hooks/useDictionaryOptions";
import { usePagedSort } from "../hooks/usePagedSort";
import { useReviewPeriodOptions } from "../hooks/useReviewPeriodOptions";
import { isOneOf, isString, useStoredState } from "../hooks/useStoredState";
import { reviewCreateLink, reviewEditLink, reviewViewLink } from "../utils/performanceReviewLinks";
import { REVIEW_CATEGORIES } from "../utils/reviewRatings";
import {
  buildReviewsDashboardRows,
  EMPTY_REVIEWS_DASHBOARD_FILTERS,
  filterReviewsDashboardRows,
  REVIEWS_DASHBOARD_SORT_FIELDS,
  sortReviewsDashboardRows,
  teamNameOptions,
  type ReviewsDashboardFilters,
  type ReviewsDashboardSortField,
} from "../utils/reviewsDashboard";

const SETTINGS_KEY = "dashboardReviews";
const REPORTS_SCOPES = ["direct", "all"] as const;
const BACK_TO = "/?tab=reviews";

// The rating columns in table order, paired with their sort fields.
const RATING_COLUMNS = REVIEW_CATEGORIES.map((category) => ({
  category,
  field: category as ReviewsDashboardSortField,
}));

/**
 * The manager's per-period completion view: every subordinate in scope gets a row — with their
 * review's status and ratings when one exists (and is visible: chain authors' DRAFTs stay
 * hidden server-side), or a clear "no review yet" state with a New-review action while the
 * scope is direct reports (creation needs a direct report — the card-grid gate). Composed
 * client-side from the members list (which carries teams + the career triple) joined with the
 * period's reviews — so the standard list plumbing (FilterPanel, sortable headers, paging) runs
 * client-side over the joined rows. The Period Select stays OUTSIDE the filter panel: it scopes
 * the dataset, like a tab.
 */
export default function ReviewsDashboard() {
  const { t } = useTranslation();
  const currentUserId = getUserId();

  const [reportsScope, setReportsScope] = useStoredState<(typeof REPORTS_SCOPES)[number]>(
    `${SETTINGS_KEY}.filter.reportsScope`, "direct", isOneOf(REPORTS_SCOPES),
  );
  const includeIndirect = reportsScope === "all";
  const [storedPeriod, setStoredPeriod] = useStoredState(`${SETTINGS_KEY}.period`, "", isString);
  const [teamFilter, setTeamFilter] = useStoredState(
    `${SETTINGS_KEY}.filter.team`, EMPTY_REVIEWS_DASHBOARD_FILTERS.teamName, isString,
  );
  const [pathFilter, setPathFilter] = useStoredState(
    `${SETTINGS_KEY}.filter.careerPath`, EMPTY_REVIEWS_DASHBOARD_FILTERS.careerPathId, isString,
  );
  const [specFilter, setSpecFilter] = useStoredState(
    `${SETTINGS_KEY}.filter.careerSpecialization`,
    EMPTY_REVIEWS_DASHBOARD_FILTERS.careerSpecializationId,
    isString,
  );
  const [seniorityFilter, setSeniorityFilter] = useStoredState(
    `${SETTINGS_KEY}.filter.seniorityLevel`,
    EMPTY_REVIEWS_DASHBOARD_FILTERS.seniorityLevelId,
    isString,
  );

  const { options: pathOptions } = useDictionaryOptions("career-paths");
  const { options: specOptions } = useDictionaryOptions("career-specializations");
  const { options: seniorityOptions } = useDictionaryOptions("seniority-levels");

  const {
    periods,
    options: periodOptions,
    isLoading: periodsLoading,
    isError: periodsError,
  } = useReviewPeriodOptions();
  // The picker is newest-first; a stale stored id (deleted period) falls back to the latest.
  const periodId =
    storedPeriod && periodOptions.some((o) => o.value === storedPeriod)
      ? storedPeriod
      : (periodOptions[0]?.value ?? null);

  const { page, setPage, pageSize, setPageSize, sortField, sortDir, toggleSort } =
    usePagedSort<ReviewsDashboardSortField>(
      "name",
      [periodId, reportsScope, teamFilter, pathFilter, specFilter, seniorityFilter],
      { key: SETTINGS_KEY, sortFields: REVIEWS_DASHBOARD_SORT_FIELDS },
    );

  const { data: members, isLoading: membersLoading, isError: membersError } = useQuery({
    queryKey: ["teamMembers", "reviewsDashboard", includeIndirect],
    queryFn: () => listAllTeamMembers("managed", includeIndirect || undefined),
  });
  const { data: reviews, isLoading: reviewsLoading, isError: reviewsError } = useQuery({
    queryKey: ["performanceReviews", "reviewsDashboard", periodId],
    queryFn: () =>
      listAllPerformanceReviews({
        view: "managed",
        includeIndirect: true,
        periodId: Number(periodId),
      }),
    enabled: periodId != null,
  });

  const filters: ReviewsDashboardFilters = {
    teamName: teamFilter,
    careerPathId: pathFilter,
    careerSpecializationId: specFilter,
    seniorityLevelId: seniorityFilter,
  };
  const activeFilterCount =
    (teamFilter ? 1 : 0) +
    (pathFilter ? 1 : 0) +
    (specFilter ? 1 : 0) +
    (seniorityFilter ? 1 : 0) +
    (includeIndirect ? 1 : 0);
  const allRows = buildReviewsDashboardRows(members ?? [], reviews ?? []);
  const filteredRows = sortReviewsDashboardRows(
    filterReviewsDashboardRows(allRows, filters),
    sortField,
    sortDir,
  );
  const total = filteredRows.length;
  const rows = filteredRows.slice((page - 1) * pageSize, page * pageSize);
  const teamOptions = teamNameOptions(allRows);

  const isLoading = periodsLoading || membersLoading || (periodId != null && reviewsLoading);
  const isError = periodsError || membersError || reviewsError;
  const columnCount = REVIEWS_DASHBOARD_SORT_FIELDS.length + 1;

  if (periods != null && periods.length === 0) {
    return (
      <EmptyState
        icon={<IconClipboardText size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
        label={t("performanceReview.dashboard.noPeriods")}
      />
    );
  }

  return (
    <Stack gap="md">
      {/* The period is the dataset scope, not a filter — always visible above the panel. */}
      <Select
        label={t("performanceReview.period")}
        data={periodOptions}
        value={periodId}
        onChange={(v) => setStoredPeriod(v ?? "")}
        allowDeselect={false}
        w={240}
      />

      <FilterPanel activeFilterCount={activeFilterCount} storageKey={SETTINGS_KEY}>
        <ReportsScopeSelect value={reportsScope} onChange={setReportsScope} />
        <Select
          label={t("performanceReview.dashboard.team")}
          data={[{ value: "", label: t("common.state.all") }, ...teamOptions.map((n) => ({ value: n, label: n }))]}
          value={teamFilter}
          onChange={(v) => setTeamFilter(v ?? "")}
          allowDeselect={false}
          w={200}
        />
        <Select
          label={t("common.field.careerPath")}
          data={[{ value: "", label: t("common.state.all") }, ...pathOptions]}
          value={pathFilter}
          onChange={(v) => setPathFilter(v ?? "")}
          allowDeselect={false}
          w={200}
        />
        <Select
          label={t("common.field.careerSpecialization")}
          data={[{ value: "", label: t("common.state.all") }, ...specOptions]}
          value={specFilter}
          onChange={(v) => setSpecFilter(v ?? "")}
          allowDeselect={false}
          w={200}
        />
        <Select
          label={t("common.field.seniorityLevel")}
          data={[{ value: "", label: t("common.state.all") }, ...seniorityOptions]}
          value={seniorityFilter}
          onChange={(v) => setSeniorityFilter(v ?? "")}
          allowDeselect={false}
          w={200}
        />
      </FilterPanel>

      {isError && (
        <Alert color="red" variant="light" title={t("performanceReview.loadListError")}>
          {t("performanceReview.unknownError")}
        </Alert>
      )}

      <Table highlightOnHover withTableBorder verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>
              <SortHeader
                field="name"
                label={t("performanceReview.subordinate")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            <Table.Th>
              <SortHeader
                field="team"
                label={t("performanceReview.dashboard.team")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            <Table.Th>
              <SortHeader
                field="careerPath"
                label={t("users.profile.path")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            <Table.Th>
              <SortHeader
                field="careerSpecialization"
                label={t("users.profile.specialization")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            <Table.Th>
              <SortHeader
                field="seniorityLevel"
                label={t("users.profile.seniority")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            <Table.Th>
              <SortHeader
                field="status"
                label={t("common.field.status")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </Table.Th>
            {RATING_COLUMNS.map(({ category, field }) => (
              <Table.Th key={category} style={{ whiteSpace: "nowrap" }}>
                <SortHeader
                  field={field}
                  label={t(`performanceReview.categoryShort.${category}`)}
                  activeField={sortField}
                  activeDir={sortDir}
                  onToggle={toggleSort}
                />
              </Table.Th>
            ))}
            <Table.Th aria-label={t("common.table.actions")} style={{ width: 1 }} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {isLoading && !members ? (
            <TableLoadingRow colSpan={columnCount} />
          ) : rows.length > 0 ? (
            rows.map(({ person, review }) => {
              // DRAFT only (the table rule): CALIBRATION/PUBLISHED rows open the view screen,
              // which owns the lifecycle actions and links onward to the editor.
              const canEdit =
                review != null &&
                currentUserId != null &&
                review.managerId === currentUserId &&
                review.status === "DRAFT";
              const ratings = review
                ? [review.attitudeRating, review.deliveryRating, review.skillsRating, review.overallRating]
                : REVIEW_CATEGORIES.map(() => null);
              return (
                <Table.Tr key={person.userId}>
                  <Table.Td>
                    <PersonaChip name={person.name} />
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4}>
                      {person.teamNames.map((name) => (
                        <Badge key={name} variant="light" color="gray">
                          {name}
                        </Badge>
                      ))}
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c={person.careerPath ? undefined : "dimmed"}>
                      {person.careerPath?.value ?? "—"}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c={person.careerSpecialization ? undefined : "dimmed"}>
                      {person.careerSpecialization?.value ?? "—"}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c={person.seniorityLevel ? undefined : "dimmed"}>
                      {person.seniorityLevel?.value ?? "—"}
                    </Text>
                  </Table.Td>
                  <Table.Td style={{ whiteSpace: "nowrap" }}>
                    {review ? (
                      <PerformanceReviewStatusBadge status={review.status} />
                    ) : (
                      <Badge variant="light" color="gray" style={{ minWidth: "max-content" }}>
                        {t("performanceReview.dashboard.noReviewYet")}
                      </Badge>
                    )}
                  </Table.Td>
                  <RatingCells ratings={ratings} />
                  <Table.Td style={{ whiteSpace: "nowrap" }}>
                    {review ? (
                      <Button
                        component={RouterLink}
                        to={
                          canEdit
                            ? reviewEditLink(review.id, undefined, BACK_TO)
                            : reviewViewLink(review.id, undefined, BACK_TO)
                        }
                        color="blue"
                        variant="subtle"
                        size="xs"
                        leftSection={canEdit ? <IconPencil size={14} /> : <IconEye size={14} />}
                        aria-label={t(canEdit ? "performanceReview.editAria" : "performanceReview.viewAria", {
                          name: person.name,
                        })}
                      >
                        {canEdit ? t("common.action.edit") : t("common.action.view")}
                      </Button>
                    ) : reportsScope === "direct" ? (
                      // Creation needs a direct report; the indirect scope can't tell which
                      // rows qualify, so the action exists only while the scope guarantees it.
                      <Button
                        component={RouterLink}
                        to={reviewCreateLink(person.userId, person.name, BACK_TO)}
                        variant="light"
                        size="xs"
                        leftSection={<IconPlus size={14} />}
                        aria-label={t("performanceReview.newReviewForAria", { name: person.name })}
                      >
                        {t("performanceReview.newReview")}
                      </Button>
                    ) : null}
                  </Table.Td>
                </Table.Tr>
              );
            })
          ) : !isError ? (
            <Table.Tr>
              <Table.Td colSpan={columnCount}>
                <EmptyState
                  icon={<IconClipboardText size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
                  label={t("performanceReview.dashboard.empty")}
                />
              </Table.Td>
            </Table.Tr>
          ) : null}
        </Table.Tbody>
      </Table>

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
