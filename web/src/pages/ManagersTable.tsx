import { ActionIcon, Alert, Group, Select, SimpleGrid, Skeleton } from "@mantine/core";
import { IconArrowDown, IconArrowUp, IconUsersGroup } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { canAudit } from "../api/session";
import { listAllTeamMembers } from "../api/teams";
import EmptyState from "../components/EmptyState";
import ClearableTextInput from "../components/ClearableTextInput";
import ListSurface from "../components/ListSurface";
import ListToolbar from "../components/ListToolbar";
import PersonCard from "../components/PersonCard";
import PersonCardBody from "../components/PersonCardStats";
import { groupTeamRows } from "../utils/teamRows";
import { loadErrorMessage } from "../utils/saveError";
import { isOneOf, isString, isStringOrNull, useStoredState } from "../hooks/useStoredState";

const SETTINGS_KEY = "teamMembers.managers";
const SORT_FIELDS = ["name", "email", "teamName"] as const;
type SortField = (typeof SORT_FIELDS)[number];

// The dashboard "My managers" view: a person-card grid (not a table) — typically 1–3 people,
// so narrow cards use the width far better than full-width spreadsheet rows.
export default function ManagersTable() {
  const { t } = useTranslation();
  const [nameFilter, setNameFilter] = useStoredState(`${SETTINGS_KEY}.filter.name`, "", isString);
  const [emailFilter, setEmailFilter] = useStoredState(`${SETTINGS_KEY}.filter.email`, "", isString);
  const [teamFilter, setTeamFilter] = useStoredState<string | null>(
    `${SETTINGS_KEY}.filter.team`,
    null,
    isStringOrNull,
  );
  const [sortField, setSortField] = useStoredState<SortField>(
    `${SETTINGS_KEY}.sort.field`,
    "name",
    isOneOf(SORT_FIELDS),
  );
  const [sortDir, setSortDir] = useStoredState<"asc" | "desc">(
    `${SETTINGS_KEY}.sort.dir`,
    "asc",
    isOneOf(["asc", "desc"]),
  );
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["managers"],
    // The paging loop, not a single capped page — correct even past 100 memberships
    // (the checkup-#10 note; below that the behavior is identical).
    queryFn: () => listAllTeamMembers("managers"),
  });

  // Container-query columns (v3.4.0): up to three cards across, keyed on the grid's own width
  // — kept in step with TeamMembersTable's GRID_COLS so the dashboard grids stay coherent.
  const gridCols = { base: 1, "44em": 2, "84em": 3 };

  if (isLoading && !data) {
    return (
      <SimpleGrid type="container" cols={gridCols} spacing="md">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} height={150} radius="md" />
        ))}
      </SimpleGrid>
    );
  }

  const managers = groupTeamRows(data ?? []);
  const teamOptions = Array.from(
    new Map(managers.flatMap((manager) => manager.teams.map((team) => [String(team.id), team.name]))),
  ).map(([value, label]) => ({ value, label }));
  const normalizedName = nameFilter.trim().toLocaleLowerCase();
  const normalizedEmail = emailFilter.trim().toLocaleLowerCase();
  const visibleManagers = managers
    .filter((manager) => !normalizedName || manager.name.toLocaleLowerCase().includes(normalizedName))
    .filter((manager) => !normalizedEmail || manager.email.toLocaleLowerCase().includes(normalizedEmail))
    .filter((manager) => teamFilter == null || manager.teams.some((team) => String(team.id) === teamFilter))
    .sort((left, right) => {
      const leftValue = sortField === "teamName" ? (left.teams[0]?.name ?? "") : left[sortField];
      const rightValue = sortField === "teamName" ? (right.teams[0]?.name ?? "") : right[sortField];
      return leftValue.localeCompare(rightValue) * (sortDir === "asc" ? 1 : -1);
    });
  const activeFilterCount =
    (nameFilter.trim() ? 1 : 0) + (emailFilter.trim() ? 1 : 0) + (teamFilter ? 1 : 0);
  const sortOptions = [
    { value: "name", label: t("common.field.name") },
    { value: "email", label: t("common.field.email") },
    { value: "teamName", label: t("teams.team") },
  ];
  const DirIcon = sortDir === "asc" ? IconArrowUp : IconArrowDown;
  const toolbar = (
    <ListToolbar
      search={{
        label: t("common.field.name"),
        value: nameFilter,
        onChange: setNameFilter,
        clearLabel: t("teams.clearNameFilter"),
      }}
      filters={{
        activeCount: activeFilterCount,
        storageKey: SETTINGS_KEY,
        tourId: "dashboard-people-filters",
        onClear: () => {
          setNameFilter("");
          setEmailFilter("");
          setTeamFilter(null);
        },
        children: (
          <>
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
          </>
        ),
      }}
      right={(
        <Group gap="xs" wrap="nowrap">
          <Select
            size="xs"
            w={130}
            aria-label={t("common.sort.label")}
            data={sortOptions}
            value={sortField}
            allowDeselect={false}
            onChange={(value) => value && setSortField(value as SortField)}
          />
          <ActionIcon
            variant="default"
            size="md"
            onClick={() => setSortDir(sortDir === "asc" ? "desc" : "asc")}
            aria-label={t("common.sort.toggleDirection")}
          >
            <DirIcon size={14} />
          </ActionIcon>
        </Group>
      )}
    />
  );

  return (
    <ListSurface cards toolbar={toolbar}>
      {isError && (
        <Alert color="red" variant="light" title={t("users.loadManagersFailed")}>
          {loadErrorMessage(error, t)}
        </Alert>
      )}

      {visibleManagers.length > 0 ? (
        <SimpleGrid component="ul" m={0} p={0} style={{ listStyle: "none" }} type="container" cols={gridCols} spacing="md">
          {visibleManagers.map((m) => (
            <PersonCard
              key={m.userId}
              name={m.name}
              email={m.email}
              teams={m.teams}
              body={
                <PersonCardBody
                  person={m}
                  stats="manager"
                  actionsVariant="icons"
                  actions={{
                    userId: m.userId,
                    name: m.name,
                    labels: "users",
                    back: "/?tab=managers",
                    // No drillFrom on purpose: the feedbacks drill-down historically omits
                    // `from` here (its resolver defaults to managers); 1:1s/goals default in.
                    // The career timeline is self/chain/HR-only since v2.25.0 — a manager's
                    // history is not their report's to browse, so only auditors keep the link.
                    show: {
                      career: canAudit(),
                      provide: true,
                      ask: true,
                      feedbacks: true,
                      oneOnOnes: true,
                      goals: true,
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
            label={activeFilterCount > 0 ? t("teams.noMatchingUsers") : t("users.noManagers")}
          />
        )
      )}
    </ListSurface>
  );
}
