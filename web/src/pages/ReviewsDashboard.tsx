import { Link as RouterLink } from "react-router-dom";
import { Alert, Badge, Button, Group, Select, Stack, Table, Text } from "@mantine/core";
import { IconClipboardText, IconEye, IconPencil, IconPlus } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  getUserId,
  listAllPerformanceReviews,
  listAllTeamMembers,
  listReviewPeriods,
} from "../api/client";
import EmptyState from "../components/EmptyState";
import PersonaChip from "../components/PersonaChip";
import PerformanceReviewStatusBadge from "../components/PerformanceReviewStatusBadge";
import RatingBadge from "../components/RatingBadge";
import ReportsScopeSelect from "../components/ReportsScopeSelect";
import TableLoadingRow from "../components/TableLoadingRow";
import { useDictionaryOptions } from "../hooks/useDictionaryOptions";
import { isOneOf, isString, useStoredState } from "../hooks/useStoredState";
import { formatMonthRange } from "../utils/datetime";
import { reviewCreateLink, reviewEditLink, reviewViewLink } from "../utils/performanceReviewLinks";
import { REVIEW_CATEGORIES } from "../utils/reviewRatings";
import {
  buildReviewsDashboardRows,
  filterReviewsDashboardRows,
  teamNameOptions,
  type ReviewsDashboardFilters,
} from "../utils/reviewsDashboard";

const SETTINGS_KEY = "dashboardReviews";
const REPORTS_SCOPES = ["direct", "all"] as const;
const BACK_TO = "/?tab=reviews";

/**
 * The manager's per-period completion view: every subordinate in scope gets a row — with their
 * review's status and ratings when one exists (and is visible: chain authors' DRAFTs stay
 * hidden server-side), or a clear "no review yet" state with a New-review action while the
 * scope is direct reports (creation needs a direct report — the card-grid gate). Composed
 * client-side from the members list (which carries teams + the career triple) joined with the
 * period's reviews — the org-bounded dashboard-grid precedent, so filters are client-side too.
 */
export default function ReviewsDashboard() {
  const { t, i18n } = useTranslation();
  const currentUserId = getUserId();

  const [reportsScope, setReportsScope] = useStoredState<(typeof REPORTS_SCOPES)[number]>(
    `${SETTINGS_KEY}.filter.reportsScope`, "direct", isOneOf(REPORTS_SCOPES),
  );
  const includeIndirect = reportsScope === "all";
  const [storedPeriod, setStoredPeriod] = useStoredState(`${SETTINGS_KEY}.period`, "", isString);
  const [teamFilter, setTeamFilter] = useStoredState(`${SETTINGS_KEY}.filter.team`, "", isString);
  const [pathFilter, setPathFilter] = useStoredState(`${SETTINGS_KEY}.filter.careerPath`, "", isString);
  const [specFilter, setSpecFilter] = useStoredState(
    `${SETTINGS_KEY}.filter.careerSpecialization`, "", isString,
  );
  const [seniorityFilter, setSeniorityFilter] = useStoredState(
    `${SETTINGS_KEY}.filter.seniorityLevel`, "", isString,
  );

  const { options: pathOptions } = useDictionaryOptions("career-paths");
  const { options: specOptions } = useDictionaryOptions("career-specializations");
  const { options: seniorityOptions } = useDictionaryOptions("seniority-levels");

  const { data: periods, isLoading: periodsLoading, isError: periodsError } = useQuery({
    queryKey: ["reviewPeriods"],
    queryFn: listReviewPeriods,
    staleTime: 5 * 60 * 1000,
  });
  // Newest first for the picker; a stale stored id (deleted period) falls back to the latest.
  const periodOptions = [...(periods ?? [])].reverse().map((p) => ({
    value: String(p.id),
    label: formatMonthRange(p.startMonth, p.endMonth, i18n.language),
  }));
  const periodId =
    storedPeriod && periodOptions.some((o) => o.value === storedPeriod)
      ? storedPeriod
      : (periodOptions[0]?.value ?? null);

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
  const allRows = buildReviewsDashboardRows(members ?? [], reviews ?? []);
  const rows = filterReviewsDashboardRows(allRows, filters);
  const teamOptions = teamNameOptions(allRows);

  const isLoading = periodsLoading || membersLoading || (periodId != null && reviewsLoading);
  const isError = periodsError || membersError || reviewsError;
  const columnCount = 5 + REVIEW_CATEGORIES.length + 1;

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
      <Group align="flex-end" gap="md" wrap="wrap">
        <Select
          label={t("performanceReview.period")}
          data={periodOptions}
          value={periodId}
          onChange={(v) => setStoredPeriod(v ?? "")}
          allowDeselect={false}
          w={240}
        />
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
      </Group>

      {isError && (
        <Alert color="red" variant="light" title={t("performanceReview.loadListError")}>
          {t("performanceReview.unknownError")}
        </Alert>
      )}

      <Table highlightOnHover withTableBorder verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t("performanceReview.subordinate")}</Table.Th>
            <Table.Th>{t("performanceReview.dashboard.team")}</Table.Th>
            <Table.Th>{t("users.profile.path")}</Table.Th>
            <Table.Th>{t("users.profile.specialization")}</Table.Th>
            <Table.Th>{t("users.profile.seniority")}</Table.Th>
            {REVIEW_CATEGORIES.map((c) => (
              <Table.Th key={c} style={{ whiteSpace: "nowrap" }}>
                {t(`performanceReview.categoryShort.${c}`)}
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
                    <Group gap={6} wrap="nowrap">
                      <PersonaChip name={person.name} />
                      {review && <PerformanceReviewStatusBadge status={review.status} />}
                      {!review && (
                        <Badge variant="light" color="gray" style={{ minWidth: "max-content" }}>
                          {t("performanceReview.dashboard.noReviewYet")}
                        </Badge>
                      )}
                    </Group>
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
                  {ratings.map((rating, index) => (
                    <Table.Td key={REVIEW_CATEGORIES[index]} style={{ whiteSpace: "nowrap" }}>
                      {rating != null ? (
                        <RatingBadge rating={rating} />
                      ) : (
                        <Text size="sm" c="dimmed">
                          —
                        </Text>
                      )}
                    </Table.Td>
                  ))}
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
    </Stack>
  );
}
