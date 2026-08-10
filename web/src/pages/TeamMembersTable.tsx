import { useTranslation } from "react-i18next";
import {
  ActionIcon,
  Alert,
  Group,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconArrowDown, IconArrowUp, IconUsersGroup } from "@tabler/icons-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { listAllTeams, listTeamMembers, type TeamMemberListView } from "../api/client";
import ClearableTextInput from "../components/ClearableTextInput";
import EmptyState from "../components/EmptyState";
import PersonCard from "../components/PersonCard";
import PersonCardBody from "../components/PersonCardStats";
import FilterPanel from "../components/FilterPanel";
import PaginationBar from "../components/PaginationBar";
import ReportsScopeSelect from "../components/ReportsScopeSelect";
import { usePagedSort } from "../hooks/usePagedSort";
import { isOneOf, isString, isStringOrNull, useStoredState } from "../hooks/useStoredState";
import { groupTeamRows } from "../utils/teamRows";

const SORT_FIELDS = ["name", "email", "teamName"] as const;
type SortField = (typeof SORT_FIELDS)[number];

// Capped at 2 per row (v1.34.0, was 3 at lg): the cards carry two stat columns and up to
// seven action buttons — three columns left no room for a long stat line.
const GRID_COLS = { base: 1, sm: 2 };

// The dashboard "My peers" / "My subordinates" views: a person-card grid (same card language
// as ManagersTable), keeping the table era's filters, sorting, and pagination. With `teamId`
// the grid pins to one managed team (the team-details page's manager view, v2.5.5): the team and reports
// filters unmount (a specific managed team is inherently direct reports) and the drill-down
// links carry the parameterized `team` origin so round-trips return to the team view.
export default function TeamMembersTable({
  view,
  emptyMessage,
  teamId,
  settingsKey: settingsKeyProp,
  backTo: backToProp,
}: {
  view: TeamMemberListView;
  emptyMessage: string;
  /** Pin the grid to one managed team (hides the team + reports-scope filters). */
  teamId?: number;
  /** Override the localStorage view-settings namespace when embedded outside the main tabs. */
  settingsKey?: string;
  /** When set, action links carry this as their return target instead of the dashboard tab. */
  backTo?: string;
}) {
  const { t } = useTranslation();
  const pinned = teamId != null;
  // Two dashboard views (peers/subordinates) share this component — settings are per-view;
  // embeddings (the team-scoped view) pass their own namespace so filters don't bleed.
  const settingsKey = settingsKeyProp ?? `teamMembers.${view}`;
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
  const includeIndirect = !pinned && view === "managed" && reportsScope === "all";
  // A pinned managed team is inherently direct reports, so the direct-only affordances
  // (stats, 1:1s, goals) stay available without the Reports filter.
  const scopeIsDirect = pinned || reportsScope === "direct";
  // The pinned team is not a user-cleared filter, so it never counts.
  const effectiveTeamId = teamId ?? (teamFilter ? Number(teamFilter) : undefined);
  const activeFilterCount =
    (nameFilter.trim() ? 1 : 0) +
    (emailFilter.trim() ? 1 : 0) +
    (!pinned && teamFilter ? 1 : 0) +
    (includeIndirect ? 1 : 0);

  const [debouncedName] = useDebouncedValue(nameFilter, 300);
  const [debouncedEmail] = useDebouncedValue(emailFilter, 300);

  const { page, setPage, pageSize, setPageSize, sortField, sortDir, sortParam, toggleSort } =
    usePagedSort<SortField>(
      "name",
      [debouncedName, debouncedEmail, effectiveTeamId, includeIndirect],
      { key: settingsKey, sortFields: SORT_FIELDS },
    );

  const { data: teams } = useQuery({
    queryKey: ["teams", "all"],
    queryFn: () => listAllTeams(),
    enabled: !pinned, // only feeds the team Select, which a pinned grid never mounts
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
      effectiveTeamId,
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
        teamId: effectiveTeamId,
        includeIndirect: includeIndirect || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const total = data?.total ?? 0;

  // The screen this grid lives in, so feedback/1:1 flows can return here on Cancel — the
  // Dashboard tab by default, the team-scoped view when embedded there.
  const tab = view === "managed" ? "subordinates" : "peers";
  const backTo = backToProp ?? `/?tab=${tab}`;
  // The per-person drill-downs' origin: the pinned view threads `team` + teamId through so
  // their "Back to …" returns to the team-details page (/teams/:id/details).
  const drillFrom = pinned ? "team" : view === "managed" ? "subordinates" : "peers";
  const drillTeamId = pinned ? teamId : undefined;

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
          {!pinned && (
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
          )}
          {view === "managed" && !pinned && (
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
              teams={m.teams}
              // Peer cards show the two feedback directions; subordinate cards show the
              // 1:1 + feedback stats, but only while every card is a direct report (same
              // rationale as the 1:1 button gate below): rows carry no direct/indirect
              // marker, and indirect reports can't have 1:1s with the caller, so "never"
              // would just be noise. The Profile section shows regardless — the career
              // triple is populated on every view's rows. Button gates: creating a
              // 1:1/goal/review needs a direct report, so those buttons exist only while
              // the scope guarantees every card is a direct report.
              body={
                <PersonCardBody
                  person={m}
                  stats={
                    view === "member"
                      ? "peer"
                      : view === "managed" && scopeIsDirect
                        ? "subordinate"
                        : "none"
                  }
                  showLastReview={view === "managed" && scopeIsDirect}
                  showDaysOff={view === "managed" && scopeIsDirect}
                  actions={{
                    userId: m.userId,
                    name: m.name,
                    labels: "teams",
                    back: backTo,
                    drillFrom,
                    drillTeamId,
                    // Embeddings return the drill-downs to their exact host URL (origin query
                    // included) — the v1.39.0 back= override; the label stays the origin's.
                    drillBack: backToProp,
                    show: {
                      provide: true,
                      ask: true,
                      request: view === "managed",
                      newOneOnOne: view === "managed" && scopeIsDirect,
                      feedbacks: true,
                      oneOnOnes: view === "managed" && scopeIsDirect,
                      goals: view === "managed" && scopeIsDirect,
                      reviews: view === "managed" && scopeIsDirect,
                      daysOff: view === "managed" && scopeIsDirect,
                    },
                  }}
                />
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
