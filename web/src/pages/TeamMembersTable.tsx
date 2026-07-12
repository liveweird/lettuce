import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import {
  IconArrowDown,
  IconArrowUp,
  IconCalendarEvent,
  IconMessagePlus,
  IconMessageQuestion,
  IconMessages,
  IconUserPlus,
  IconUsersGroup,
} from "@tabler/icons-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { listAllTeams, listTeamMembers, type TeamMemberListView } from "../api/client";
import ClearableTextInput from "../components/ClearableTextInput";
import EmptyState from "../components/EmptyState";
import PersonCard from "../components/PersonCard";
import PersonCardStats, { PeerCardStats } from "../components/PersonCardStats";
import FilterPanel from "../components/FilterPanel";
import PaginationBar from "../components/PaginationBar";
import ReportsScopeSelect from "../components/ReportsScopeSelect";
import { usePagedSort } from "../hooks/usePagedSort";
import { isOneOf, isString, isStringOrNull, useStoredState } from "../hooks/useStoredState";
import { feedbackAskLink, feedbackProvideLink, feedbackRequestLink } from "../utils/feedbackLinks";
import { groupTeamRows } from "../utils/teamRows";

const SORT_FIELDS = ["name", "email", "teamName"] as const;
type SortField = (typeof SORT_FIELDS)[number];

const GRID_COLS = { base: 1, sm: 2, lg: 3 };

// The dashboard "My peers" / "My subordinates" views: a person-card grid (same card language
// as ManagersTable), keeping the table era's filters, sorting, and pagination.
export default function TeamMembersTable({
  view,
  emptyMessage,
}: {
  view: TeamMemberListView;
  emptyMessage: string;
}) {
  const { t } = useTranslation();
  // Two dashboard views (peers/subordinates) share this component — settings are per-view.
  const settingsKey = `teamMembers.${view}`;
  const [nameFilter, setNameFilter] = useStoredState(`${settingsKey}.filter.name`, "", isString);
  const [emailFilter, setEmailFilter] = useStoredState(`${settingsKey}.filter.email`, "", isString);
  const [teamFilter, setTeamFilter] = useStoredState<string | null>(
    `${settingsKey}.filter.team`,
    null,
    isStringOrNull,
  );
  // "My subordinates" only: direct reports (the default) vs. the whole management chain.
  const [reportsScope, setReportsScope] = useStoredState<"direct" | "all">(
    `${settingsKey}.filter.reportsScope`,
    "direct",
    isOneOf(["direct", "all"]),
  );
  const includeIndirect = view === "managed" && reportsScope === "all";
  const activeFilterCount =
    (nameFilter.trim() ? 1 : 0) +
    (emailFilter.trim() ? 1 : 0) +
    (teamFilter ? 1 : 0) +
    (includeIndirect ? 1 : 0);

  const [debouncedName] = useDebouncedValue(nameFilter, 300);
  const [debouncedEmail] = useDebouncedValue(emailFilter, 300);

  const { page, setPage, pageSize, setPageSize, sortField, sortDir, sortParam, toggleSort } =
    usePagedSort<SortField>("name", [debouncedName, debouncedEmail, teamFilter, includeIndirect], {
      key: settingsKey,
      sortFields: SORT_FIELDS,
    });

  const { data: teams } = useQuery({
    queryKey: ["teams", "all"],
    queryFn: listAllTeams,
  });
  const teamOptions = (teams ?? []).map((team) => ({ value: String(team.id), label: team.name }));

  const { data, isLoading, isError, error } = useQuery({
    queryKey: [
      "teamMembers",
      view,
      page,
      pageSize,
      sortParam,
      debouncedName,
      debouncedEmail,
      teamFilter,
      includeIndirect,
    ],
    queryFn: () =>
      listTeamMembers({
        view,
        page,
        pageSize,
        sort: sortParam,
        name: debouncedName || undefined,
        email: debouncedEmail || undefined,
        teamId: teamFilter ? Number(teamFilter) : undefined,
        includeIndirect: includeIndirect || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const total = data?.total ?? 0;

  // The Dashboard tab this view lives in, so feedback flows can return here on Cancel.
  const tab = view === "managed" ? "subordinates" : "peers";
  const backTo = `/?tab=${tab}`;

  // One card per person; a member of two of the caller's teams gets aggregated team badges.
  // PaginationBar still shows the server total (memberships), which can slightly exceed the
  // card count on a page — acceptable at this app's scale.
  const people = groupTeamRows(data?.items ?? []);

  const SORT_OPTIONS: { value: SortField; label: string }[] = [
    { value: "name", label: t("common.field.name") },
    { value: "email", label: t("common.field.email") },
    { value: "teamName", label: t("teams.team") },
  ];
  const DirIcon = sortDir === "asc" ? IconArrowUp : IconArrowDown;

  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <FilterPanel activeFilterCount={activeFilterCount} storageKey={settingsKey}>
          <ClearableTextInput
            label={t("common.field.name")}
            value={nameFilter}
            onChange={setNameFilter}
            clearLabel={t("teams.clearNameFilter")}
          />
          <ClearableTextInput
            label={t("common.field.email")}
            value={emailFilter}
            onChange={setEmailFilter}
            clearLabel={t("teams.clearEmailFilter")}
          />
          <Select
            label={t("teams.team")}
            placeholder={t("common.state.any")}
            data={teamOptions}
            value={teamFilter}
            onChange={setTeamFilter}
            clearable
            clearButtonProps={{ "aria-label": t("teams.clearTeamFilter") }}
            searchable
          />
          {view === "managed" && (
            <ReportsScopeSelect value={reportsScope} onChange={setReportsScope} />
          )}
        </FilterPanel>
        {/* Column headers are gone with the table — sorting lives up here instead. */}
        <Group gap="xs" wrap="nowrap">
          <Select
            size="xs"
            w={130}
            aria-label={t("common.sort.label")}
            data={SORT_OPTIONS}
            value={sortField}
            allowDeselect={false}
            onChange={(v) => {
              if (v && v !== sortField) toggleSort(v as SortField);
            }}
          />
          <ActionIcon
            variant="default"
            size="md"
            onClick={() => toggleSort(sortField)}
            aria-label={t("common.sort.toggleDirection")}
          >
            <DirIcon size={14} />
          </ActionIcon>
        </Group>
      </Group>

      {isError && (
        <Alert color="red" variant="light" title={t("teams.loadMembersTableFailed")}>
          {error instanceof Error ? error.message : t("teams.unknownError")}
        </Alert>
      )}

      {isLoading && !data ? (
        <SimpleGrid cols={GRID_COLS} spacing="md">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={170} radius="md" />
          ))}
        </SimpleGrid>
      ) : people.length > 0 ? (
        <SimpleGrid component="ul" m={0} p={0} style={{ listStyle: "none" }} cols={GRID_COLS} spacing="md">
          {people.map((m) => (
            <PersonCard
              key={m.userId}
              name={m.name}
              email={m.email}
              teamNames={m.teamNames}
              // Peer cards show the two feedback directions; subordinate cards show the
              // 1:1 + feedback stats, but only while every card is a direct report (same
              // rationale as the 1:1 drill-down gate below): rows carry no direct/indirect
              // marker, and indirect reports can't have 1:1s with the caller, so "never"
              // would just be noise.
              stats={
                view === "member" ? (
                  <PeerCardStats person={m} />
                ) : view === "managed" && reportsScope === "direct" ? (
                  <PersonCardStats person={m} />
                ) : undefined
              }
              actions={
                <>
                  <Button
                    component={RouterLink}
                    to={feedbackProvideLink(m.userId, m.name, backTo)}
                    variant="light"
                    size="xs"
                    leftSection={<IconMessagePlus size={14} />}
                    aria-label={t("teams.provideFeedbackToAria", { name: m.name })}
                  >
                    {t("teams.provideFeedback")}
                  </Button>
                  <Button
                    component={RouterLink}
                    to={feedbackAskLink(m.userId, m.name, backTo)}
                    variant="light"
                    size="xs"
                    leftSection={<IconMessageQuestion size={14} />}
                    aria-label={t("teams.askForFeedbackAria", { name: m.name })}
                  >
                    {t("teams.askForFeedback")}
                  </Button>
                  {view === "managed" && (
                    <Button
                      component={RouterLink}
                      to={feedbackRequestLink(m.userId, m.name, backTo)}
                      variant="light"
                      size="xs"
                      leftSection={<IconUserPlus size={14} />}
                      aria-label={t("teams.requestFeedbackAboutAria", { name: m.name })}
                    >
                      {t("teams.requestFeedbackFor")}
                    </Button>
                  )}
                  <Button
                    component={RouterLink}
                    to={`/users/${m.userId}/feedbacks?name=${encodeURIComponent(m.name)}&from=${view === "managed" ? "subordinates" : "peers"}`}
                    variant="subtle"
                    size="xs"
                    leftSection={<IconMessages size={14} />}
                    aria-label={t("teams.feedbacksWithAria", { name: m.name })}
                  >
                    {t("teams.feedbacks")}
                  </Button>
                  {view === "managed" && reportsScope === "direct" && (
                    // Only DIRECT reports qualify for the 1:1 drill-down, and rows carry no
                    // direct/indirect marker — so the button exists only while the Reports
                    // filter guarantees every card is a direct report.
                    <Button
                      component={RouterLink}
                      to={`/users/${m.userId}/one-on-ones?name=${encodeURIComponent(m.name)}&from=subordinates`}
                      variant="subtle"
                      size="xs"
                      leftSection={<IconCalendarEvent size={14} />}
                      aria-label={t("teams.oneOnOnesWithAria", { name: m.name })}
                    >
                      {t("teams.oneOnOnes")}
                    </Button>
                  )}
                </>
              }
            />
          ))}
        </SimpleGrid>
      ) : (
        !isError && (
          <EmptyState
            icon={<IconUsersGroup size={32} stroke={1.2} color="var(--mantine-color-dimmed)" />}
            label={emptyMessage}
          />
        )
      )}

      <PaginationBar
        total={total}
        page={page}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        rowsPerPageLabelKey="teams.rowsPerPage"
      />
    </Stack>
  );
}
