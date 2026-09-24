import { lazy, Suspense } from "react";
import {
  Alert,
  Badge,
  Box,
  Group,
  SegmentedControl,
  Select,
  Skeleton,
  Stack,
  Text,
} from "@mantine/core";
import ResponsiveTable from "../components/ResponsiveTable";
import {
  IconChartBar,
  IconClipboardText,
  IconEye,
  IconLayoutGrid,
  IconPencil,
  IconPlus,
  IconTable,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { canAudit, getUserId } from "../api/session";
import { listAllTeamMembers } from "../api/teams";
import { listAllUsers } from "../api/users";
import { listAllPerformanceReviews } from "../api/reviews";
import EmptyState from "../components/EmptyState";
import RowActions from "../components/RowActions";
import FilterPanel from "../components/FilterPanel";
import PaginationBar from "../components/PaginationBar";
import PersonCell from "../components/PersonCell";
import PerformanceReviewStatusBadge from "../components/PerformanceReviewStatusBadge";
import { RatingCells } from "../components/RatingBadge";
import ReviewQuadrants from "../components/ReviewQuadrants";
import ReportsScopeSelect, { type AuditorReportsScope } from "../components/ReportsScopeSelect";
import { useIsManagerStatus } from "../hooks/useIsManager";
import SortHeader from "../components/SortHeader";
import TableLoadingRow from "../components/TableLoadingRow";
import { useDictionaryOptions } from "../hooks/useDictionaryOptions";
import { usePagedSort } from "../hooks/usePagedSort";
import { renderPeriodOption, useReviewPeriodOptions } from "../hooks/useReviewPeriodOptions";
import { isOneOf, isString, useStoredState } from "../hooks/useStoredState";
import { reviewCreateLink, reviewEditLink, reviewViewLink } from "../utils/performanceReviewLinks";
import { REVIEW_CATEGORIES } from "../utils/reviewRatings";
import { pickLocalized } from "../utils/localized";
import { usersToPersonCards } from "../utils/teamRows";
import {
  buildReviewsDashboardRows,
  EMPTY_REVIEWS_DASHBOARD_FILTERS,
  filterReviewsDashboardRows,
  joinReviewsDashboardRows,
  REVIEWS_DASHBOARD_SORT_FIELDS,
  sortReviewsDashboardRows,
  teamNameOptions,
  type ReviewsDashboardFilters,
  type ReviewsDashboardSortField,
} from "../utils/reviewsDashboard";

const SETTINGS_KEY = "dashboardReviews";
// "auditor" (v4.3.0) = the HR-only org-wide scope over GET ?view=all — offered only to
// canAudit() callers (the PulseResults safeView idiom below handles a role downgrade / a
// stale cross-device value).
const REPORTS_SCOPES = ["direct", "all", "auditor"] as const;
const VIEW_MODES = ["table", "chart", "quadrants"] as const;
const BACK_TO = "/performance?tab=managed";

// The rating-distribution charts are one of the four lazy @mantine/charts chunks (the
// TeamKpiChart precedent) — recharts never touches the main bundle.
const ReviewRatingDistribution = lazy(() => import("../components/ReviewRatingDistribution"));

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
  const { t, i18n } = useTranslation();
  const currentUserId = getUserId();

  const auditor = canAudit();
  const { isManager, isResolved: isManagerResolved } = useIsManagerStatus();
  const [storedScope, setReportsScope] = useStoredState<AuditorReportsScope>(
    `${SETTINGS_KEY}.filter.reportsScope`, "direct", isOneOf(REPORTS_SCOPES),
  );
  // A stored "auditor" value must never apply to a non-auditor (a role downgrade, or a stale
  // cross-device value) — fall back to direct, never rewriting storage here (the PulseResults
  // safeView idiom).
  const safeScope: AuditorReportsScope = storedScope === "auditor" && !auditor ? "direct" : storedScope;
  // An HR caller who manages no team has no meaningful direct/all choice — direct reports would
  // always be empty — so the auditor scope is their ONLY option and their default (v4.3.0); an
  // HR caller who DOES manage a team keeps the ordinary direct/all/auditor choice, defaulting
  // to direct like everyone else. Wait for the managed-teams probe to RESOLVE before committing
  // to the auditor-only default: while it's loading, `isManager` reads `false` like a genuine
  // non-manager, and picking "auditor" off that transient value would fire a stray `view=all`
  // request — and a false `hr.list` audit event — for an HR caller who turns out to manage a
  // team once the probe settles.
  const auditorOnly = auditor && isManagerResolved && !isManager;
  const reportsScope: AuditorReportsScope = auditorOnly ? "auditor" : safeScope;
  const isAuditorScope = reportsScope === "auditor";
  const includeIndirect = reportsScope === "all";
  const [view, setView] = useStoredState<(typeof VIEW_MODES)[number]>(
    `${SETTINGS_KEY}.view`, "table", isOneOf(VIEW_MODES),
  );
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
  // The picker is newest-first. Without a stored pick (or with a stale one — a deleted
  // period) default to the CURRENT period, not the newest: an admin may pre-append future
  // periods, and defaulting to one would open every manager's view on an empty timeline
  // (2026-08 audit round). Falls back to the newest only when no period contains today.
  const periodId =
    storedPeriod && periodOptions.some((o) => o.value === storedPeriod)
      ? storedPeriod
      : (periodOptions.find((o) => o.current)?.value ?? periodOptions[0]?.value ?? null);

  const { page, setPage, pageSize, setPageSize, sortField, sortDir, toggleSort } =
    usePagedSort<ReviewsDashboardSortField>(
      "name",
      [periodId, reportsScope, teamFilter, pathFilter, specFilter, seniorityFilter],
      { key: SETTINGS_KEY, sortFields: REVIEWS_DASHBOARD_SORT_FIELDS },
    );

  const { data: members, isLoading: membersLoading, isError: membersError } = useQuery({
    queryKey: ["teamMembers", "reviewsDashboard", includeIndirect],
    queryFn: () => listAllTeamMembers("managed", includeIndirect || undefined),
    enabled: !isAuditorScope,
  });
  // The auditor scope's roster is the org-wide users list (no /teams/members scope applies to
  // "everyone") — mapped to PersonCards via usersToPersonCards, every stat null.
  const { data: auditUsers, isLoading: auditUsersLoading, isError: auditUsersError } = useQuery({
    queryKey: ["users", "all", "reviewsDashboardAuditor"],
    queryFn: () => listAllUsers(),
    enabled: isAuditorScope,
  });
  const { data: reviews, isLoading: reviewsLoading, isError: reviewsError } = useQuery({
    // Keyed on isAuditorScope, not the full reportsScope: the "direct" vs "all" distinction
    // only widens the MEMBERS roster (includeIndirect) — the reviews request itself is always
    // `view=managed&includeIndirect=true` for either, so keying on reportsScope would refetch
    // reviews on a direct<->all toggle that changes nothing about this request.
    queryKey: ["performanceReviews", "reviewsDashboard", periodId, isAuditorScope],
    queryFn: () =>
      listAllPerformanceReviews(
        isAuditorScope
          ? { view: "all", periodId: Number(periodId) }
          : { view: "managed", includeIndirect: true, periodId: Number(periodId) },
      ),
    enabled: periodId != null,
    // The auditor branch is a `view=all` HR read, audited server-side (hr.list) on every
    // request — a 60s staleTime + no window-refocus refetch keeps casual tab-switching from
    // filling the audit trail with reads that show nothing new (v4.3.0).
    staleTime: 60_000,
    refetchOnWindowFocus: false,
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
  const allRows = isAuditorScope
    ? joinReviewsDashboardRows(usersToPersonCards(auditUsers ?? []), reviews ?? [])
    : buildReviewsDashboardRows(members ?? [], reviews ?? []);
  const filteredRows = sortReviewsDashboardRows(
    filterReviewsDashboardRows(allRows, filters),
    sortField,
    sortDir,
    i18n.resolvedLanguage,
  );
  const total = filteredRows.length;
  const rows = filteredRows.slice((page - 1) * pageSize, page * pageSize);
  const teamOptions = teamNameOptions(allRows);

  const isLoading =
    periodsLoading ||
    (isAuditorScope ? auditUsersLoading : membersLoading) ||
    (periodId != null && reviewsLoading);
  const isError = periodsError || (isAuditorScope ? auditUsersError : membersError) || reviewsError;
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
      {/* The period is the dataset scope, not a filter — always visible above the panel.
          The view toggle sits beside it: Table (the completion list) or Distribution (the
          rating-balance charts), both driven by the same period + filters. */}
      <Group justify="space-between" align="flex-end">
        <Select
          label={t("performanceReview.period")}
          data={periodOptions}
          value={periodId}
          onChange={(v) => setStoredPeriod(v ?? "")}
          allowDeselect={false}
          renderOption={renderPeriodOption}
          w={240}
          // Mantine 9.6 spreads unknown Select props onto the <input> — the guided-tour anchor
          // must ride wrapperProps or it would land on the input, not the label+input pair.
          wrapperProps={{ "data-tour": "performance-period" }}
        />
        <SegmentedControl
          value={view}
          onChange={(v) => {
            if (isOneOf(VIEW_MODES)(v)) setView(v);
          }}
          data-tour="performance-view"
          data={[
            {
              value: "table",
              label: (
                <Group gap={6} wrap="nowrap">
                  <IconTable size={16} />
                  <span>{t("performanceReview.dashboard.chart.viewTable")}</span>
                </Group>
              ),
            },
            {
              value: "chart",
              label: (
                <Group gap={6} wrap="nowrap">
                  <IconChartBar size={16} />
                  <span>{t("performanceReview.dashboard.chart.viewChart")}</span>
                </Group>
              ),
            },
            {
              value: "quadrants",
              label: (
                <Group gap={6} wrap="nowrap">
                  <IconLayoutGrid size={16} />
                  <span>{t("performanceReview.dashboard.quadrants.view")}</span>
                </Group>
              ),
            },
          ]}
        />
      </Group>

      <FilterPanel activeFilterCount={activeFilterCount} storageKey={SETTINGS_KEY} tourId="performance-dashboard-filters">
        {auditor ? (
          <ReportsScopeSelect
            value={reportsScope}
            onChange={setReportsScope}
            auditorOption
            auditorOnly={auditorOnly}
          />
        ) : (
          <ReportsScopeSelect
            value={reportsScope === "auditor" ? "direct" : reportsScope}
            onChange={setReportsScope}
          />
        )}
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
          label={t("performanceReview.dashboard.specialty")}
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

      {/* The current view's container — table / Distribution / Quadrants — carries the tour
          anchor; the empty-timeline EmptyState above returns before this renders, so it stays
          anchor-free (Joyride skips a missing target). */}
      <Box data-tour="performance-dashboard">
      {view === "chart" ? (
        // The Distribution view replaces the table + pagination; the period and every filter
        // above keep applying — filteredRows is the filtered-but-unpaginated selection.
        <Suspense fallback={<Skeleton height={300} radius="md" />}>
          <ReviewRatingDistribution rows={filteredRows} />
        </Suspense>
      ) : view === "quadrants" ? (
        // The Quadrants view shares the same filtered-but-unpaginated selection. No Suspense:
        // it is a plain CSS grid — no recharts, so it rides the main bundle.
        <ReviewQuadrants rows={filteredRows} />
      ) : (
      <>
      {/* 12 columns + the per-row New-review button. The five rating columns carry rotated,
          full-word headers (v3.11.1, measured ~49px/column vs ~100px wrapped horizontally) so
          the table fits the default 900px matrix minimum at both a 1280px laptop and in Polish
          — the matrix scroll below stays only the narrow-screen fallback, not the normal case. */}
      <ResponsiveTable mode="matrix" density="normal">
        <ResponsiveTable.Thead>
          <ResponsiveTable.Tr>
            <ResponsiveTable.Th sortable><SortHeader
                field="name"
                label={t("performanceReview.subordinate")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </ResponsiveTable.Th>
            <ResponsiveTable.Th sortable><SortHeader
                field="team"
                label={t("performanceReview.dashboard.team")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </ResponsiveTable.Th>
            <ResponsiveTable.Th sortable><SortHeader
                field="careerPath"
                label={t("users.profile.path")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </ResponsiveTable.Th>
            <ResponsiveTable.Th sortable><SortHeader
                field="careerSpecialization"
                label={t("performanceReview.dashboard.specialty")}
                activeField={sortField}
                activeDir={sortDir}
                onToggle={toggleSort}
              />
            </ResponsiveTable.Th>
            <ResponsiveTable.Th sortable><SortHeader
                field="seniorityLevel"
                label={t("users.profile.seniority")}
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
            {RATING_COLUMNS.map(({ category, field }) => (
              <ResponsiveTable.Th sortable vertical key={category}><SortHeader
                  orientation="vertical"
                  field={field}
                  label={t(`performanceReview.categoryShort.${category}`)}
                  activeField={sortField}
                  activeDir={sortDir}
                  onToggle={toggleSort}
                />
              </ResponsiveTable.Th>
            ))}
            <ResponsiveTable.Th actions aria-label={t("common.table.actions")} />
          </ResponsiveTable.Tr>
        </ResponsiveTable.Thead>
        <ResponsiveTable.Tbody>
          {isLoading && !(isAuditorScope ? auditUsers : members) ? (
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
                ? [
                    review.attitudeRating,
                    review.deliveryRating,
                    review.skillsRating,
                    review.aptitudeRating,
                    review.overallRating,
                  ]
                : REVIEW_CATEGORIES.map(() => null);
              return (
                <ResponsiveTable.Tr key={person.userId}>
                  <ResponsiveTable.Td label={t("performanceReview.subordinate")}>
                    <PersonCell
                      userId={person.userId}
                      name={person.name}
                      currentUserId={currentUserId}
                    />
                  </ResponsiveTable.Td>
                  <ResponsiveTable.Td label={t("performanceReview.dashboard.team")}>
                    <Group gap={4}>
                      {person.teamNames.map((name) => (
                        <Badge key={name} variant="light" color="gray">
                          {name}
                        </Badge>
                      ))}
                    </Group>
                  </ResponsiveTable.Td>
                  <ResponsiveTable.Td label={t("users.profile.path")}>
                    <Text size="sm" c={person.careerPath ? undefined : "dimmed"}>
                      {person.careerPath
                        ? pickLocalized(person.careerPath.values, i18n.resolvedLanguage)
                        : "—"}
                    </Text>
                  </ResponsiveTable.Td>
                  <ResponsiveTable.Td label={t("performanceReview.dashboard.specialty")}>
                    <Text size="sm" c={person.careerSpecialization ? undefined : "dimmed"}>
                      {person.careerSpecialization
                        ? pickLocalized(person.careerSpecialization.values, i18n.resolvedLanguage)
                        : "—"}
                    </Text>
                  </ResponsiveTable.Td>
                  <ResponsiveTable.Td label={t("users.profile.seniority")}>
                    <Text size="sm" c={person.seniorityLevel ? undefined : "dimmed"}>
                      {person.seniorityLevel
                        ? pickLocalized(person.seniorityLevel.values, i18n.resolvedLanguage)
                        : "—"}
                    </Text>
                  </ResponsiveTable.Td>
                  <ResponsiveTable.Td label={t("common.field.status")}>
                    {review ? (
                      <PerformanceReviewStatusBadge status={review.status} />
                    ) : (
                      <Badge variant="light" color="gray">
                        {t("performanceReview.dashboard.noReviewYet")}
                      </Badge>
                    )}
                  </ResponsiveTable.Td>
                  <RatingCells
                    ratings={ratings}
                    labels={REVIEW_CATEGORIES.map((c) => t(`performanceReview.categoryShort.${c}`))}
                    align="center"
                    numeric
                  />
                  <ResponsiveTable.Td actions>
                    {review ? (
                      <RowActions
                        primary={{
                          icon: canEdit ? <IconPencil size={16} /> : <IconEye size={16} />,
                          label: canEdit ? t("common.action.edit") : t("common.action.view"),
                          ariaLabel: t(canEdit ? "performanceReview.editAria" : "performanceReview.viewAria", {
                            name: person.name,
                          }),
                          to: canEdit
                            ? reviewEditLink(review.id, undefined, BACK_TO)
                            : reviewViewLink(review.id, undefined, BACK_TO),
                        }}
                      />
                    ) : reportsScope === "direct" ? (
                      // Creation needs a direct report; the indirect scope can't tell which
                      // rows qualify, so the action exists only while the scope guarantees it.
                      <RowActions
                        primary={{
                          icon: <IconPlus size={16} />,
                          label: t("performanceReview.newReview"),
                          ariaLabel: t("performanceReview.newReviewForAria", { name: person.name }),
                          to: reviewCreateLink(person.userId, BACK_TO),
                        }}
                      />
                    ) : null}
                  </ResponsiveTable.Td>
                </ResponsiveTable.Tr>
              );
            })
          ) : !isError ? (
            <ResponsiveTable.Tr>
              <ResponsiveTable.Td colSpan={columnCount}>
                <EmptyState
                  icon={<IconClipboardText size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
                  label={t("performanceReview.dashboard.empty")}
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
      </>
      )}
      </Box>
    </Stack>
  );
}
